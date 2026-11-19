# TeraCoin Web

เว็บสะสม TeraCoin และแลกสิทธิประโยชน์สำหรับ Terawatt ใช้ React, Supabase และ FlowAccount bridge

## เปิดใน VS Code

1. เลือก **File → Open Folder** แล้วเปิดโฟลเดอร์ `te-coin`
2. ติดตั้ง dependencies ด้วย `npm ci` ถ้ายังไม่มี `node_modules`
3. ตรวจ `.env.local` และ `.env.flowaccount` เทียบกับไฟล์ `.example` ในโฟลเดอร์นี้ เก็บค่าจริงไว้เฉพาะเครื่องหรือระบบ secrets ของเซิร์ฟเวอร์
4. ใช้ **Terminal → Run Task → TeraCoin: เว็บและ FlowAccount** หรือรัน `npm run start:flowaccount` แล้วเปิด [localhost:3003](http://localhost:3003)

เว็บใช้พอร์ต 3003 และ FlowAccount bridge ใช้พอร์ต 4319 หยุดชุดเดิมด้วย Ctrl+C ก่อนรันชุดใหม่ถ้าพอร์ตถูกใช้อยู่

## แก้ตรงไหน

| งาน | ไฟล์ |
| --- | --- |
| เมนูและหน้าภาพรวม | [src/App.js](src/App.js) |
| สี ขนาดตัวอักษร และการจัดวาง | [src/Terawatt.css](src/Terawatt.css) |
| ภาพโซลาร์และเหรียญ | [src/teracoin-solar.jpg](src/teracoin-solar.jpg) |
| เข้าสู่ระบบและสมัคร EPC | [src/AuthScreen.js](src/AuthScreen.js) |
| แคตตาล็อกและสิทธิ์ราคา | [src/CustomerCatalog.js](src/CustomerCatalog.js), [src/StockTable.js](src/StockTable.js) |
| สูตร Coin และรางวัลฝั่งเว็บ | [src/coin.js](src/coin.js), [src/formulas.js](src/formulas.js), [src/RewardDetails.js](src/RewardDetails.js) |
| รายงานยอดขายและปุ่ม Excel | [src/SalesReview.js](src/SalesReview.js), [server/sales-review.css](server/sales-review.css), [server/sales-review-export.js](server/sales-review-export.js) |
| การเชื่อม Supabase และ FlowAccount | [src/api.js](src/api.js), [server/flowaccount.mjs](server/flowaccount.mjs), [FLOWACCOUNT_SETUP.md](FLOWACCOUNT_SETUP.md) |
| ตารางและ SQL | [supabase/README.md](supabase/README.md) |

## รายงานยอดขาย

Admin เปิด **ยอดขายตามเซลส์** แล้วกด **ส่งออก Excel** เพื่อดาวน์โหลดไฟล์ .xlsx ตามตัวกรองปัจจุบัน รายงานอ่านจาก HTML snapshot ฝั่งเซิร์ฟเวอร์ ถ้าต้องเปลี่ยนชุดข้อมูล ให้วางไฟล์รูปแบบเดียวกันที่ `server/sales-review-private.html` หรือระบุพาธเต็มผ่าน `FLOWACCOUNT_SALES_REVIEW_PATH` ใน `.env.flowaccount` เก็บไฟล์นี้ไว้นอก `public/` และ Git เพราะมีข้อมูลยอดขายและลูกค้า

## ตรวจงานหลังแก้

- ทดสอบด้วย `npm test -- --watchAll=false --runInBand`
- สร้าง production build ด้วย `npm run build`
# te-coin-web
