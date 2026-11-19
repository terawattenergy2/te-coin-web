begin;
create table if not exists public.tc_flow_previews (
 source text not null, environment text not null check(environment in ('test','v1')),
 receipt_id text not null, contact_id text not null,
 customer_id text not null references public.tera_coin_customer(customer_id),
 document_number text, status text, summary jsonb not null,
 updated_at timestamptz not null default now(), primary key(source,environment,receipt_id)
);
alter table public.tc_flow_previews enable row level security;
revoke all on public.tc_flow_previews from public,anon,authenticated;
grant select,insert,update on public.tc_flow_previews to authenticated;
create policy tc_flow_preview_read on public.tc_flow_previews for select to authenticated
using(public.tc_role()='admin' or exists(select 1 from public.tera_coin_customer c where c.customer_id=tc_flow_previews.customer_id and c.auth_user_id=auth.uid()));
create policy tc_flow_preview_insert on public.tc_flow_previews for insert to authenticated
with check(public.tc_role()='admin' and exists(select 1 from public.tc_flow_epcs e where (e.source,e.environment,e.contact_id,e.customer_id)=(tc_flow_previews.source,tc_flow_previews.environment,tc_flow_previews.contact_id,tc_flow_previews.customer_id)));
create policy tc_flow_preview_update on public.tc_flow_previews for update to authenticated
using(public.tc_role()='admin') with check(public.tc_role()='admin' and exists(select 1 from public.tc_flow_epcs e where (e.source,e.environment,e.contact_id,e.customer_id)=(tc_flow_previews.source,tc_flow_previews.environment,tc_flow_previews.contact_id,tc_flow_previews.customer_id)));
commit;
