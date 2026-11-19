-- Run AFTER 001 and 002. Rerunnable. Does not replace existing earned/spent ledger amounts.
begin;
alter table public.tc_settings add column if not exists formulas jsonb not null default '{"commission_amount":{"op":"mul","args":[{"var":"tier_2_price"},{"var":"commission_rate"}]},"gross_margin":{"op":"sub","args":[{"op":"sub","args":[{"var":"epc_price"},{"var":"tier_2_price"}]},{"var":"commission_amount"}]},"earned_tc":{"op":"round","args":[{"op":"max","args":[{"value":"0"},{"op":"mul","args":[{"op":"mul","args":[{"var":"gross_margin"},{"var":"quantity"}]},{"var":"y"}]}]},{"value":"2"}]},"reward_tc_1":{"op":"ceil","args":[{"op":"div","args":[{"var":"value_baht"},{"op":"mul","args":[{"var":"baht_per_tc"},{"var":"reward_y"}]}]}]},"reward_tc_2":{"op":"ceil","args":[{"op":"div","args":[{"var":"value_baht"},{"op":"mul","args":[{"var":"baht_per_tc"},{"var":"reward_y"}]}]}]},"reward_tc_3":{"op":"ceil","args":[{"op":"div","args":[{"var":"value_baht"},{"op":"mul","args":[{"var":"baht_per_tc"},{"var":"reward_y"}]}]}]},"reward_tc_4":{"op":"ceil","args":[{"op":"div","args":[{"var":"value_baht"},{"op":"mul","args":[{"var":"baht_per_tc"},{"var":"reward_y"}]}]}]},"tc_value":{"op":"mul","args":[{"var":"balance_tc"},{"var":"baht_per_tc"}]},"liability_amount":{"var":"tc_value"},"lucky_rate":{"var":"success_rate"}}'::jsonb;
alter table public.tc_settings add column if not exists formula_revision bigint not null default 1;
-- Internal template used to generate 004_configurable_formulas.sql.
create or replace function public.tc_formula_refs(node jsonb,depth integer default 0) returns text[]
language plpgsql immutable set search_path='' as $$ declare refs text[]:='{}';a jsonb;v text;op text;n integer;begin
 if depth>32 or jsonb_typeof(node)<>'object' then raise exception 'Invalid formula node/depth';end if;
 if node ? 'value' then
  if (select count(*) from jsonb_object_keys(node))<>1 or coalesce(node->>'value','') !~ '^([0-9]+(\.[0-9]+)?|\.[0-9]+)$' or abs((node->>'value')::numeric)>1e15 then raise exception 'Invalid number';end if;
  return refs;
 elsif node ? 'var' then
  v:=node->>'var';if (select count(*) from jsonb_object_keys(node))<>1 or v is null or v !~ '^[A-Za-z_][A-Za-z_0-9]{0,66}$' then raise exception 'Invalid variable';end if;return array[v];
 end if;
 if (select count(*) from jsonb_object_keys(node))<>2 or jsonb_typeof(node->'args') is distinct from 'array' then raise exception 'Invalid operation';end if;
 op:=node->>'op';n:=jsonb_array_length(node->'args');
 if op is null or op not in ('add','sub','mul','div','neg','pos','abs','ceil','floor','round','min','max') then raise exception 'Unsupported operation';end if;
 if (op in ('add','sub','mul','div') and n<>2) or (op in ('neg','pos','abs','ceil','floor') and n<>1) or (op='round' and n not in (1,2)) or (op in ('min','max') and (n<2 or n>8)) then raise exception 'Invalid argument count';end if;
 for a in select value from jsonb_array_elements(node->'args') loop refs:=refs||public.tc_formula_refs(a,depth+1);end loop;return refs;
end $$;
create or replace function public.tc_formula_eval(node jsonb,ctx jsonb,depth integer default 0) returns numeric
language plpgsql immutable set search_path='' as $$ declare op text;args numeric[]:='{}';a jsonb;v numeric;digits integer;begin
 if depth>32 then raise exception 'Formula nesting limit';end if;
 if node ? 'value' then return (node->>'value')::numeric;end if;
 if node ? 'var' then
  if not(ctx ? (node->>'var')) or jsonb_typeof(ctx->(node->>'var')) is distinct from 'number' then raise exception 'Missing numeric variable: %',node->>'var';end if;
  return (ctx->>(node->>'var'))::numeric;
 end if;
 for a in select value from jsonb_array_elements(node->'args') loop args:=args||public.tc_formula_eval(a,ctx,depth+1);end loop;
 op:=node->>'op';
 case op when 'add' then v:=args[1]+args[2];when 'sub' then v:=args[1]-args[2];when 'mul' then v:=args[1]*args[2];when 'div' then if args[2]=0 then raise exception 'Cannot divide by zero';end if;v:=args[1]/args[2];when 'neg' then v:=-args[1];when 'pos' then v:=args[1];when 'abs' then v:=abs(args[1]);when 'ceil' then v:=ceil(args[1]);when 'floor' then v:=floor(args[1]);when 'round' then if coalesce(args[2],0)<>trunc(coalesce(args[2],0)) or coalesce(args[2],0) not between 0 and 8 then raise exception 'Rounding digits must be 0..8';end if;digits:=coalesce(args[2],0)::integer;v:=round(args[1],digits);when 'min' then select min(x) into v from unnest(args)x;when 'max' then select max(x) into v from unnest(args)x;else raise exception 'Invalid operation';end case;
 if v is null or abs(v)>1e15 then raise exception 'Formula result out of range';end if;return v;
end $$;
-- Resolve each dependency once: cycles fail; a formula cannot create exponential recursive work.
create or replace function public.tc_formula_result(target text,rules jsonb,ctx jsonb) returns numeric
language plpgsql immutable set search_path='' as $$ declare todo text[]:=array[target];done jsonb:='{}';i integer:=1;k text;dep text;refs text[];progress boolean;v numeric;begin
 if not(rules ? target) then raise exception 'Missing formula: %',target;end if;
 while i<=cardinality(todo) loop
  if cardinality(todo)>64 then raise exception 'Too many formulas';end if;
  refs:=public.tc_formula_refs(rules->todo[i]);
  foreach dep in array refs loop if rules ? dep and not(dep=any(todo)) then todo:=todo||dep;end if;end loop;i:=i+1;
 end loop;
 loop
  progress:=false;
  foreach k in array todo loop
   if done ? k then continue;end if;
   refs:=public.tc_formula_refs(rules->k);
   if exists(select 1 from unnest(refs)r where rules ? r and not(done ? r)) then continue;end if;
   v:=public.tc_formula_eval(rules->k,ctx||done);done:=done||jsonb_build_object(k,v);progress:=true;
  end loop;
  if done ? target then return (done->>target)::numeric;end if;
  if not progress then raise exception 'Circular formula reference';end if;
 end loop;
end $$;
create or replace function public.tc_formula_context(product jsonb,settings jsonb,extra jsonb default '{}') returns jsonb
language plpgsql immutable set search_path='' as $$ declare ctx jsonb:='{}';r record;begin
 for r in select key,value from jsonb_each(product) loop if jsonb_typeof(r.value)='number' then ctx:=ctx||jsonb_build_object(r.key,r.value,'raw_'||r.key,r.value);end if;end loop;
 return ctx||jsonb_build_object('quantity',1,'y',settings->'y','commission_rate',settings->'commission','baht_per_tc',settings->'baht_per_tc','success_rate',settings->'success_rate','value_baht',800,'reward_y',1,'balance_tc',24500,'total_earn',32000,'used_tc',7500)||extra;
end $$;
create or replace function public.tc_validate_formulas(rules jsonb,settings jsonb) returns void
language plpgsql set search_path='' as $$ declare k text;r record;ctx jsonb;v numeric;core text[]:=array['commission_amount','gross_margin','earned_tc','reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4','tc_value','liability_amount','lucky_rate'];begin
 if jsonb_typeof(rules) is distinct from 'object' or length(rules::text)>24000 or (select count(*) from jsonb_object_keys(rules))>64 then raise exception 'Invalid formula collection';end if;
 foreach k in array core loop if not(rules ? k) then raise exception 'Required formula: %',k;end if;end loop;
 for k in select jsonb_object_keys(rules) loop
  if k !~ '^[A-Za-z_][A-Za-z_0-9]{0,62}$' or k like 'raw\_%' escape '\' or k in ('__proto__','prototype','constructor','quantity','y','commission_rate','baht_per_tc','success_rate','value_baht','reward_y','balance_tc','total_earn','used_tc','Qty','qty','id','main','model','product','active') then raise exception 'Reserved/invalid output: %',k;end if;
  perform public.tc_formula_refs(rules->k);
 end loop;
 -- Every current product is validated, including zero stock and all existing prices.
 for r in select to_jsonb(s) as item from public.stock_profit s union all select jsonb_build_object('tier_2_price',74400,'epc_price',81300,'Qty',2) where not exists(select 1 from public.stock_profit) loop
  ctx:=public.tc_formula_context(r.item,settings);
  for k in select jsonb_object_keys(rules) loop
   if k=any(array['reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4','tc_value','liability_amount','lucky_rate']) then continue;end if;
   v:=public.tc_formula_result(k,rules,ctx);if k='earned_tc' and v<0 then raise exception 'Earned TC cannot be negative';end if;
   if (k like '%price%' or k like '%cost%') and v<0 then raise exception 'Prices cannot be negative';end if;
  end loop;
 end loop;
 ctx:=public.tc_formula_context('{}',settings);
 foreach k in array array['tc_value','liability_amount','lucky_rate'] loop
  v:=public.tc_formula_result(k,rules,ctx);if v<0 or (k='lucky_rate' and v>1) then raise exception 'Invalid amount/probability: %',k;end if;
 end loop;
 -- Include every existing customer so balance-dependent formulas cannot corrupt their totals.
 for r in select * from public.tera_coin_customer loop
  ctx:=public.tc_formula_context('{}',settings,jsonb_build_object('balance_tc',r.banlance_tc,'total_earn',r.total_earn,'used_tc',r.used_tc));
  foreach k in array array['tc_value','liability_amount'] loop if public.tc_formula_result(k,rules,ctx)<0 then raise exception 'Negative customer metric';end if;end loop;
 end loop;
 for r in select * from public.tc_rewards loop
  ctx:=public.tc_formula_context('{}',settings,jsonb_build_object('value_baht',r.value_baht,'reward_y',r.y));
  v:=public.tc_formula_result('reward_tc_'||r.option,rules,ctx);if v<=0 then raise exception 'Redemption TC must be positive';end if;
 end loop;
 -- Validate all four reward roots even when one option has no catalog entries.
 foreach k in array array['reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4'] loop if public.tc_formula_result(k,rules,public.tc_formula_context('{}',settings))<=0 then raise exception 'Invalid redemption formula';end if;end loop;
end $$;
create or replace function public.tc_settings_formula_guard() returns trigger language plpgsql security definer set search_path='' as $$ begin
 perform public.tc_validate_formulas(new.formulas,to_jsonb(new));return new;end $$;
drop trigger if exists tc_formula_guard on public.tc_settings;
create trigger tc_formula_guard before update on public.tc_settings for each row execute function public.tc_settings_formula_guard();
create or replace function public.tc_save_formulas(rules jsonb,expected_revision bigint) returns bigint
language plpgsql security definer set search_path='' as $$ declare s public.tc_settings;begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 select * into s from public.tc_settings where id=1 for update;
 if expected_revision is null or s.formula_revision<>expected_revision then raise exception 'Formulas changed by another admin; refresh first';end if;
 update public.tc_settings set formulas=rules,formula_revision=formula_revision+1 where id=1 returning formula_revision into expected_revision;return expected_revision;
end $$;
-- Raw balances remain ledger-derived; only valuation and liability are configurable.
create or replace function public.tc_sync_customer() returns trigger language plpgsql security definer set search_path='' as $$ declare s public.tc_settings;v numeric;begin
 select * into s from public.tc_settings where id=1;
 new.banlance_tc:=new.total_earn-new.used_tc;
 v:=public.tc_formula_result('liability_amount',s.formulas,public.tc_formula_context('{}',to_jsonb(s),jsonb_build_object('balance_tc',new.banlance_tc,'total_earn',new.total_earn,'used_tc',new.used_tc)));
 if v<0 then raise exception 'Negative liability';end if;new.liability:=round(v,2);return new;end $$;
create or replace function public.tc_revalue() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.tera_coin_customer set liability=liability;return new;end $$;
drop trigger if exists tc_revalue_customers on public.tc_settings;
create trigger tc_revalue_customers after update on public.tc_settings for each row execute function public.tc_revalue();
revoke update on public.tc_settings from authenticated;
grant update(y,commission,baht_per_tc,success_rate) on public.tc_settings to authenticated;
create or replace function public.tc_earn(customer text,product_id uuid,quantity integer,sale_reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;p public.stock_profit;c public.tera_coin_customer;gross numeric;coins numeric;ctx jsonb;begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if quantity is null or quantity<=0 or trim(coalesce(sale_reference,''))='' then raise exception 'Invalid quantity/reference';end if;
 select * into s from public.tc_settings where id=1 for share;
 select * into p from public.stock_profit where id=product_id for update;
 if not found or not p.active then raise exception 'Product unavailable';end if;
 if coalesce(p."Qty",0)<quantity then raise exception 'Insufficient stock';end if;
 if p.tier_2_price is null or p.epc_price is null or p.tier_2_price<0 or p.epc_price<0 then raise exception 'Invalid prices';end if;
 select * into c from public.tera_coin_customer where customer_id=customer for update;
 if not found then raise exception 'Customer not found';end if;
 ctx:=public.tc_formula_context(to_jsonb(p),to_jsonb(s),jsonb_build_object('quantity',quantity,'balance_tc',c.banlance_tc,'total_earn',c.total_earn,'used_tc',c.used_tc));
 gross:=public.tc_formula_result('gross_margin',s.formulas,ctx);
 coins:=round(public.tc_formula_result('earned_tc',s.formulas,ctx),2);
 if coins<0 then raise exception 'Earned TC cannot be negative';end if;
 insert into public.tc_ledger(customer_id,amount,description,status,reference,snapshot,created_by) values(customer,coins,p.model||' × '||quantity,'earned',trim(sale_reference),jsonb_build_object('product',to_jsonb(p),'quantity',quantity,'gross_per_unit',gross,'settings',to_jsonb(s)),auth.uid());
 update public.tera_coin_customer set total_earn=total_earn+coins where customer_id=customer;
 update public.stock_profit set "Qty"="Qty"-quantity where id=product_id;
 return jsonb_build_object('tc',coins);end $$;
create or replace function public.tc_redeem(reward_id uuid,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;r public.tc_rewards;c public.tera_coin_customer;cost numeric;won boolean;draw numeric;rate numeric;ctx jsonb;begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer only';end if;
 if request_id is null then raise exception 'Request ID required';end if;
 select * into s from public.tc_settings where id=1 for share;
 select * into r from public.tc_rewards where id=reward_id for update;
 if not found or not r.active or r.stock<=0 then raise exception 'Reward unavailable';end if;
 select * into c from public.tera_coin_customer where auth_user_id=auth.uid() for update;
 if not found then raise exception 'Customer not found';end if;
 ctx:=public.tc_formula_context('{}',to_jsonb(s),jsonb_build_object('value_baht',r.value_baht,'reward_y',r.y));
 cost:=ceil(public.tc_formula_result('reward_tc_'||r.option,s.formulas,ctx));
 if cost<=0 then raise exception 'Redemption TC must be positive';end if;
 rate:=public.tc_formula_result('lucky_rate',s.formulas,public.tc_formula_context('{}',to_jsonb(s)));
 if rate<0 or rate>1 then raise exception 'Lucky Draw rate must be 0..1';end if;
 if c.banlance_tc<cost then raise exception 'Insufficient TeraCoin';end if;
 -- Secure random result is generated only on the server. Every attempt spends TC.
 draw:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint::numeric/4294967296;
 won:=r.option<>3 or draw<rate;
 insert into public.tc_ledger(customer_id,amount,description,status,request_id,snapshot,created_by) values(c.customer_id,-cost,r.name,case when won then 'pending' else 'no_prize' end,request_id,jsonb_build_object('reward',to_jsonb(r),'settings',to_jsonb(s),'won',won),auth.uid());
 update public.tera_coin_customer set used_tc=used_tc+cost where customer_id=c.customer_id;
 update public.tc_rewards set stock=stock-1 where id=reward_id;
 return jsonb_build_object('won',won,'spent_tc',cost);end $$;
create or replace function public.tc_catalog(page_offset integer default 0,page_size integer default 200)
returns table(id uuid,main text,product text,model text,qty bigint,unit_price numeric,price_tier text)
language plpgsql stable security definer set search_path='' as $$ declare tier text;s public.tc_settings;begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer only';end if;
 if page_offset is null or page_offset<0 or page_size is null or page_size<1 or page_size>200 then raise exception 'Invalid page';end if;
 select p.price_column into tier from public.tc_profiles p where p.id=auth.uid();
 if tier is null then return;end if;
 select * into s from public.tc_settings cfg where cfg.id=1;
 return query select p.id,p.main,p.product,p.model,p."Qty",case when s.formulas ? tier then public.tc_formula_result(tier,s.formulas,public.tc_formula_context(to_jsonb(p),to_jsonb(s))) else (to_jsonb(p)->>tier)::numeric end,tier
 from public.stock_profit p where p.active and (to_jsonb(p)->>tier) is not null order by p.id limit page_size offset page_offset;
end $$;
-- Internal helpers are not callable by unauthenticated users or customer RPC clients.
do $$ declare f record;begin for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and (proname like 'tc_formula_%' or proname in ('tc_validate_formulas','tc_settings_formula_guard','tc_save_formulas')) loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);end loop;end $$;
grant execute on function public.tc_save_formulas(jsonb,bigint) to authenticated;
-- Re-evaluate valuation only. Earned and spent totals remain unchanged.
update public.tc_settings set formulas=formulas where id=1;
commit;
