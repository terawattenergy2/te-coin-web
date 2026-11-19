-- Additive setup. Does not change existing formulas, balances, stock or accounts.
begin;
create schema if not exists tc_integrations;
revoke all on schema tc_integrations from public,anon;
grant usage on schema tc_integrations to authenticated;
create table if not exists public.tc_flow_epcs(
 source text not null, environment text not null check(environment in ('test','v1')),
 contact_id text not null, company_name text not null, tax_id text, branch text,
 customer_id text not null references public.tera_coin_customer(customer_id),
 created_at timestamptz not null default now(), primary key(source,environment,contact_id)
);
create table if not exists public.tc_flow_product_map(
 source text not null, environment text not null check(environment in ('test','v1')),
 product_key text not null, product_id uuid not null references public.stock_profit(id),
 primary key(source,environment,product_key)
);
create table if not exists public.tc_flow_imports(
 source text not null, environment text not null check(environment in ('test','v1')),
 sale_key text not null, receipt_id text not null, contact_id text not null,
 customer_id text not null references public.tera_coin_customer(customer_id),
 ledger_id uuid not null references public.tc_ledger(id), fingerprint text not null,
 amount numeric(18,2) not null, created_at timestamptz not null default now(),
 primary key(source,environment,sale_key)
);
alter table public.tc_flow_epcs enable row level security;
alter table public.tc_flow_product_map enable row level security;
alter table public.tc_flow_imports enable row level security;
revoke all on public.tc_flow_epcs,public.tc_flow_product_map,public.tc_flow_imports from public,anon,authenticated;
grant select on public.tc_flow_epcs,public.tc_flow_product_map,public.tc_flow_imports to authenticated;
grant insert,update on public.tc_flow_product_map to authenticated;
drop policy if exists tc_flow_epc_read on public.tc_flow_epcs;
create policy tc_flow_epc_read on public.tc_flow_epcs for select to authenticated using(public.tc_role() in ('admin','viewer') or exists(select 1 from public.tera_coin_customer c where c.customer_id=tc_flow_epcs.customer_id and c.auth_user_id=auth.uid()));
drop policy if exists tc_flow_product_read on public.tc_flow_product_map;
create policy tc_flow_product_read on public.tc_flow_product_map for select to authenticated using(public.tc_role() in ('admin','viewer'));
drop policy if exists tc_flow_product_write on public.tc_flow_product_map;
create policy tc_flow_product_write on public.tc_flow_product_map for all to authenticated using(public.tc_role()='admin') with check(public.tc_role()='admin');
drop policy if exists tc_flow_import_read on public.tc_flow_imports;
create policy tc_flow_import_read on public.tc_flow_imports for select to authenticated using(public.tc_role() in ('admin','viewer') or exists(select 1 from public.tera_coin_customer c where c.customer_id=tc_flow_imports.customer_id and c.auth_user_id=auth.uid()));
create or replace function tc_integrations.flow_credit(sale jsonb, existing_customer text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb; p public.stock_profit; c public.tera_coin_customer; m public.tc_flow_epcs;
 prior public.tc_flow_imports; line jsonb; snap jsonb:='[]'; ctx jsonb; total numeric:=0;
 q numeric; net numeric; price numeric; coins numeric; gross numeric; comm numeric;
 src text:=sale->>'source'; env text:=sale->>'environment'; sale_id text:=sale->>'saleKey';
 contact text:=sale->>'contactId'; company text:=sale->>'contactName';
 fingerprint text; ledger uuid; ref text; mapped_product uuid; base_col text;
begin
 if auth.uid() is null or public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 -- Sandbox documents must never create spendable balances in the production database.
 if env is distinct from 'v1' then raise exception 'Sandbox preview only: no real Coin credit';end if;
 if nullif(trim(src),'') is null or nullif(trim(sale_id),'') is null or nullif(trim(contact),'') is null or nullif(trim(company),'') is null or length(src)>150 or length(sale_id)>180 then raise exception 'Invalid source/company/document identity';end if;
 if sale->'paid' is distinct from 'true'::jsonb then raise exception 'Full payment required';end if;
 if jsonb_typeof(sale->'lines') is distinct from 'array' then raise exception 'Missing sale items';end if;
 if jsonb_array_length(sale->'lines') not between 1 and 100 then raise exception 'Invalid sale items';end if;
 fingerprint:=md5((sale - 'receiptId' - 'documentNumber')::text);
 perform pg_advisory_xact_lock(hashtextextended(src||':'||env||':'||sale_id,0));
 select * into prior from public.tc_flow_imports i where i.source=src and i.environment=env and i.sale_key=sale_id;
 if found then
  if prior.fingerprint<>fingerprint then raise exception 'Imported sale changed: reconcile manually';end if;
  return jsonb_build_object('duplicate',true,'tc',prior.amount,'customer_id',prior.customer_id);
 end if;
 perform pg_advisory_xact_lock(hashtextextended(src||':'||env||':company:'||contact,0));
 select * into m from public.tc_flow_epcs x where x.source=src and x.environment=env and x.contact_id=contact;
 if found then
  if existing_customer is not null and existing_customer<>m.customer_id then raise exception 'EPC already linked to another account';end if;
  select * into c from public.tera_coin_customer where customer_id=m.customer_id for update;
 else
  if existing_customer is null then
   insert into public.tera_coin_customer(customer_name,total_earn,used_tc) values(company,0,0) returning * into c;
  else
   select * into c from public.tera_coin_customer where customer_id=existing_customer for update;
   if not found then raise exception 'EPC account not found';end if;
  end if;
  insert into public.tc_flow_epcs(source,environment,contact_id,company_name,tax_id,branch,customer_id) values(src,env,contact,company,sale->>'taxId',sale->>'branch',c.customer_id);
 end if;
 select to_jsonb(s) into cfg from public.tc_settings s where id=1 for share;
 if cfg->'formulas' is null then raise exception 'Coin formulas not configured';end if;
 base_col:=coalesce(cfg->'membership_config'->>'base_cost_column','tier_2_price');
 for line in select value from jsonb_array_elements(sale->'lines') loop
  if jsonb_typeof(line->'quantity') is distinct from 'number' or jsonb_typeof(line->'netTotal') is distinct from 'number' then raise exception 'Invalid quantity/net amount';end if;
  q:=(line->>'quantity')::numeric;net:=(line->>'netTotal')::numeric;
  if q<>trunc(q) or q not between 1 and 100000 or net not between 0 and 1e12 then raise exception 'Invalid quantity/net amount';end if;
  select x.product_id into mapped_product from public.tc_flow_product_map x where x.source=src and x.environment=env and x.product_key=line->>'productKey' for share;
  if not found then raise exception 'Unmapped FlowAccount product';end if;
  select * into p from public.stock_profit where id=mapped_product for share;
  if not found or not p.active then raise exception 'Product unavailable';end if;
  if jsonb_typeof(to_jsonb(p)->base_col) is distinct from 'number' or (to_jsonb(p)->>base_col)::numeric<0 then raise exception 'Invalid product base cost';end if;
  price:=net/q;
  -- Retain the stored formula AST. Legacy epc_price means actual sale price here;
  -- raw_epc_price remains the catalog price for custom formulas that request it.
  ctx:=public.tc_formula_context(to_jsonb(p),cfg,jsonb_build_object('quantity',q,'sale_unit_price',price,'epc_price',price,
    'base_cost',to_jsonb(p)->base_col,'group_multiplier',coalesce(cfg->'membership_config'->'groups'->p.product->'b',cfg->'y'),
    'commission_rate',coalesce(cfg->'membership_config'->'groups'->p.product->'commission',cfg->'commission'),
    'balance_tc',c.banlance_tc,'total_earn',c.total_earn,'used_tc',c.used_tc));
  comm:=public.tc_formula_result('commission_amount',cfg->'formulas',ctx);
  gross:=public.tc_formula_result('gross_margin',cfg->'formulas',ctx);
  coins:=round(public.tc_formula_result('earned_tc',cfg->'formulas',ctx),2);
  if coins is null or coins<0 or coins>1e15 then raise exception 'Invalid Coin result';end if;
  total:=total+coins;
  snap:=snap||jsonb_build_array(jsonb_build_object('product',to_jsonb(p),'source_product',line,'quantity',q,'sale_unit_price',price,'commission_total',comm*q,'gross_margin_a',gross*q,'earned_tc',coins));
 end loop;
 if (select sum((x->>'netTotal')::numeric) from jsonb_array_elements(sale->'lines') x)<>(sale->>'netTotal')::numeric then raise exception 'Net total mismatch';end if;
 ref:='flowaccount:'||env||':'||src||':'||sale_id;
 insert into public.tc_ledger(customer_id,amount,description,status,reference,snapshot,created_by)
 values(c.customer_id,total,'FlowAccount EPC '||company||' / '||(sale->>'documentNumber'),'earned',ref,
 jsonb_build_object('flowaccount',sale,'lines',snap,'settings',cfg,'earned_tc',total,'inventory_adjusted',false),auth.uid()) returning id into ledger;
 update public.tera_coin_customer set total_earn=total_earn+total where customer_id=c.customer_id;
 insert into public.tc_flow_imports(source,environment,sale_key,receipt_id,contact_id,customer_id,ledger_id,fingerprint,amount)
 values(src,env,sale_id,sale->>'receiptId',contact,c.customer_id,ledger,fingerprint,total);
 return jsonb_build_object('tc',total,'customer_id',c.customer_id,'duplicate',false,'ledger_id',ledger);
end $$;
revoke all on function tc_integrations.flow_credit(jsonb,text) from public,anon,authenticated;
grant execute on function tc_integrations.flow_credit(jsonb,text) to authenticated;
create or replace function public.tc_flow_credit(sale jsonb,existing_customer text default null) returns jsonb
language sql security invoker set search_path='' as $$ select tc_integrations.flow_credit(sale,existing_customer) $$;
revoke all on function public.tc_flow_credit(jsonb,text) from public,anon,authenticated;
grant execute on function public.tc_flow_credit(jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
