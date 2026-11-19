import React from 'react';
import {formulaRules} from './formulas';
import {calculate} from './coin';
import {formulaFieldLabels,describeFormula} from './formulaFields';
export default function FormulaSummary({products,settings}){
 const rules=formulaRules(settings),labels=formulaFieldLabels(products,rules),p=products[0]||{},c=calculate(p,1,settings),fmt=v=>Number(v).toLocaleString('th-TH',{maximumFractionDigits:2});
 return <section className="panel formula"><div className="eyebrow">ACTIVE CALCULATION RULES</div><h2>สูตรคำนวณที่ใช้อยู่</h2>{Object.entries(rules).map(([key,node])=><div className="formula-summary-row" key={key}><span>{labels[key]}</span><code>{describeFormula(node,labels)}</code></div>)}<p className="example">ตัวอย่าง {p.model||'ยังไม่ได้เลือกสินค้า'} • จำนวน 1 ชิ้น<br/>คอมมิชชัน {fmt(c.commission)} บาท • Gross Margin {fmt(c.gross)} บาท • ได้รับ {fmt(c.tc)} TC</p>{c.error&&<p className="formula-error">{c.error}</p>}<small>ตัวเลือกค่าดิบหมายถึงข้อมูลเดิมใน Supabase ก่อนใช้สูตร<br/>ราคาฐานไม่รวม VAT • แต้มรับเข้าใช้ทศนิยม 2 ตำแหน่ง • แต้มแลกปัดขึ้นถึง 0.01 TC • ยอดคงเหลือ = สะสม − ใช้</small></section>;
}
