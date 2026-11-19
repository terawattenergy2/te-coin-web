-- Run AFTER signup with this exact email, and AFTER 001 and 002.
-- Only this explicitly selected account is promoted; do not promote the first arbitrary user.
begin;
do $$ declare admin_id uuid;begin
 select id into admin_id from auth.users where lower(email)='titawan.udh@gmail.com';
 if admin_id is null then raise exception 'กรุณาสมัครสมาชิก titawan.udh@gmail.com ใน TeraCoin ก่อน แล้วรันไฟล์นี้อีกครั้ง';end if;
 if not exists(select 1 from public.tc_profiles where id=admin_id) then raise exception 'ไม่พบ tc_profiles ของผู้ใช้ กรุณาตรวจการติดตั้ง 001';end if;
 update public.tc_profiles set role='admin' where id=admin_id;
end $$;
commit;
select p.id,u.email,p.role from public.tc_profiles p join auth.users u on u.id=p.id where lower(u.email)='titawan.udh@gmail.com';
