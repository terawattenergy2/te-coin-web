begin;
alter table public.tc_profiles add column account_status text not null default 'active' check(account_status in ('active','suspended','deleted'));
alter table public.tc_profiles add column account_updated_at timestamptz not null default now();
create table public.tc_account_events(id uuid primary key default gen_random_uuid(),profile_id uuid not null,actor_id uuid not null,operation text not null,previous_status text not null,new_status text not null,created_at timestamptz not null default now());
alter table public.tc_account_events enable row level security;
revoke all on public.tc_account_events from public,anon,authenticated;
grant select on public.tc_account_events to authenticated;
create policy tc_account_events_admin on public.tc_account_events for select to authenticated using(public.tc_role()='admin');
create function tc_integrations.account_active() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.tc_profiles where id=auth.uid() and account_status='active')$$;
revoke all on function tc_integrations.account_active() from public,anon;
grant execute on function tc_integrations.account_active() to authenticated;
create or replace function public.tc_role() returns text language sql stable security definer set search_path='' as $$select role from public.tc_profiles where id=auth.uid() and account_status='active'$$;
-- Restrictive policies also stop still-valid access tokens from reading account data.
-- Own profile remains readable solely to explain the suspension/deletion to that user.
do $$declare t text;begin
 for t in select tablename from pg_tables where schemaname='public' and tablename in ('stock_profit','tera_coin_customer','tc_settings','tc_rewards','tc_ledger','tc_audit','tc_flow_epcs','tc_flow_product_map','tc_flow_imports','tc_flow_previews','tc_epc_requests','tc_account_events') loop
 execute format('create policy tc_active_account_required on public.%I as restrictive for all to authenticated using(tc_integrations.account_active()) with check(tc_integrations.account_active())',t);
 end loop;
end$$;
create function tc_integrations.manage_epc(profile uuid,operation text,expected timestamptz,confirm_name text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.tc_profiles; next_status text;
begin
 if auth.uid() is null or public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if profile=auth.uid() then raise exception 'Cannot manage own account';end if;
 if operation is null or operation not in ('suspend','resume','delete') then raise exception 'Invalid operation';end if;
 select * into p from public.tc_profiles where id=profile for update;
 if not found or p.role<>'customer' then raise exception 'EPC customer account required';end if;
 if p.account_updated_at is distinct from expected then raise exception 'Account changed: refresh before retry';end if;
 if p.account_status='deleted' then raise exception 'Account already deleted';end if;
 if operation='resume' and p.account_status<>'suspended' then raise exception 'Only suspended accounts can be resumed';end if;
 if operation='suspend' and p.account_status<>'active' then raise exception 'Only active accounts can be suspended';end if;
 if operation='delete' and (confirm_name is null or confirm_name is distinct from p.customer_name) then raise exception 'Company name confirmation required';end if;
 next_status:=case operation when 'suspend' then 'suspended' when 'resume' then 'active' else 'deleted' end;
 update public.tc_profiles set account_status=next_status,account_updated_at=clock_timestamp() where id=profile;
 insert into public.tc_account_events(profile_id,actor_id,operation,previous_status,new_status) values(profile,auth.uid(),operation,p.account_status,next_status);
 return jsonb_build_object('status',next_status);
end$$;
revoke all on function tc_integrations.manage_epc(uuid,text,timestamptz,text) from public,anon;
grant execute on function tc_integrations.manage_epc(uuid,text,timestamptz,text) to authenticated;
create function public.tc_manage_epc(profile uuid,operation text,expected timestamptz,confirm_name text default null) returns jsonb language sql security invoker set search_path='' as $$select tc_integrations.manage_epc(profile,operation,expected,confirm_name)$$;
revoke all on function public.tc_manage_epc(uuid,text,timestamptz,text) from public,anon;
grant execute on function public.tc_manage_epc(uuid,text,timestamptz,text) to authenticated;
commit;
