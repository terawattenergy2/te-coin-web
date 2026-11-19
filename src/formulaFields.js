import {formulaLabels} from './formulas';
import {stockHeader} from './stockHeaders';
export const parameterLabels={quantity:'จำนวนชิ้นที่ขาย',y:'ตัวคูณ B เริ่มต้น',sale_unit_price:'ราคาขายจริงก่อน VAT / หน่วย',base_cost:'ต้นทุนฐานที่เลือก / หน่วย',group_multiplier:'ตัวคูณ B ของกลุ่มสินค้า',redemption_b:'ตัวคูณ B สำหรับแลกรางวัล',redemption_d:'ค่า D เดิมของรางวัล (บาท / TC)',commission_rate:'อัตราคอมมิชชัน',baht_per_tc:'อัตราสำรอง Liability (บาท / TC)',success_rate:'โอกาสสุ่มที่ตั้งไว้',value_baht:'มูลค่ารางวัล / ตั๋ว',reward_y:'ค่า Y ของรางวัล',balance_tc:'แต้มคงเหลือ',total_earn:'แต้มสะสมทั้งหมด',used_tc:'แต้มที่ใช้ไป'};
export const operationLabels={add:'บวก (+)',sub:'ลบ (−)',mul:'คูณ (×)',div:'หาร (÷)',min:'เลือกค่าน้อยที่สุด',max:'เลือกค่ามากที่สุด',abs:'ค่าสัมบูรณ์',round:'ปัดทศนิยม',ceil:'ปัดขึ้น',floor:'ปัดลง',neg:'เปลี่ยนเป็นค่าติดลบ',pos:'คงเครื่องหมายบวก'};
const nonNumeric=new Set(['id','main','product','model','active','created_at']);
export function stockFormulaFields(products){
 const keys=[...new Set(products.flatMap(p=>Object.keys(p)))];
 return keys.filter(k=>!nonNumeric.has(k)&&products.some(p=>typeof p[k]==='number'||(typeof p[k]==='string'&&p[k].trim()!==''&&Number.isFinite(Number(p[k].replace(/,/g,''))))|| (p[k]==null&&stockHeader(k).order>=3&&stockHeader(k).order<15))).sort((a,b)=>stockHeader(a).order-stockHeader(b).order);
}
export function formulaFieldLabels(products,rules={}){
 const labels={};stockFormulaFields(products).forEach((key,i)=>{const name=stockHeader(key).label;labels[key]=name===key?`ข้อมูลสินค้าเพิ่มเติม ${i+1}`:name;labels[`raw_${key}`]=`${labels[key]} (ค่าดิบ)`;});
 Object.keys(rules).forEach((key,i)=>{if(!labels[key])labels[key]=formulaLabels[key]||`ผลลัพธ์เพิ่มเติม ${i+1}`;});
 return {...labels,...parameterLabels,...formulaLabels,gross_margin:'กำไรขั้นต้นต่อหน่วย'};
}
export function describeFormula(node,labels){
 if(Object.prototype.hasOwnProperty.call(node,'value'))return node.value===''?'กรอกตัวเลข':String(node.value);
 if(node.var)return labels[node.var]||'ค่าที่เลือกเดิม';
 const args=(node.args||[]).map(a=>describeFormula(a,labels));const symbol={add:'+',sub:'−',mul:'×',div:'÷'}[node.op];
 return symbol?`(${args[0]} ${symbol} ${args[1]})`:`${operationLabels[node.op]||'คำนวณ'}(${args.join(', ')})`;
}
