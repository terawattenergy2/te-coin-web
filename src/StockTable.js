import React from 'react';
import { calculate, number } from './coin';
import { stockHeader } from './stockHeaders';
import {computedProduct,formulaLabels} from './formulas';

const numeric = key => /price|cost|profit|margin|total|qty|quantity|commission/i.test(key);
const format = (key,value) => value == null ? '—' : typeof value === 'boolean' ? (value?'เปิดใช้งาน':'ปิดใช้งาน') : numeric(key) ? number(value).toLocaleString('th-TH',{maximumFractionDigits:4}) : String(value);
export default function StockTable({products,settings,admin,demo,busy,search,onSearch,onEdit,onAdd,onRefresh,onConnect,status='idle',error=''}) {
 const keys = [...new Set([...products.flatMap(p=>Object.keys(p)),...Object.keys(settings.formulas||{}).filter(k=>!formulaLabels[k])])].filter(k=>!['id','created_at'].includes(k));
 const columns = keys.slice().sort((a,b)=>stockHeader(a).order-stockHeader(b).order);
 const visible = products.filter(p=>Object.values(p).some(v=>String(v??'').toLowerCase().includes(search.toLowerCase())));
 return <section className="panel stock-panel"><div className="section-title"><h2>สินค้าและราคาทั้งหมด</h2><div className="stock-actions"><button disabled={busy} onClick={demo?onConnect:onRefresh}>{demo?'โหลดข้อมูลจริงจาก Supabase':'รีเฟรชข้อมูล'}</button>{admin&&<button onClick={onAdd}>+ เพิ่มสินค้า</button>}</div></div>
 <p className="muted">{demo?'ข้อมูลตัวอย่าง':status==='loaded'?'โหลดจาก Supabase แล้ว • ราคาทุกคอลัมน์':status==='loading'?'กำลังโหลดสินค้าจาก Supabase':status==='error'?'โหลดสินค้าจาก Supabase ไม่สำเร็จ':'กำลังเตรียมข้อมูลสินค้าจริง'} · แสดง {visible.length} จาก {products.length} รายการ</p>
 {error&&<div className="notice" role="alert">{error}</div>}
 {demo&&<div className="notice">ข้อมูลนี้เป็นตัวอย่าง กด “โหลดข้อมูลจริงจาก Supabase” เพื่อใช้บัญชี Admin หรือ Viewer และโหลดสินค้าจริงทั้งหมด</div>}
 <input aria-label="ค้นหาสินค้า" placeholder="ค้นหาสินค้า รุ่น หรือหมวดหมู่" value={search} onChange={e=>onSearch(e.target.value)}/>
 <p className="stock-scroll-hint">บนมือถือ เลื่อนตารางซ้าย–ขวาเพื่อดูราคาทุกช่อง</p>
 <div className="table-scroll stock-scroll" tabIndex="0" role="region" aria-label="สินค้าและราคาจาก stock_profit"><table><thead><tr>{columns.map(k=><th key={k} className={`stock-head stock-head--${stockHeader(k).group}`}>{stockHeader(k).label}</th>)}<th>TC / หน่วย</th>{admin&&<th>จัดการ</th>}</tr></thead><tbody>{visible.map((p,i)=>{let view;try{view=computedProduct(p,settings);}catch{view=p;}return <tr key={p.id||`${p.model}-${i}`}>{columns.map(k=><td key={k}>{format(k,view[k])}</td>)}<td className="positive">{calculate(p,1,settings).tc.toLocaleString('th-TH',{maximumFractionDigits:2})}</td>{admin&&<td><button onClick={()=>onEdit(p)}>แก้ไขทุกช่อง</button></td>}</tr>;})}</tbody></table></div>
 {!visible.length&&status!=='loading'&&<div className="empty">{status==='error'?'กดรีเฟรชข้อมูลเพื่อลองใหม่':search?'ไม่พบสินค้าที่ค้นหา':'ไม่มีข้อมูลสินค้าที่บัญชีนี้เข้าถึงได้'}</div>}
 </section>;
}
