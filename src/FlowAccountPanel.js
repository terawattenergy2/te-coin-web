import React,{useCallback,useEffect,useState} from 'react';
import {previewFlowSale} from './flowaccountCoin';
const fmt=n=>n==null?'—':Number(n).toLocaleString('th-TH',{maximumFractionDigits:2});
export {previewFlowSale} from './flowaccountCoin';

function Lines({preview,settings}){return <div className="flow-purchases">{preview.lines.map((l,i)=><article className="panel" key={i}>
 <div className="section-title"><strong>{l.name} × {fmt(l.quantity)}</strong><strong>{l.tc==null?'ยังคำนวณไม่ได้':fmt(l.tc)+' TC'}</strong></div>
 <p>ยอดซื้อก่อน VAT {fmt(l.netTotal)} บาท</p>
 {l.error?<p className="notice">{l.error} — รายการนี้ยังไม่รวมในยอด Coin และไม่แสดงเป็น 0 TC</p>:<><p className="muted">ต้นทุนจาก {l.model} · {l.group}</p><details><summary>ดูสูตรและตัวเลขที่ใช้คำนวณ</summary>
 <p>ราคาขายจริง {fmt(l.price)} บาท/หน่วย · ต้นทุน {fmt(l.cost)} บาท/หน่วย</p>
 <p>คอมมิชชัน = ราคาขายจริง × {fmt(l.commissionRate*100)}% = {fmt(l.commission)} บาท/หน่วย</p>
 <p>กำไรหลังหักคอม = ราคาขายจริง − ต้นทุน − คอมมิชชัน = {fmt(l.gross)} บาท/หน่วย</p>
 <p>Coin = ปัดทศนิยม 2 ตำแหน่งของ max(0, (ราคาขายจริง − ต้นทุน − คอมมิชชัน) × จำนวน × B)</p>
 <strong>ผลลัพธ์ {fmt(l.tc)} TC · จำนวน {fmt(l.quantity)} · ตัวคูณ {fmt(l.multiplier)}</strong>
 </details></>}
 </article>)}</div>;}
export default function FlowAccountPanel({products,customers,settings,demo,api,onReload}){
 const [data,setData]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async(page=1)=>{setBusy(true);setMessage('');try{setData(await api.flowaccount('receipts?page='+page));}catch(e){setMessage(e.message);}finally{setBusy(false);}},[api]);
 useEffect(()=>{if(!demo)load();},[demo,load]);
 const [syncResult,setSyncResult]=useState(null);
 async function syncReceiptCoins() {
  if (!window.confirm('บันทึกแต้มจากใบเสร็จที่ชำระครบในหน้านี้ให้ลูกค้า EPC ที่เชื่อมบัญชีแล้ว?')) return;
  setBusy(true);
  setSyncResult(null);
  try {
   const result = await api.flowaccount('sync-receipt-coins?page='+data.page, {});
   setSyncResult(result);
   await onReload();
   await load(data.page);
  } catch (error) {
   setMessage(error.message);
  } finally {
   setBusy(false);
  }
 }
 const groups=new Map();for(const r of data?.receipts||[]){const key=r.contactId||'unknown:'+r.id;if(!groups.has(key))groups.set(key,{key,name:r.company,receipts:[]});groups.get(key).receipts.push(r);}
 return <section className="panel flowaccount-panel"><div className="section-title"><div><div className="eyebrow">EPC PURCHASES & COIN</div><h2>ลูกค้าซื้ออะไร · ได้ Coin เท่าไร</h2></div><button disabled={busy||demo} onClick={()=>load(data?.page||1)}>{busy?'กำลังดึงข้อมูล…':'อัปเดตข้อมูล'}</button></div>
 <p>ดึงรายการซื้อจาก FlowAccount อัตโนมัติ แยกตามบริษัท EPC และคำนวณจากต้นทุนกับสูตรที่บันทึกไว้ นับเฉพาะยอดที่ชำระครบแล้ว</p>
 {demo&&<p className="notice">เข้าสู่ระบบ Admin เพื่ออ่านยอดซื้อจริงจาก API</p>}{message&&<div className="notice" role="status">{message}</div>}
 {data?.canCredit&&<button type="button" disabled={busy||data.setupRequired} onClick={syncReceiptCoins}>บันทึก Coin จากใบเสร็จในหน้านี้</button>}
 {syncResult&&<div className="notice" role="status">
  <p>บันทึก {syncResult.credited} รายการ · เพิ่ม {fmt(syncResult.tc)} TC · บันทึกแล้วก่อนหน้านี้ {syncResult.duplicates} รายการ</p>
  {syncResult.previewSyncError&&<p>{syncResult.previewSyncError}</p>}

  {syncResult.skipped.length>0&&<details><summary>รายการที่ยังไม่บันทึก ({syncResult.skipped.length})</summary><ul>
   {syncResult.skipped.map(({document,reason},i)=><li key={i}>{document} · {reason}</li>)}
  </ul></details>}
 </div>}
 {data&&<>{data.previewSyncError&&<p className="notice">{data.previewSyncError}</p>}<p className="notice">{data.environment==='test'?'ข้อมูล Sandbox — คำนวณให้ดูได้ แต่ยังไม่เพิ่มแต้มในบัญชีจริง':'ข้อมูล Production'} · {data.total} ใบเสร็จ · หน้า {data.page}</p>
 {[...groups.values()].map(g=>{
  const linked=data.epcs.find(x=>x.contact_id===g.key),customer=customers.find(c=>c.customer_id===linked?.customer_id);
  const receipts=g.receipts.map(r=>({...r,results:r.sales.map(s=>({sale:s,preview:previewFlowSale(s,products,settings,customer)}))}));
  const seen=new Set();let companyTotal=0,pending=0;
  for(const r of receipts)for(const x of r.results)if(!seen.has(x.sale.saleKey)){seen.add(x.sale.saleKey);companyTotal+=x.preview.tc;pending+=x.preview.errors.length;}
  return <article className="panel" key={g.key}><div className="section-title"><div><h3>{g.name||'ไม่พบชื่อบริษัท'} <small>· EPC</small></h3><p className="muted">รหัสลูกค้า {g.key} · {g.receipts.length} ใบเสร็จในหน้านี้</p></div><div><strong style={{fontSize:'1.6rem'}}>{fmt(companyTotal)} TC</strong><p>{pending?'ยอดที่คำนวณได้แล้ว · ยังขาดต้นทุน '+pending+' รายการ':'Coin จากยอดชำระครบในหน้านี้'}</p></div></div>
  {receipts.map(r=><section className="flow-receipt" key={r.id}><h4>{r.documentNumber||r.id} · {r.status==='paid'?'รับชำระแล้ว':r.status==='awaiting'?'รอชำระ':r.status}</h4>
   {r.error?<><p className="notice">ยังไม่นับ Coin: {r.error}</p>{(r.purchases||[]).map((l,i)=><p key={i}>{l.name} × {fmt(l.quantity)} · ยอดสินค้า {fmt(l.netTotal)} บาท</p>)}</>:r.results.map(({sale:s,preview})=>{const imported=data.imports.find(x=>x.sale_key===s.saleKey);return <div key={s.saleKey}><p>ยอดสินค้าตามใบเสร็จก่อน VAT {fmt(s.netTotal)} บาท</p>{s.headerDifference!==0&&<p className="muted">ใช้ยอดรายสินค้าในการคำนวณ ตามที่กำหนด · ส่วนต่างจากฐาน VAT ท้ายบิล {fmt(s.headerDifference)} บาท</p>}<Lines preview={preview} settings={settings}/><strong>{preview.partial?'คำนวณได้แล้วบางรายการ':'รวมใบเสร็จ'} {fmt(preview.tc)} TC</strong>
   {data.canCredit&&<button disabled={busy||data.setupRequired||preview.partial||!!imported} onClick={async()=>{if(!window.confirm('บันทึก Coin ของ '+g.name+' ตามรายการซื้อที่แสดง?'))return;setBusy(true);try{const result=await api.flowaccount('credit',{receiptId:r.id,saleKey:s.saleKey});setMessage(result.duplicate?'บันทึกรายการนี้แล้ว':`เพิ่ม ${fmt(result.tc)} TC แล้ว`);await onReload();await load(data.page);}catch(e){setMessage(e.message);}finally{setBusy(false);}}}>{imported?'บันทึก Coin แล้ว':'บันทึก Coin ให้ EPC'}</button>}
   </div>;})}
  </section>)}
  </article>;
 })}<div className="section-title"><button disabled={busy||data.page<=1} onClick={()=>load(data.page-1)}>หน้าก่อน</button><button disabled={busy||data.page*20>=data.total} onClick={()=>load(data.page+1)}>หน้าถัดไป</button></div></>}
 </section>;
}
