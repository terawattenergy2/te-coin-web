begin;
create table public.tc_epc_requests(
 profile_id uuid primary key references auth.users(id), company_name text not null,
 tax_id text not null check(tax_id ~ '^[0-9]{13}$'), branch_code text not null check(branch_code ~ '^[0-9]{5}$'),
 contact_phone text not null default '', status text not null default 'pending' check(status in ('pending','approved','rejected')),
 approved_contact_id text, approved_source text, approved_environment text, approved_by uuid references auth.users(id),
 approved_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.tc_epc_requests enable row level security;
revoke all on public.tc_epc_requests from public,anon,authenticated;
grant select on public.tc_epc_requests to authenticated;
create policy tc_epc_request_read on public.tc_epc_requests for select to authenticated using(profile_id=auth.uid() or public.tc_role()='admin');
create function tc_integrations.epc_signup_request() returns trigger language plpgsql security definer set search_path='' as $$
declare d jsonb:=new.raw_user_meta_data;
begin
 -- Signup metadata is an unverified claim. It can only create a pending request.
 if d->>'epc_tax_id' ~ '^[0-9]{13}$' and d->>'epc_branch_code' ~ '^[0-9]{5}$' and length(trim(d->>'customer_name')) between 2 and 200 then
 insert into public.tc_epc_requests(profile_id,company_name,tax_id,branch_code,contact_phone)
 values(new.id,trim(d->>'customer_name'),d->>'epc_tax_id',d->>'epc_branch_code',left(coalesce(d->>'epc_phone',''),40));
 end if;return new;
end$$;
revoke all on function tc_integrations.epc_signup_request() from public,anon,authenticated;
create trigger tc_z_epc_signup_request after insert on auth.users for each row execute function tc_integrations.epc_signup_request();
create function tc_integrations.epc_request(company text,tax text,branch text,phone text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.tc_role() is distinct from 'customer' then raise exception 'Customer login required';end if;
 if tax !~ '^[0-9]{13}$' or branch !~ '^[0-9]{5}$' or tax is null or branch is null or length(trim(company)) not between 2 and 200 or company is null or length(coalesce(phone,''))>40 then raise exception 'Invalid company/tax/branch';end if;
 perform pg_advisory_xact_lock(hashtextextended('epc-request:'||auth.uid()::text,0));
 perform 1 from public.tc_epc_requests where profile_id=auth.uid() for update;
 if exists(select 1 from public.tc_epc_requests where profile_id=auth.uid() and status='approved') or exists(select 1 from public.tc_flow_epcs e join public.tera_coin_customer c on c.customer_id=e.customer_id where c.auth_user_id=auth.uid()) then raise exception 'Company already linked: contact administrator';end if;
 insert into public.tc_epc_requests(profile_id,company_name,tax_id,branch_code,contact_phone) values(auth.uid(),trim(company),tax,branch,coalesce(phone,''))
 on conflict(profile_id) do update set company_name=excluded.company_name,tax_id=excluded.tax_id,branch_code=excluded.branch_code,contact_phone=excluded.contact_phone,status='pending',updated_at=clock_timestamp();
 return jsonb_build_object('status','pending');
end$$;
revoke all on function tc_integrations.epc_request(text,text,text,text) from public,anon;
grant execute on function tc_integrations.epc_request(text,text,text,text) to authenticated;
create function public.tc_request_epc(company text,tax text,branch text,phone text default '') returns jsonb language sql security invoker set search_path='' as $$select tc_integrations.epc_request(company,tax,branch,phone)$$;
revoke all on function public.tc_request_epc(text,text,text,text) from public,anon;
grant execute on function public.tc_request_epc(text,text,text,text) to authenticated;
create function tc_integrations.epc_approve(profile uuid,expected timestamptz,src text,env text,contact jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.tc_epc_requests; c public.tera_coin_customer; linked public.tc_flow_epcs; cid text:=contact->>'id';
begin
 if auth.uid() is null or public.tc_role() is distinct from 'admin' then raise exception 'Admin only';end if;
 if env not in ('test','v1') or env is null or nullif(src,'') is null or cid !~ '^[0-9]+$' or cid is null or nullif(contact->>'name','') is null then raise exception 'Invalid verified contact';end if;
 select * into r from public.tc_epc_requests where profile_id=profile for update;
 if not found or r.status<>'pending' or r.updated_at is distinct from expected then raise exception 'Request changed: refresh before approval';end if;
 if r.tax_id is distinct from contact->>'tax' or r.branch_code is distinct from contact->>'branch' then raise exception 'Tax/branch does not match FlowAccount';end if;
 perform pg_advisory_xact_lock(hashtextextended(src||':'||env||':company:'||cid,0));
 select * into c from public.tera_coin_customer where auth_user_id=profile for update;
 if not found then raise exception 'Customer account not found';end if;
 if exists(select 1 from public.tc_flow_epcs where source=src and environment=env and customer_id=c.customer_id and contact_id<>cid) then raise exception 'Account already linked to another company';end if;
 select * into linked from public.tc_flow_epcs where source=src and environment=env and contact_id=cid for update;
 if found and linked.customer_id<>c.customer_id then raise exception 'Company already linked to another account';end if;
 insert into public.tc_flow_epcs(source,environment,contact_id,company_name,tax_id,branch,customer_id) values(src,env,cid,contact->>'name',r.tax_id,r.branch_code,c.customer_id)
 on conflict(source,environment,contact_id) do nothing;
 update public.tc_epc_requests set status='approved',approved_contact_id=cid,approved_source=src,approved_environment=env,approved_by=auth.uid(),approved_at=now() where profile_id=profile;
 update public.tera_coin_customer set customer_name=contact->>'name' where customer_id=c.customer_id;
 return jsonb_build_object('status','approved','customer_id',c.customer_id,'contact_id',cid);
end$$;
revoke all on function tc_integrations.epc_approve(uuid,timestamptz,text,text,jsonb) from public,anon;
grant execute on function tc_integrations.epc_approve(uuid,timestamptz,text,text,jsonb) to authenticated;
create function public.tc_approve_epc(profile uuid,expected timestamptz,src text,env text,contact jsonb) returns jsonb language sql security invoker set search_path='' as $$select tc_integrations.epc_approve(profile,expected,src,env,contact)$$;
revoke all on function public.tc_approve_epc(uuid,timestamptz,text,text,jsonb) from public,anon;
grant execute on function public.tc_approve_epc(uuid,timestamptz,text,text,jsonb) to authenticated;
commit;
