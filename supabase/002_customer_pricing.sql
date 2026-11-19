-- Run AFTER 001_teracoin.sql. Safe to rerun; does not import or replace stock rows.
begin;
alter table public.tc_profiles add column if not exists price_column text;
-- Approved numeric sale-price columns are discovered from the existing stock_profit schema.
create or replace function public.tc_price_columns() returns table(column_name text)
language plpgsql stable security definer set search_path='' as $$ begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 return query select c.column_name::text from information_schema.columns c
 where c.table_schema='public' and c.table_name='stock_profit' and c.column_name like '%price%'
 and c.data_type in ('numeric','bigint','integer','smallint','double precision','real') order by c.ordinal_position;
end $$;
create or replace function public.tc_set_customer_price(profile_id uuid,price_column text) returns void
language plpgsql security definer set search_path='' as $$ begin
 if public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if price_column is not null and not exists(select 1 from public.tc_price_columns() c where c.column_name=tc_set_customer_price.price_column) then raise exception 'Invalid price column';end if;
 update public.tc_profiles p set price_column=tc_set_customer_price.price_column where p.id=profile_id and p.role='customer';
 if not found then raise exception 'Customer profile not found';end if;
end $$;
-- Customers never receive stock_profit.*: their assigned price is extracted on the server.
create or replace function public.tc_catalog(page_offset integer default 0,page_size integer default 200)
returns table(id uuid,main text,product text,model text,qty bigint,unit_price numeric,price_tier text)
language plpgsql stable security definer set search_path='' as $$ declare tier text;begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer only';end if;
 if page_offset is null or page_offset<0 or page_size is null or page_size<1 or page_size>200 then raise exception 'Invalid page';end if;
 select p.price_column into tier from public.tc_profiles p where p.id=auth.uid();
 if tier is null then return;end if;
 return query select s.id,s.main,s.product,s.model,s."Qty",(to_jsonb(s)->>tier)::numeric,tier
 from public.stock_profit s where s.active and (to_jsonb(s)->>tier) is not null order by s.id limit page_size offset page_offset;
end $$;
-- Defense in depth: even approved customers cannot query the raw cost/price table.
drop policy if exists tc_stock_read on public.stock_profit;
create policy tc_stock_read on public.stock_profit for select to authenticated using(public.tc_role() in ('admin','viewer'));
revoke all on function public.tc_price_columns(),public.tc_set_customer_price(uuid,text),public.tc_catalog(integer,integer) from public,anon,authenticated;
grant execute on function public.tc_price_columns(),public.tc_set_customer_price(uuid,text),public.tc_catalog(integer,integer) to authenticated;
commit;
