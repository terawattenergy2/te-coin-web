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
  -- Receipt sale price, sheet base cost, and group settings are the earning contract.
  ctx:=jsonb_build_object('group_multiplier',coalesce(cfg->'membership_config'->'groups'->p.product->>'b',cfg->>'y','0.5')::numeric,
    'commission_rate',coalesce(cfg->'membership_config'->'groups'->p.product->>'commission',cfg->>'commission','0.015')::numeric);
  if (ctx->>'group_multiplier')::numeric not between 0 and 100 or (ctx->>'commission_rate')::numeric not between 0 and 1 then raise exception 'Invalid B/commission settings';end if;
  if (to_jsonb(p)->>base_col)::numeric=0 then raise exception 'Product cost is zero: review cost first';end if;
  comm:=price*(ctx->>'commission_rate')::numeric;
  gross:=price-(to_jsonb(p)->>base_col)::numeric-comm;
  coins:=round(greatest(0,gross*q*(ctx->>'group_multiplier')::numeric),2);
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
