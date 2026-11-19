# ฐานข้อมูล TeraCoin

[Supabase Dashboard ของ TeraCoin](https://supabase.com/dashboard/project/enhhollvivkrthygnour) ใช้สำหรับเว็บนี้ ข้อมูลที่ตรวจเมื่อ 19 พฤศจิกายน 2569 พบว่าตาราง TeraCoin มีอยู่แล้วและเปิด RLS ส่วนประวัติ CLI migrations ยังว่าง ให้ใช้สคีมาที่เห็นใน Dashboard เป็นข้อมูลอ้างอิงของระบบจริงก่อนแก้ไข

## ตารางที่ใช้บ่อย

| สิ่งที่ต้องแก้ | ดูตารางหรือมุมมอง |
| --- | --- |
| ผู้ใช้และสิทธิ์ | `tc_profiles`, `tc_epc_requests`, `tc_account_events` |
| แต้มสมาชิกและประวัติ | `tera_coin_customer`, `tc_ledger` |
| ตั้งค่าสูตรและรางวัล | `tc_settings`, `tc_rewards` |
| สต็อกและราคา | `stock_profit` |
| ผูกบัญชีและรายการ FlowAccount | `tc_flow_epcs`, `tc_flow_product_map`, `tc_flow_imports`, `tc_flow_previews` |
| ประวัติการเปลี่ยนแปลง | `tc_audit` |

## แผนที่ไฟล์ SQL

| กลุ่ม | ไฟล์ |
| --- | --- |
| โครงสร้างหลักและสิทธิ์ | `001_teracoin.sql`, `002_customer_access_setup.sql`, `002_customer_pricing.sql`, `003_first_admin.sql` |
| สูตร แต้ม และระดับสมาชิก | `004_configurable_formulas.sql` ถึง `007_reward_multipliers.sql` |
| เชื่อม FlowAccount | `FLOWACCOUNT_DATABASE_SETUP.sql`, `FLOWACCOUNT_RECEIPT_FORMULA.sql`, `FLOWACCOUNT_SETTINGS.sql`, `FLOWACCOUNT_CUSTOMER_PREVIEW.sql` |
| สมัครและจัดการ EPC | `FLOWACCOUNT_EPC_REGISTRATION.sql`, `EPC_ACCOUNT_MANAGEMENT.sql`, `EPC_DELETE_REREGISTER.sql` |
| นำเข้าราคา | `IMPORT_SHEET_PRICES.sql` |
| ทดสอบและคำอธิบาย | [tests/](tests/), [MEMBERSHIP_SETUP.md](MEMBERSHIP_SETUP.md), [REWARD_B_SETUP.md](REWARD_B_SETUP.md) |

ไฟล์ SQL ที่มีอยู่เป็นสคริปต์ตามฟีเจอร์ บางไฟล์เขียนทับฟังก์ชันเดียวกันหรือปรับข้อมูลจริง จึงควรตรวจ schema และคำอธิบายของฟีเจอร์ก่อนเลือกไฟล์ที่จะใช้ หากต้องเปลี่ยนระบบให้รันผ่าน Supabase CLI migrations ให้สร้าง baseline จากสคีมาทดสอบและตรวจการนำไปใช้กับโปรเจกต์แยกก่อน

รายงาน **ยอดขายตามเซลส์** ใช้ snapshot ฝั่งเซิร์ฟเวอร์ ส่วน Supabase ใช้ตรวจสิทธิ์ Admin ผ่าน `tc_profiles`
