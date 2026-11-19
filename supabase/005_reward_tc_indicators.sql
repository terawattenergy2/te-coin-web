-- Run after 004_configurable_formulas.sql. Rerunnable; preserves existing reward costs at Indicator=1.
begin;
alter table public.tc_rewards add column if not exists tc_base numeric(18,4);
alter table public.tc_rewards add column if not exists tc_indicator numeric(12,4) not null default 1;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.tc_rewards'::regclass and conname='tc_reward_base_positive') then alter table public.tc_rewards add constraint tc_reward_base_positive check(tc_base is null or tc_base>0);end if;
 if not exists(select 1 from pg_constraint where conrelid='public.tc_rewards'::regclass and conname='tc_reward_indicator_positive') then alter table public.tc_rewards add constraint tc_reward_indicator_positive check(tc_indicator>0);end if;
end $$;
create or replace function public.tc_reward_cost(reward jsonb,settings jsonb) returns numeric language plpgsql immutable set search_path='' as $$ declare base numeric;indicator numeric;cost numeric;begin
 base:=(reward->>'tc_base')::numeric;
 if base is null then base:=public.tc_formula_result('reward_tc_'||(reward->>'option'),settings->'formulas',public.tc_formula_context('{}',settings,jsonb_build_object('value_baht',reward->'value_baht','reward_y',reward->'y')));end if;
 indicator:=coalesce((reward->>'tc_indicator')::numeric,1);
 if base is null or base<=0 or indicator<=0 or base>1e15 then raise exception 'TC base and indicator must be positive';end if;
 cost:=ceil(base*indicator);
 if cost<=0 or cost>1e15 then raise exception 'Reward TC out of range';end if;
 return cost;
end $$;
create or replace function public.tc_reward_cost_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare settings public.tc_settings;begin
 select * into settings from public.tc_settings where id=1 for share;
 perform public.tc_reward_cost(to_jsonb(new),to_jsonb(settings));return new;
end $$;
drop trigger if exists tc_validate_reward_cost on public.tc_rewards;
create trigger tc_validate_reward_cost before insert or update on public.tc_rewards for each row execute function public.tc_reward_cost_guard();
create or replace function public.tc_settings_formula_guard() returns trigger language plpgsql security definer set search_path='' as $$ declare r record;begin
 perform public.tc_validate_formulas(new.formulas,to_jsonb(new));
 for r in select * from public.tc_rewards loop perform public.tc_reward_cost(to_jsonb(r),to_jsonb(new));end loop;
 return new;
end $$;
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
 cost:=public.tc_reward_cost(to_jsonb(r),to_jsonb(s));
 if cost<=0 then raise exception 'Redemption TC must be positive';end if;
 rate:=public.tc_formula_result('lucky_rate',s.formulas,public.tc_formula_context('{}',to_jsonb(s)));
 if rate<0 or rate>1 then raise exception 'Lucky Draw rate must be 0..1';end if;
 if c.banlance_tc<cost then raise exception 'Insufficient TeraCoin';end if;
 -- Secure random result is generated only on the server. Every attempt spends TC.
 draw:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint::numeric/4294967296;
 won:=r.option<>3 or draw<rate;
 insert into public.tc_ledger(customer_id,amount,description,status,request_id,snapshot,created_by) values(c.customer_id,-cost,r.name,case when won then 'pending' else 'no_prize' end,request_id,jsonb_build_object('reward',to_jsonb(r),'settings',to_jsonb(s),'won',won,'spent_tc',cost,'tc_indicator',r.tc_indicator,'tc_base',r.tc_base,'resolved_base_tc',coalesce(r.tc_base,public.tc_formula_result('reward_tc_'||r.option,s.formulas,ctx))),auth.uid());
 update public.tera_coin_customer set used_tc=used_tc+cost where customer_id=c.customer_id;
 update public.tc_rewards set stock=stock-1 where id=reward_id;
 return jsonb_build_object('won',won,'spent_tc',cost);end $$;
revoke all on function public.tc_reward_cost(jsonb,jsonb),public.tc_reward_cost_guard() from public,anon,authenticated;
-- Read permissions and admin-only write policies on tc_rewards are unchanged.
-- Validate pre-existing rewards without altering their TC cost or historical transactions.
do $$ declare r record;s public.tc_settings;begin select * into s from public.tc_settings where id=1;for r in select * from public.tc_rewards loop perform public.tc_reward_cost(to_jsonb(r),to_jsonb(s));end loop;end $$;
commit;
