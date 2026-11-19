begin;
-- Account deletion releases the login email. Financial/company history survives.
alter table public.tc_account_events add column account_snapshot jsonb not null default '{}'::jsonb;
alter table public.tc_profiles drop constraint tc_profiles_id_fkey,add constraint tc_profiles_id_fkey foreign key(id) references auth.users(id) on delete cascade;
alter table public.tera_coin_customer drop constraint tera_coin_customer_auth_user_id_fkey,add constraint tera_coin_customer_auth_user_id_fkey foreign key(auth_user_id) references auth.users(id) on delete set null;
alter table public.tc_ledger drop constraint tc_ledger_created_by_fkey,add constraint tc_ledger_created_by_fkey foreign key(created_by) references auth.users(id) on delete set null;
alter table public.tc_epc_requests drop constraint tc_epc_requests_profile_id_fkey,add constraint tc_epc_requests_profile_id_fkey foreign key(profile_id) references auth.users(id) on delete cascade;
alter table public.tc_epc_requests drop constraint tc_epc_requests_approved_by_fkey,add constraint tc_epc_requests_approved_by_fkey foreign key(approved_by) references auth.users(id) on delete set null;
create or replace function tc_integrations.manage_epc(profile uuid,operation text,expected timestamptz,confirm_name text) returns jsonb language plpgsql security definer set search_path='' as $$
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
 insert into public.tc_account_events(profile_id,actor_id,operation,previous_status,new_status,account_snapshot) values(profile,auth.uid(),operation,p.account_status,next_status,jsonb_build_object('profile',to_jsonb(p),'customer_ids',(select jsonb_agg(customer_id) from public.tera_coin_customer where auth_user_id=profile)));
 if operation='delete' then delete from auth.users where id=profile;end if;
 return jsonb_build_object('status',next_status);
end$$;
create or replace function tc_integrations.epc_approve(profile uuid,expected timestamptz,src text,env text,contact jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.tc_epc_requests; c public.tera_coin_customer; linked public.tc_flow_epcs; historical public.tera_coin_customer; cid text:=contact->>'id';
begin
 if auth.uid() is null or public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if env not in ('test','v1') or env is null or nullif(src,'') is null or cid !~ '^[0-9]+$' or cid is null or nullif(contact->>'name','') is null then raise exception 'Invalid verified contact';end if;
 if not exists(select 1 from public.tc_profiles where id=profile and role='customer' and account_status='active') then raise exception 'Active EPC customer required';end if;
 select * into r from public.tc_epc_requests where profile_id=profile for update;
 if not found or r.status<>'pending' or r.updated_at is distinct from expected then raise exception 'Request changed: refresh before approval';end if;
 if r.tax_id is distinct from contact->>'tax' or r.branch_code is distinct from contact->>'branch' then raise exception 'Tax/branch does not match FlowAccount';end if;
 perform pg_advisory_xact_lock(hashtextextended(src||':'||env||':company:'||cid,0));
 select * into c from public.tera_coin_customer where auth_user_id=profile for update;
 if not found then raise exception 'Customer account not found';end if;
 if exists(select 1 from public.tc_flow_epcs where source=src and environment=env and customer_id=c.customer_id and contact_id<>cid) then raise exception 'Account already linked to another company';end if;
 select * into linked from public.tc_flow_epcs where source=src and environment=env and contact_id=cid for update;
 if found and linked.customer_id<>c.customer_id then
  select * into historical from public.tera_coin_customer where customer_id=linked.customer_id for update;
  if historical.auth_user_id is not null then raise exception 'Company already linked to another account';end if;
  if c.total_earn<>0 or c.used_tc<>0 or exists(select 1 from public.tc_ledger where customer_id=c.customer_id) or exists(select 1 from public.tc_flow_epcs where customer_id=c.customer_id) or exists(select 1 from public.tc_flow_imports where customer_id=c.customer_id) or exists(select 1 from public.tc_flow_previews where customer_id=c.customer_id) then raise exception 'New account has history: reconcile before company transfer';end if;
  delete from public.tera_coin_customer where customer_id=c.customer_id;
  update public.tera_coin_customer set auth_user_id=profile where customer_id=historical.customer_id returning * into c;
 end if;
 insert into public.tc_flow_epcs(source,environment,contact_id,company_name,tax_id,branch,customer_id) values(src,env,cid,contact->>'name',r.tax_id,r.branch_code,c.customer_id)
 on conflict(source,environment,contact_id) do nothing;
 update public.tc_epc_requests set status='approved',approved_contact_id=cid,approved_source=src,approved_environment=env,approved_by=auth.uid(),approved_at=now() where profile_id=profile;
 update public.tera_coin_customer set customer_name=contact->>'name' where customer_id=c.customer_id;
 return jsonb_build_object('status','approved','customer_id',c.customer_id,'contact_id',cid);
end$$;

commit;
