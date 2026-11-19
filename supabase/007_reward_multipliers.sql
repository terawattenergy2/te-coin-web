-- Run AFTER 004_configurable_formulas.sql. Includes the 006 setup if not installed yet.
-- Both 005 and a separate 006 run are optional. Run this entire file.
-- Redemption model: reward value in THB * redemption B = TC (ceil to 0.01 TC).
-- New A/B/C earning model and separate reward D/reserve assumptions.
-- Rerunnable: first installation archives old formulas/settings; subsequent runs preserve edits.
-- Historical ledger amounts and snapshots are never rewritten. Outstanding liability is revalued.
begin;
alter table public.tc_settings add column if not exists reward_formula_version integer not null default 0;
alter table public.tc_settings add column if not exists reward_previous_formulas jsonb;
alter table public.tc_rewards add column if not exists redemption_b numeric(16,6);
alter table public.tc_settings add column if not exists membership_version integer not null default 1;
alter table public.tc_settings add column if not exists membership_config jsonb not null default '{}';
alter table public.tc_settings add column if not exists membership_previous_settings jsonb;
alter table public.tc_rewards add column if not exists redemption_d numeric(12,4);
alter table public.tc_rewards add column if not exists win_rate numeric(8,6);
-- Prevent the old guard from evaluating new inputs before the new context exists (transactional DDL).
drop trigger if exists tc_formula_guard on public.tc_settings;
drop trigger if exists tc_validate_reward_cost on public.tc_rewards;
update public.tc_rewards set redemption_d=case option when 1 then 1.05 when 2 then 0.50 when 3 then 0.75 when 4 then 1.15 end where redemption_d is null;
alter table public.tc_rewards alter column redemption_d set not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='tc_redemption_b_valid' and conrelid='public.tc_rewards'::regclass) then alter table public.tc_rewards add constraint tc_redemption_b_valid check(redemption_b is null or (redemption_b>0 and redemption_b<=100000));end if;
 if not exists(select 1 from pg_constraint where conname='tc_redemption_d_valid' and conrelid='public.tc_rewards'::regclass) then alter table public.tc_rewards add constraint tc_redemption_d_valid check(redemption_d>0 and redemption_d<=100000);end if;
 if not exists(select 1 from pg_constraint where conname='tc_reward_win_rate_valid' and conrelid='public.tc_rewards'::regclass) then alter table public.tc_rewards add constraint tc_reward_win_rate_valid check(win_rate is null or win_rate between 0 and 1);end if;
end $$;
create or replace function public.tc_formula_context(product jsonb,settings jsonb,extra jsonb default '{}') returns jsonb
language plpgsql immutable set search_path='' as $$ declare ctx jsonb:='{}';r record;cfg jsonb:=settings->'membership_config';g jsonb;begin
 for r in select key,value from jsonb_each(product) loop if jsonb_typeof(r.value)='number' then ctx:=ctx||jsonb_build_object(r.key,r.value,'raw_'||r.key,r.value);end if;end loop;
 g:=cfg->'groups'->(product->>'product');
 return ctx||jsonb_build_object('quantity',1,'y',settings->'y','commission_rate',coalesce(nullif(g->'commission','null'),settings->'commission'),'baht_per_tc',settings->'baht_per_tc','success_rate',settings->'success_rate','value_baht',800,'reward_y',1,'balance_tc',24500,'total_earn',32000,'used_tc',7500,
 'sale_unit_price',coalesce(product->'epc_price','0'::jsonb),'base_cost',coalesce(product->coalesce(cfg->>'base_cost_column','tier_2_price'),'0'::jsonb),'group_multiplier',coalesce(nullif(g->'b','null'),settings->'y'),'redemption_d',1,'redemption_b',1)||extra;
end $$;
create or replace function public.tc_validate_formulas(rules jsonb,settings jsonb) returns void
language plpgsql set search_path='' as $$ declare k text;r record;ctx jsonb;v numeric;core text[]:=array['commission_amount','gross_margin','earned_tc','reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4','tc_value','liability_amount','lucky_rate'];begin
 if jsonb_typeof(rules) is distinct from 'object' or length(rules::text)>24000 or (select count(*) from jsonb_object_keys(rules))>64 then raise exception 'Invalid formula collection';end if;
 foreach k in array core loop if not(rules ? k) then raise exception 'Required formula: %',k;end if;end loop;
 for k in select jsonb_object_keys(rules) loop
  if k !~ '^[A-Za-z_][A-Za-z_0-9]{0,62}$' or k like 'raw\_%' escape '\' or k in ('sale_unit_price','base_cost','group_multiplier','redemption_d','redemption_b','__proto__','prototype','constructor','quantity','y','commission_rate','baht_per_tc','success_rate','value_baht','reward_y','balance_tc','total_earn','used_tc','Qty','qty','id','main','model','product','active') then raise exception 'Reserved/invalid output: %',k;end if;
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
  ctx:=public.tc_formula_context('{}',settings,jsonb_build_object('value_baht',r.value_baht,'reward_y',r.y,'redemption_d',r.redemption_d,'redemption_b',coalesce(r.redemption_b,(settings->'membership_config'->'reward_b'->>r.option::text)::numeric,1)));
  v:=public.tc_formula_result('reward_tc_'||r.option,rules,ctx);if v<=0 then raise exception 'Redemption TC must be positive';end if;
 end loop;
 -- Validate all four reward roots even when one option has no catalog entries.
 foreach k in array array['reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4'] loop if public.tc_formula_result(k,rules,public.tc_formula_context('{}',settings))<=0 then raise exception 'Invalid redemption formula';end if;end loop;
end $$;

create or replace function public.tc_reward_cost(reward jsonb,settings jsonb) returns numeric language plpgsql immutable set search_path='' as $$ declare d numeric;b numeric;cost numeric;begin
 d:=(reward->>'redemption_d')::numeric;
 if d is null or d<=0 then raise exception 'D must be positive';end if;
 b:=coalesce((reward->>'redemption_b')::numeric,(settings->'membership_config'->'reward_b'->>(reward->>'option'))::numeric,1);
 if b<=0 or b>100000 then raise exception 'Redemption B must be positive';end if;
 cost:=ceil(public.tc_formula_result('reward_tc_'||(reward->>'option'),settings->'formulas',public.tc_formula_context('{}',settings,jsonb_build_object('value_baht',reward->'value_baht','reward_y',reward->'y','redemption_d',d,'redemption_b',b)))*100)/100;
 if cost is null or cost<=0 or cost>1e15 then raise exception 'Reward TC out of range';end if;return cost;
end $$;
create or replace function public.tc_reward_cost_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare s public.tc_settings;rate numeric;begin
 select * into s from public.tc_settings where id=1 for share;
 perform public.tc_reward_cost(to_jsonb(new),to_jsonb(s));
 rate:=public.tc_formula_result('lucky_rate',s.formulas,public.tc_formula_context('{}',to_jsonb(s),jsonb_build_object('success_rate',coalesce(new.win_rate,s.success_rate))));
 if rate<0 or rate>1 then raise exception 'Invalid Lucky Draw probability';end if;return new;
end $$;
create or replace function public.tc_settings_formula_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare r record;v jsonb;cfg jsonb:=new.membership_config;k text;rate numeric;begin
 if new.y<0 or new.y>100 or new.commission<0 or new.commission>1 or new.baht_per_tc<=0 or new.baht_per_tc>100000 or new.success_rate<0 or new.success_rate>1 then raise exception 'Invalid membership assumptions';end if;
 if jsonb_typeof(cfg) is distinct from 'object' or length(cfg::text)>100000 or jsonb_typeof(cfg->'groups') is distinct from 'object' then raise exception 'Invalid group settings';end if;
 if not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='stock_profit' and c.column_name=cfg->>'base_cost_column' and c.data_type in ('numeric','bigint','integer','smallint','double precision','real') and (c.column_name like '%cost%' or c.column_name like '%price%')) then raise exception 'Invalid base cost column';end if;
 for k,v in select key,value from jsonb_each(cfg->'groups') loop
  if length(k)>200 or jsonb_typeof(v)<>'object' then raise exception 'Invalid product group';end if;
  if v ? 'b' and v->'b'<>'null'::jsonb then if jsonb_typeof(v->'b')<>'number' or (v->>'b')::numeric<0 or (v->>'b')::numeric>100 then raise exception 'Invalid group B';end if;end if;
  if v ? 'commission' and v->'commission'<>'null'::jsonb then if jsonb_typeof(v->'commission')<>'number' or (v->>'commission')::numeric<0 or (v->>'commission')::numeric>1 then raise exception 'Invalid group commission';end if;end if;
 end loop;
 if cfg ? 'reward_b' then
  if jsonb_typeof(cfg->'reward_b') is distinct from 'object' or (select count(*) from jsonb_object_keys(cfg->'reward_b'))<>4 then raise exception 'Four reward B values required';end if;
  foreach k in array array['1','2','3','4'] loop
   v:=cfg->'reward_b'->k;
   if jsonb_typeof(v) is distinct from 'number' or (v::text)::numeric<=0 or (v::text)::numeric>100000 then raise exception 'Invalid reward B: %',k;end if;
  end loop;
 end if;
 perform public.tc_validate_formulas(new.formulas,to_jsonb(new));
 for r in select * from public.tc_rewards loop
  perform public.tc_reward_cost(to_jsonb(r),to_jsonb(new));
  rate:=public.tc_formula_result('lucky_rate',new.formulas,public.tc_formula_context('{}',to_jsonb(new),jsonb_build_object('success_rate',coalesce(r.win_rate,new.success_rate))));
  if rate<0 or rate>1 then raise exception 'Invalid Lucky Draw probability';end if;
 end loop;return new;
end $$;
update public.tc_settings s set membership_previous_settings=to_jsonb(s),membership_version=2,membership_config='{"base_cost_column": "tier_2_price", "groups": {"SigenStor Battery": {"b": 0.5}, "SigenStor Inverter": {"b": 0.7}, "SigenStor Neo Inverter": {"b": 0.2}, "SigenStor Neo Battery": {"b": 0.2}}}'::jsonb,baht_per_tc=0.60,formulas=(formulas - array['commission_amount','gross_margin','earned_tc','reward_tc_1','reward_tc_2','reward_tc_3','reward_tc_4','tc_value','liability_amount','lucky_rate']) || '{"commission_amount": {"op": "mul", "args": [{"var": "sale_unit_price"}, {"var": "commission_rate"}]}, "gross_margin": {"op": "sub", "args": [{"op": "sub", "args": [{"var": "sale_unit_price"}, {"var": "base_cost"}]}, {"var": "commission_amount"}]}, "earned_tc": {"op": "round", "args": [{"op": "max", "args": [{"value": "0"}, {"op": "mul", "args": [{"op": "mul", "args": [{"var": "gross_margin"}, {"var": "quantity"}]}, {"var": "group_multiplier"}]}]}, {"value": "2"}]}, "reward_tc_1": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "div", "args": [{"var": "value_baht"}, {"var": "redemption_d"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_2": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "div", "args": [{"var": "value_baht"}, {"var": "redemption_d"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_3": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "div", "args": [{"var": "value_baht"}, {"var": "redemption_d"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_4": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "div", "args": [{"var": "value_baht"}, {"var": "redemption_d"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "tc_value": {"op": "mul", "args": [{"var": "balance_tc"}, {"var": "baht_per_tc"}]}, "liability_amount": {"var": "tc_value"}, "lucky_rate": {"var": "success_rate"}}'::jsonb,formula_revision=formula_revision+1 where id=1 and membership_version<2;
create trigger tc_formula_guard before update on public.tc_settings for each row execute function public.tc_settings_formula_guard();
create trigger tc_validate_reward_cost before insert or update on public.tc_rewards for each row execute function public.tc_reward_cost_guard();
grant update(membership_config) on public.tc_settings to authenticated;
-- Price, commission and quantity are supplied by an admin; B/cost/rules come from locked server settings.
create or replace function public.tc_record_sale(customer text,sale_reference text,items jsonb,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;p public.stock_profit;c public.tera_coin_customer;line jsonb;lines jsonb:='[]';q numeric;price numeric;rate numeric;ctx jsonb;gross numeric;comm numeric;coins numeric;total numeric:=0;total_a numeric:=0;begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if trim(coalesce(sale_reference,''))='' or length(sale_reference)>200 or request_id is null then raise exception 'Reference/request ID required';end if;
 if jsonb_typeof(items) is distinct from 'array' then raise exception 'Items must be an array';end if;
 if jsonb_array_length(items) not between 1 and 100 then raise exception 'Sale requires 1..100 items';end if;
 select * into s from public.tc_settings where id=1 for share;
 if s.membership_version<>2 then raise exception 'Install membership model first';end if;
 -- Lock all products in a consistent order, then the customer, to keep multi-line bills atomic.
 perform p2.id from public.stock_profit p2 where p2.id in (select (x->>'product_id')::uuid from jsonb_array_elements(items)x) order by p2.id for update;
 select * into c from public.tera_coin_customer where customer_id=customer for update;
 if not found then raise exception 'Customer not found';end if;
 for line in select value from jsonb_array_elements(items) loop
  if jsonb_typeof(line)<>'object' or jsonb_typeof(line->'quantity') is distinct from 'number' or jsonb_typeof(line->'sale_unit_price') is distinct from 'number' or jsonb_typeof(line->'commission_rate') is distinct from 'number' then raise exception 'Invalid sale inputs';end if;
  q:=(line->>'quantity')::numeric;price:=(line->>'sale_unit_price')::numeric;rate:=(line->>'commission_rate')::numeric;
  if q<>trunc(q) or q not between 1 and 100000 or price not between 0 and 1e12 or rate not between 0 and 1 then raise exception 'Invalid quantity/price/commission';end if;
  select * into p from public.stock_profit where id=(line->>'product_id')::uuid;
  if not found or not p.active then raise exception 'Product unavailable';end if;
  if coalesce(p."Qty",0)<q then raise exception 'Insufficient stock';end if;
  if jsonb_typeof(to_jsonb(p)->(s.membership_config->>'base_cost_column')) is distinct from 'number' or (to_jsonb(p)->>(s.membership_config->>'base_cost_column'))::numeric<0 then raise exception 'Invalid base cost';end if;
  ctx:=public.tc_formula_context(to_jsonb(p),to_jsonb(s),jsonb_build_object('quantity',q,'sale_unit_price',price,'commission_rate',rate,'balance_tc',c.banlance_tc,'total_earn',c.total_earn,'used_tc',c.used_tc));
  comm:=public.tc_formula_result('commission_amount',s.formulas,ctx);gross:=public.tc_formula_result('gross_margin',s.formulas,ctx);coins:=round(public.tc_formula_result('earned_tc',s.formulas,ctx),2);
  if coins<0 or coins>1e15 then raise exception 'Invalid earned TC';end if;
  total:=total+coins;total_a:=total_a+gross*q;
  lines:=lines||jsonb_build_array(jsonb_build_object('product',to_jsonb(p),'quantity',q,'sale_unit_price',price,'commission_rate',rate,'commission_total',comm*q,'base_cost',ctx->'base_cost','group_b',ctx->'group_multiplier','gross_margin_a',gross*q,'earned_tc',coins));
  update public.stock_profit set "Qty"="Qty"-q where id=p.id;
 end loop;
 insert into public.tc_ledger(customer_id,amount,description,status,reference,request_id,snapshot,created_by) values(customer,total,'ยอดขาย '||trim(sale_reference),'earned',trim(sale_reference),request_id,jsonb_build_object('lines',lines,'gross_margin_a',total_a,'earned_tc',total,'settings',to_jsonb(s)),auth.uid());
 update public.tera_coin_customer set total_earn=total_earn+total where customer_id=customer;
 return jsonb_build_object('tc',total,'gross_margin_a',total_a,'lines',lines);
end $$;
-- Old clients must not silently award points using EPC as an actual selling price.
create or replace function public.tc_earn(customer text,product_id uuid,quantity integer,sale_reference text) returns jsonb language plpgsql security definer set search_path='' as $$ begin raise exception 'Use the updated sale form with actual selling price (tc_record_sale)';end $$;
create or replace function public.tc_redeem(reward_id uuid,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;r public.tc_rewards;c public.tera_coin_customer;cost numeric;won boolean;draw numeric;rate numeric;begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer only';end if;
 if request_id is null then raise exception 'Request ID required';end if;
 select * into s from public.tc_settings where id=1 for share;
 select * into r from public.tc_rewards where id=reward_id for update;
 if not found or not r.active or r.stock<=0 then raise exception 'Reward unavailable';end if;
 select * into c from public.tera_coin_customer where auth_user_id=auth.uid() for update;
 if not found then raise exception 'Customer not found';end if;
 cost:=public.tc_reward_cost(to_jsonb(r),to_jsonb(s));
 rate:=public.tc_formula_result('lucky_rate',s.formulas,public.tc_formula_context('{}',to_jsonb(s),jsonb_build_object('success_rate',coalesce(r.win_rate,s.success_rate))));
 if rate<0 or rate>1 then raise exception 'Lucky Draw rate must be 0..1';end if;
 if c.banlance_tc<cost then raise exception 'Insufficient TeraCoin';end if;
 draw:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint::numeric/4294967296;
 won:=r.option<>3 or draw<rate;
 insert into public.tc_ledger(customer_id,amount,description,status,request_id,snapshot,created_by) values(c.customer_id,-cost,r.name,case when won then 'pending' else 'no_prize' end,request_id,jsonb_build_object('reward',to_jsonb(r),'settings',to_jsonb(s),'won',won,'spent_tc',cost,'redemption_d',r.redemption_d,'redemption_b',coalesce(r.redemption_b,(s.membership_config->'reward_b'->>r.option::text)::numeric,1),'win_rate',rate),auth.uid());
 update public.tera_coin_customer set used_tc=used_tc+cost where customer_id=c.customer_id;
 update public.tc_rewards set stock=stock-1 where id=reward_id;
 return jsonb_build_object('won',won,'spent_tc',cost);end $$;
revoke all on function public.tc_record_sale(text,text,jsonb,uuid),public.tc_reward_cost(jsonb,jsonb),public.tc_reward_cost_guard(),public.tc_settings_formula_guard() from public,anon,authenticated;
grant execute on function public.tc_record_sale(text,text,jsonb,uuid) to authenticated;

-- First installation explicitly adopts the requested multiplication rule for all four reward types.
-- Existing earned/spent amounts and old transaction snapshots remain unchanged.
update public.tc_settings set reward_previous_formulas=formulas,
 membership_config=jsonb_set(membership_config,'{reward_b}','{"1":1,"2":1,"3":1,"4":1}'::jsonb),
 formulas=formulas || '{"reward_tc_1": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "mul", "args": [{"var": "value_baht"}, {"var": "redemption_b"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_2": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "mul", "args": [{"var": "value_baht"}, {"var": "redemption_b"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_3": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "mul", "args": [{"var": "value_baht"}, {"var": "redemption_b"}]}, {"value": "100"}]}]}, {"value": "100"}]}, "reward_tc_4": {"op": "div", "args": [{"op": "ceil", "args": [{"op": "mul", "args": [{"op": "mul", "args": [{"var": "value_baht"}, {"var": "redemption_b"}]}, {"value": "100"}]}]}, {"value": "100"}]}}'::jsonb,reward_formula_version=1,formula_revision=formula_revision+1
 where id=1 and reward_formula_version=0;
create or replace function public.tc_save_reward_formulas(rules jsonb,reward_bs jsonb,expected_revision bigint) returns bigint
language plpgsql security definer set search_path='' as $$ declare s public.tc_settings;begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 select * into s from public.tc_settings where id=1 for update;
 if s.reward_formula_version<>1 then raise exception 'Install 007_reward_multipliers.sql first';end if;
 if expected_revision is null or s.formula_revision<>expected_revision then raise exception 'Formulas changed by another admin; refresh first';end if;
 -- The settings trigger checks all four multipliers, every formula, and every existing reward.
 update public.tc_settings set formulas=rules,membership_config=jsonb_set(membership_config,'{reward_b}',reward_bs),formula_revision=formula_revision+1 where id=1 returning formula_revision into expected_revision;
 return expected_revision;
end $$;
revoke all on function public.tc_save_reward_formulas(jsonb,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.tc_save_reward_formulas(jsonb,jsonb,bigint) to authenticated;

-- Validate rules and new assumptions, and revalue outstanding liability only.
update public.tc_settings set formulas=formulas where id=1;
notify pgrst,'reload schema';
commit;
