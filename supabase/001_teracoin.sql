-- Run once in Supabase SQL Editor. Existing rows are preserved.
-- Migration is transactional: any incompatible existing data rolls the entire script back.
begin;
create extension if not exists pgcrypto;
create table if not exists public.stock_profit (id uuid primary key default gen_random_uuid(), main text, product text, model text, "Qty" bigint default 0, tier_2_price numeric(18,2), tier_2_cost numeric(18,2), epc_price numeric(18,2));
alter table public.stock_profit add column if not exists id uuid default gen_random_uuid();
create unique index if not exists tc_stock_id on public.stock_profit(id);
alter table public.stock_profit add column if not exists active boolean not null default true;
-- Imported currency columns in the screenshot are text. Normalize every numeric price/profit/margin field.
do $$ declare c record; begin
 for c in select column_name from information_schema.columns where table_schema='public' and table_name='stock_profit' and data_type in ('text','character varying') and column_name not in ('main','product','model') loop
  execute format('alter table public.stock_profit alter column %I type numeric(18,4) using nullif(regexp_replace(%I, ''[,%%[:space:]]'', '''', ''g''), '''')::numeric',c.column_name,c.column_name);
 end loop;
end $$;
create table if not exists public.tera_coin_customer(customer_id text primary key default gen_random_uuid()::text, created_at timestamptz not null default now(), customer_name text not null, total_earn numeric(18,2) not null default 0, used_tc numeric(18,2) not null default 0, banlance_tc numeric(18,2) not null default 0, liability numeric(18,2) not null default 0);
alter table public.tera_coin_customer add column if not exists auth_user_id uuid unique references auth.users(id);
alter table public.tera_coin_customer alter column customer_id set default gen_random_uuid()::text;
alter table public.tera_coin_customer alter column created_at set default now();
alter table public.tera_coin_customer alter column total_earn type numeric(18,2), alter column total_earn set default 0,
 alter column used_tc type numeric(18,2), alter column used_tc set default 0,
 alter column banlance_tc type numeric(18,2), alter column banlance_tc set default 0,
 alter column liability type numeric(18,2), alter column liability set default 0;
update public.tera_coin_customer set total_earn=coalesce(total_earn,0),used_tc=coalesce(used_tc,0),banlance_tc=coalesce(total_earn,0)-coalesce(used_tc,0);
alter table public.tera_coin_customer add constraint tc_nonnegative check (total_earn>=0 and used_tc>=0 and banlance_tc>=0 and banlance_tc=total_earn-used_tc);
create table public.tc_profiles(id uuid primary key references auth.users(id),customer_name text,role text not null default 'customer' check(role in ('customer','viewer','admin')));
create table public.tc_settings(id integer primary key check(id=1),y numeric not null check(y>=0 and y<=10),commission numeric not null check(commission between 0 and 1),baht_per_tc numeric not null check(baht_per_tc>0),success_rate numeric not null check(success_rate between 0 and 1));
insert into public.tc_settings values(1,0.5,0.015,0.8,0.8);
create table public.tc_rewards(id uuid primary key default gen_random_uuid(), option integer not null check(option between 1 and 4), name text not null,description text,value_baht numeric not null check(value_baht>0),y numeric not null default 1 check(y>0),stock integer not null default 0 check(stock>=0),active boolean not null default true,prize_name text,prize_value_baht numeric not null default 0 check(prize_value_baht>=0));
insert into public.tc_rewards(option,name,description,value_baht,y,stock,prize_name,prize_value_baht) values
 (1,'Bundle Set','ชุดสินค้า Sigenergy',4000,1,20,'',0),
 (2,'Cashback / Voucher','Cashback, Credit note หรือเงินส่งเสริมการตลาด',800,1,100,'',0),
 (3,'Lucky Draw','ลุ้น Voucher มูลค่า 800 บาท • หักแต้มทุกครั้ง',80,1,100,'Voucher ส่งเสริมการตลาด',800),
 (4,'Sigenergy Discovery','ทัวร์โรงงาน เซี่ยงไฮ้ และซูโจว / 1 ที่นั่ง',55000,1,10,'',0);
create table public.tc_ledger(id uuid primary key default gen_random_uuid(),customer_id text not null references public.tera_coin_customer(customer_id),amount numeric(18,2) not null,description text not null,status text not null check(status in ('earned','pending','no_prize','fulfilled')),reference text unique,request_id uuid unique,snapshot jsonb not null default '{}',created_at timestamptz not null default now(),created_by uuid references auth.users(id));
create table public.tc_audit(id bigint generated always as identity primary key,table_name text,actor uuid,old_value jsonb,new_value jsonb,created_at timestamptz default now());
alter table public.stock_profit add constraint tc_valid_stock check (coalesce("Qty",0)>=0 and coalesce(tier_2_price,0)>=0 and coalesce(epc_price,0)>=0);
create function public.tc_role() returns text language sql stable security definer set search_path='' as $$ select role from public.tc_profiles where id=auth.uid() $$;
create function public.tc_sync_customer() returns trigger language plpgsql security definer set search_path='' as $$ begin new.banlance_tc:=new.total_earn-new.used_tc;new.liability:=round(new.banlance_tc*(select baht_per_tc from public.tc_settings where id=1),2);return new;end $$;
create trigger tc_customer_totals before insert or update on public.tera_coin_customer for each row execute function public.tc_sync_customer();
create function public.tc_revalue() returns trigger language plpgsql security definer set search_path='' as $$ begin update public.tera_coin_customer set liability=round(banlance_tc*new.baht_per_tc,2);return new;end $$;
create trigger tc_revalue_customers after update of baht_per_tc on public.tc_settings for each row execute function public.tc_revalue();
update public.tera_coin_customer set liability=round(banlance_tc*0.8,2);
create function public.tc_new_user() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.tc_profiles(id,customer_name) values(new.id,coalesce(new.raw_user_meta_data->>'customer_name',new.email));
 insert into public.tera_coin_customer(auth_user_id,customer_name,total_earn,used_tc) values(new.id,coalesce(new.raw_user_meta_data->>'customer_name',new.email),0,0);
 return new;end $$;
create trigger tc_on_signup after insert on auth.users for each row execute function public.tc_new_user();
insert into public.tc_profiles(id,customer_name) select id,coalesce(raw_user_meta_data->>'customer_name',email) from auth.users;
insert into public.tera_coin_customer(auth_user_id,customer_name,total_earn,used_tc) select u.id,coalesce(u.raw_user_meta_data->>'customer_name',u.email),0,0 from auth.users u where not exists(select 1 from public.tera_coin_customer c where c.auth_user_id=u.id);
create function public.tc_audit_change() returns trigger language plpgsql security definer set search_path='' as $$ begin insert into public.tc_audit(table_name,actor,old_value,new_value) values(tg_table_name,auth.uid(),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);return coalesce(new,old);end $$;
do $$ declare t text; begin foreach t in array array['stock_profit','tc_settings','tc_rewards','tc_profiles'] loop execute format('create trigger tc_audit_trigger after insert or update or delete on public.%I for each row execute function public.tc_audit_change()',t);end loop;end $$;
-- Replace pre-existing policies on the two imported tables, because permissive policies combine with OR.
do $$ declare p record;t text;begin
 for p in select tablename,policyname from pg_policies where schemaname='public' and tablename in ('stock_profit','tera_coin_customer') loop execute format('drop policy %I on public.%I',p.policyname,p.tablename);end loop;
 foreach t in array array['stock_profit','tera_coin_customer','tc_profiles','tc_settings','tc_rewards','tc_ledger','tc_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;end $$;
create policy tc_stock_read on public.stock_profit for select to authenticated using(public.tc_role() in ('admin','viewer'));
create policy tc_stock_write on public.stock_profit for all to authenticated using(public.tc_role()='admin') with check(public.tc_role()='admin');
create policy tc_customer_read on public.tera_coin_customer for select to authenticated using(auth_user_id=auth.uid() or public.tc_role() in ('admin','viewer'));
create policy tc_profile_read on public.tc_profiles for select to authenticated using(id=auth.uid() or public.tc_role()='admin');
create policy tc_settings_read on public.tc_settings for select to authenticated using(true);
create policy tc_settings_write on public.tc_settings for update to authenticated using(public.tc_role()='admin') with check(public.tc_role()='admin');
create policy tc_rewards_read on public.tc_rewards for select to authenticated using(active or public.tc_role() in ('admin','viewer'));
create policy tc_rewards_write on public.tc_rewards for all to authenticated using(public.tc_role()='admin') with check(public.tc_role()='admin');
create policy tc_ledger_read on public.tc_ledger for select to authenticated using(public.tc_role() in ('admin','viewer') or exists(select 1 from public.tera_coin_customer c where c.customer_id=tc_ledger.customer_id and c.auth_user_id=auth.uid()));
create policy tc_audit_read on public.tc_audit for select to authenticated using(public.tc_role()='admin');
grant insert,update on public.stock_profit,public.tc_rewards to authenticated;
grant update on public.tc_settings to authenticated;
create function public.tc_earn(customer text,product_id uuid,quantity integer,sale_reference text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;p public.stock_profit;c public.tera_coin_customer;gross numeric;coins numeric;begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if quantity is null or quantity<=0 or trim(coalesce(sale_reference,''))='' then raise exception 'Invalid quantity/reference';end if;
 select * into s from public.tc_settings where id=1 for share;
 select * into p from public.stock_profit where id=product_id for update;
 if not found or not p.active then raise exception 'Product unavailable';end if;
 if coalesce(p."Qty",0)<quantity then raise exception 'Insufficient stock';end if;
 if p.tier_2_price is null or p.epc_price is null or p.tier_2_price<0 or p.epc_price<0 then raise exception 'Invalid prices';end if;
 select * into c from public.tera_coin_customer where customer_id=customer for update;
 if not found then raise exception 'Customer not found';end if;
 gross:=p.epc_price-p.tier_2_price-p.tier_2_price*s.commission;
 coins:=round(greatest(0,gross*quantity*s.y),2);
 insert into public.tc_ledger(customer_id,amount,description,status,reference,snapshot,created_by) values(customer,coins,p.model||' × '||quantity,'earned',trim(sale_reference),jsonb_build_object('product',to_jsonb(p),'quantity',quantity,'gross_per_unit',gross,'settings',to_jsonb(s)),auth.uid());
 update public.tera_coin_customer set total_earn=total_earn+coins where customer_id=customer;
 update public.stock_profit set "Qty"="Qty"-quantity where id=product_id;
 return jsonb_build_object('tc',coins);end $$;
create function public.tc_redeem(reward_id uuid,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.tc_settings;r public.tc_rewards;c public.tera_coin_customer;cost numeric;won boolean;draw numeric;begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer only';end if;
 if request_id is null then raise exception 'Request ID required';end if;
 select * into s from public.tc_settings where id=1 for share;
 select * into r from public.tc_rewards where id=reward_id for update;
 if not found or not r.active or r.stock<=0 then raise exception 'Reward unavailable';end if;
 select * into c from public.tera_coin_customer where auth_user_id=auth.uid() for update;
 if not found then raise exception 'Customer not found';end if;
 cost:=ceil(r.value_baht/(s.baht_per_tc*r.y));
 if c.banlance_tc<cost then raise exception 'Insufficient TeraCoin';end if;
 -- Secure random result is generated only on the server. Every attempt spends TC.
 draw:=('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint::numeric/4294967296;
 won:=r.option<>3 or draw<s.success_rate;
 insert into public.tc_ledger(customer_id,amount,description,status,request_id,snapshot,created_by) values(c.customer_id,-cost,r.name,case when won then 'pending' else 'no_prize' end,request_id,jsonb_build_object('reward',to_jsonb(r),'settings',to_jsonb(s),'won',won),auth.uid());
 update public.tera_coin_customer set used_tc=used_tc+cost where customer_id=c.customer_id;
 update public.tc_rewards set stock=stock-1 where id=reward_id;
 return jsonb_build_object('won',won,'spent_tc',cost);end $$;
create function public.tc_fulfill(entry_id uuid) returns void language plpgsql security definer set search_path='' as $$ begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 update public.tc_ledger set status='fulfilled' where id=entry_id and status='pending';
 if not found then raise exception 'Pending redemption not found';end if;
 insert into public.tc_audit(table_name,actor,new_value) values('tc_ledger',auth.uid(),jsonb_build_object('entry',entry_id,'status','fulfilled'));end $$;
create function public.tc_set_role(profile_id uuid,new_role text) returns void language plpgsql security definer set search_path='' as $$ begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if profile_id=auth.uid() then raise exception 'Cannot change own role';end if;
 if new_role not in ('admin','viewer','customer') or new_role is null then raise exception 'Invalid role';end if;
 update public.tc_profiles set role=new_role where id=profile_id;
 if not found then raise exception 'User not found';end if;end $$;
-- Limit function execution explicitly (SECURITY DEFINER never trusts the client role).
revoke all on function public.tc_role(),public.tc_sync_customer(),public.tc_revalue(),public.tc_new_user(),public.tc_audit_change(),public.tc_earn(text,uuid,integer,text),public.tc_redeem(uuid,uuid),public.tc_fulfill(uuid),public.tc_set_role(uuid,text) from public,anon,authenticated;
grant execute on function public.tc_role(),public.tc_earn(text,uuid,integer,text),public.tc_redeem(uuid,uuid),public.tc_fulfill(uuid),public.tc_set_role(uuid,text) to authenticated;
commit;
-- Bootstrap first admin manually using their actual Auth user UUID (run separately):
-- update public.tc_profiles set role='admin' where id='AUTH_USER_UUID';
