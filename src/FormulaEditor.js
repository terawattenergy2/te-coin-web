import React,{useState} from 'react';
import {formulaLabels,formulaRules,parseFormula,printFormula,evaluateTarget,formulaContext} from './formulas';
import {stockFormulaFields,formulaFieldLabels,parameterLabels,describeFormula} from './formulaFields';
import {rewardCost,rewardTypeB,formulaRewardB} from './coin';
import FlatFormulaEditor from './FlatFormulaEditor';
import {nodeValue,formatExample,splitFormula} from './formulaSteps';
const reserved=new Set(['sale_unit_price','base_cost','group_multiplier','redemption_d','redemption_b','quantity','y','commission_rate','baht_per_tc','success_rate','value_baht','reward_y','balance_tc','total_earn','used_tc','Qty','qty','id','main','model','product','active']);
export default function FormulaEditor({settings,products,rewards,customers,busy,demo,onSave}){
 const [draft,setDraft]=useState(()=>formulaRules(settings));
 const [rewardBs,setRewardBs]=useState(()=>Object.fromEntries([1,2,3,4].map(i=>[i,rewardTypeB(settings,i)]))),[bChanged,setBChanged]=useState(false);
 const bReady=demo||settings.reward_formula_version===1;
 const rewardNames={1:'Bundle Set',2:'Cashback / Voucher',3:'Lucky Draw',4:'ทัวร์'};
 const exampleCost=(value,b)=>{try{const cost=rewardCost({option:1,value_baht:value,redemption_b:b});return bReady?cost:Math.ceil(cost);}catch{return NaN;}};
 const changeRewardB=(option,value)=>{setRewardBs({...rewardBs,[option]:value});setBChanged(true);setDraft({...draft,[`reward_tc_${option}`]:parseFormula(bReady?'ceil(value_baht * redemption_b * 100) / 100':`ceil(value_baht * ${(Number.isFinite(Number(value))&&Number(value)>0?Math.min(Number(value),100000):0).toFixed(12)})`)});};
 const [group,setGroup]=useState('earn'),[expanded,setExpanded]=useState('commission_amount');
 const [selected,setSelected]=useState(products[0]?.id||''),[quantity,setQuantity]=useState(1),[newTarget,setNewTarget]=useState(''),[salePrice,setSalePrice]=useState('');
 const p=products.find(p=>p.id===selected)||products[0]||{},c=customers[0]||{};
 const context=formulaContext(p,settings,{quantity:Number(quantity),sale_unit_price:salePrice===''?Number(p.epc_price??0):Number(salePrice),balance_tc:Number(c.banlance_tc??24500),total_earn:Number(c.total_earn??32000),used_tc:Number(c.used_tc??7500)});
 const stockFields=stockFormulaFields(products),labels=formulaFieldLabels(products,draft);
 let rules,parseError='';try{rules=Object.fromEntries(Object.entries(draft).map(([k,v])=>[k,parseFormula(printFormula(v))]));}catch(e){parseError=e.message;}
 const values=Object.keys(draft).map(key=>{try{if(!rules)throw Error(parseError);const option=Number(key.match(/^reward_tc_(\d)$/)?.[1]);const r=rewards.find(r=>r.option===option);const ctx=option?formulaContext({},settings,{value_baht:Number(r?.value_baht??800),reward_y:Number(r?.y??1),redemption_b:Number(r?.redemption_b??rewardBs[option]),redemption_d:Number(r?.redemption_d??({1:1.05,2:0.5,3:0.75,4:1.15}[option]))}):['tc_value','liability_amount','lucky_rate'].includes(key)?formulaContext({},settings,{balance_tc:context.balance_tc,total_earn:context.total_earn,used_tc:context.used_tc}):context;const value=evaluateTarget(key,rules,ctx);if((['earned_tc','tc_value','liability_amount'].includes(key)||/price|cost/.test(key))&&value<0)throw Error('ผลลัพธ์นี้ต้องไม่ติดลบ');if(key==='lucky_rate'&&(value<0||value>1))throw Error('โอกาสสุ่มต้องอยู่ระหว่าง 0 และ 1');if(option&&value<=0)throw Error('แต้มแลกต้องมากกว่า 0');return {key,value,context:ctx};}catch(e){let message=e.message;[...new Set([...Object.keys(labels),...Object.keys(context)])].sort((a,b)=>b.length-a.length).forEach(k=>{message=message.split(k).join(labels[k]||'ค่าที่เลือก');});return {key,error:message};}});
 const invalid=parseError||values.some(v=>v.error)||(bChanged&&Object.values(rewardBs).some(v=>v===''||!Number.isFinite(Number(v))||Number(v)<=0||Number(v)>100000)),extraFields=stockFields.filter(k=>!reserved.has(k)&&!Object.prototype.hasOwnProperty.call(draft,k));
 const saveDraft=()=>{if(!window.confirm('บันทึกสูตรและ B กับรายการใหม่? แต้มในประวัติเดิมไม่เปลี่ยน'))return;onSave(rules,bChanged&&bReady?Object.fromEntries(Object.entries(rewardBs).map(([k,v])=>[k,Number(v)])):undefined);};
 const groupsFor=target=>[
 {label:'ช่องข้อมูลจาก Supabase',keys:stockFields.filter(k=>k!==target)},
 {label:'ค่าตั้งระบบและข้อมูลรายการ',keys:Object.keys(parameterLabels)},
 {label:'ผลลัพธ์จากสูตรอื่น',keys:Object.keys(draft).filter(k=>k!==target&&!stockFields.includes(k))},
 {label:'ค่าดิบจาก Supabase ก่อนใช้สูตร',keys:stockFields.map(k=>`raw_${k}`)}
 ].filter(g=>g.keys.length);
 const groupFor=key=>key.startsWith('reward_tc_')?'rewards':['tc_value','liability_amount','lucky_rate'].includes(key)?'valuation':formulaLabels[key]?'earn':'stock';
 const tabs=[['earn','สะสม TC'],['rewards','TC แลกรางวัล'],['valuation','มูลค่าแต้มและภาระ'],['stock','ราคาสินค้าและสูตรอื่น']];
 const priceKeys=['tier_2_price','tier_2_cost','epc_price','enduser_price','end_user_price'].filter(k=>stockFields.includes(k));
 const numericFor=(k,ctx=context)=>{try{return nodeValue({var:k},rules||draft,ctx);}catch{return NaN;}};
 const saleQuantity = Number(quantity);
 const validQuantity = Number.isInteger(saleQuantity) && saleQuantity > 0;
 const quantityLabel = formatExample(saleQuantity, 'quantity');
 const unitAmounts = ['sale_unit_price', 'base_cost', ...priceKeys];
 return <section className="panel formula-editor"><div className="eyebrow">กำหนดวิธีคำนวณ</div><h2>กำหนดสูตรการคำนวณทั้งหมด</h2><p className="muted">เลือกสินค้าตัวอย่าง ดูราคาที่ใช้จริง แล้วแก้เฉพาะสูตรที่ต้องการ แต่ละขั้นตอนจะแสดงตัวเลขและผลลัพธ์ให้ตรวจสอบได้ทันที</p>
 {!demo&&!settings.formulas&&<div className="notice">เปิดใช้การบันทึกสูตรจริงโดยรัน supabase/004_configurable_formulas.sql ก่อน สูตรเดิมยังทำงานจนกว่าจะติดตั้ง</div>}
 <div className="formula-category-tabs" role="tablist" aria-label="หมวดสูตร">{tabs.map(([id,title])=><button key={id} type="button" role="tab" aria-selected={group===id} onClick={()=>{setGroup(id);setExpanded(null);}}>{title}</button>)}</div>
 <div className="formula-sample">
  <SampleProductPicker products={products} selected={p.id ?? ''} onSelect={id => {
   setSelected(id);
   setSalePrice('');
  }} />
  <label>จำนวนในรายการขาย<input type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
  <label>ราคาขายตัวอย่างก่อน VAT / หน่วย<input type="number" min="0" step="0.01" value={salePrice===''?(p.epc_price??0):salePrice} onChange={e=>setSalePrice(e.target.value)}/></label>
 </div>
 <div className="formula-price-overview" aria-label="ราคาของสินค้าตัวอย่าง">
  {['sale_unit_price', 'base_cost', 'group_multiplier', 'commission_rate', ...priceKeys].map(key => {
   const value = numericFor(key);
   const isTotal = unitAmounts.includes(key);
   const unit = formatExample(value, key);
   return <div key={key}>
    <span>{isTotal ? `${labels[key].replace(/\s*\/\s*หน่วย$/, '')} (รวม)` : labels[key]}</span>
    <strong>{isTotal ? formatExample(validQuantity ? value * saleQuantity : NaN, key) : unit}</strong>
    {isTotal && <p className="muted">{unit} / หน่วย{validQuantity && ` × ${quantityLabel}`}</p>}
   </div>;
  })}
 </div>
 <details className="all-example-values"><summary>ดูตัวเลขจากสินค้านี้ทั้งหมด</summary><div className="example-values-list">{stockFields.map(k=><div key={k}><span>{labels[k]}</span><strong>{formatExample(numericFor(k),k)}</strong></div>)}</div></details>
 {group==='rewards'&&<section className="reward-b-settings"><h3>ตัวคูณ B สำหรับ TC แลกรางวัล</h3><p className="muted">มูลค่ารางวัล (บาท) × B = TC ที่ใช้ • แยกจาก B สะสมแต้มตามกลุ่มสินค้า • เปลี่ยน B แล้วสูตรของประเภทนั้นจะเป็นมูลค่า × B กด “บันทึกและใช้สูตรทั้งหมด” เพื่อใช้งานจริง</p>{!bReady&&<div className="notice">แก้และบันทึก B รายประเภทได้ทันที โดยเก็บในสูตรของฐานข้อมูลเดิม • ระบบเดิมปัด TC ขึ้นเป็นจำนวนเต็ม • อัปเดต 007 เฉพาะเมื่อต้องการ B แยกรายชิ้นและ TC ทศนิยม</div>}<div className="reward-b-grid">{[1,2,3,4].map(option=>{const r=rewards.find(r=>r.option===option),value=Number(r?.value_baht??800),b=Number(rewardBs[option]);return <div className="reward-b-item" key={option}><label>B สำหรับ {rewardNames[option]}<input type="number" min="0.000001" max="100000" step="0.000001" value={rewardBs[option]} disabled={busy} onChange={e=>changeRewardB(option,e.target.value)}/></label>{!bReady&&formulaRewardB(draft[`reward_tc_${option}`])==null&&<small>สูตรเดิมยังไม่ใช้ B นี้ กดใช้สูตรมูลค่า × B แล้วบันทึกเพื่อเริ่มใช้</small>}<small>ตัวอย่าง {r?.name||rewardNames[option]} · {value.toLocaleString('th-TH')} บาท</small><strong>{value.toLocaleString('th-TH')} × {Number.isFinite(b)?b:'—'} = {Number.isFinite(exampleCost(value,b))?exampleCost(value,b).toLocaleString('th-TH',{maximumFractionDigits:2}):'—'} TC</strong>{bReady&&r?.redemption_b!=null&&<small>รางวัลตัวอย่างนี้ตั้ง B เฉพาะชิ้นไว้ที่ {r.redemption_b} จึงใช้ค่านั้นแทน B ของประเภท</small>}<button type="button" className="text" disabled={busy} onClick={()=>changeRewardB(option,rewardBs[option])}>ใช้สูตรมูลค่า × B สำหรับประเภทนี้</button></div>;})}{!bReady&&rewards.some(r=>r.tc_base!=null||Number(r.tc_indicator??1)!==1)&&<div className="notice">มีรางวัลที่ตั้ง TC พื้นฐานหรือตัวคูณเฉพาะชิ้นไว้ในระบบเดิม ค่าเฉพาะชิ้นจะมีผลก่อนสูตรรายประเภท อัปเดต 007 เพื่อจัดการ B แบบใหม่ทั้งหมด</div>}</div><button className="reward-b-save" type="button" disabled={busy||!bChanged||Boolean(invalid)||(!demo&&!settings.formulas)} onClick={saveDraft}>บันทึก B และสูตรแลกรางวัล</button></section>}
 {invalid&&<div className="notice">มีสูตรที่ยังคำนวณไม่ได้ {values.filter(v=>v.error).length} รายการ กรุณาตรวจค่าหรือสูตรก่อนบันทึก</div>}
 {Object.keys(draft).filter(key=>groupFor(key)===group).map(key=>{const result=values.find(v=>v.key===key),title=labels[key],open=expanded===key;return <article className={`formula-row simple-formula-card ${open?'is-open':''}`} key={key} aria-label={title} data-testid={`formula-${key}`}><div className="simple-card-heading"><div><h3>{title}</h3><p>{describeFormula(splitFormula(draft[key]).body,labels)}</p></div><div className="simple-card-answer"><span>ผลตัวอย่าง</span><strong>{result.error?'ตรวจสูตร':formatExample(result.value,key)}</strong>
 {validQuantity && !result.error && ['commission_amount', 'gross_margin'].includes(key) &&
  <span>รวม {quantityLabel} · {formatExample(result.value * saleQuantity, key)}</span>}
 </div><button type="button" className="formula-edit-toggle" aria-expanded={open} onClick={()=>setExpanded(open?null:key)}>{open?'ปิดการแก้ไข':`แก้สูตร${title}`}</button></div>
 {open&&<div className="simple-card-editor"><div className="simple-editor-context">อ้างอิง{key.startsWith('reward_tc_')?'รางวัล':'สินค้า'}: <b>{key.startsWith('reward_tc_')?(rewards.find(r=>r.option===Number(key.slice(-1)))?.name||'ตัวอย่างรางวัล'):(p.model||'ยังไม่ได้เลือกสินค้า')}</b>{key.startsWith('reward_tc_')&&<span> · มูลค่ารางวัล × B สำหรับแลกรางวัล • B นี้แยกจากการสะสมแต้ม</span>}</div><FlatFormulaEditor node={draft[key]} field={key} name={title} onChange={node=>setDraft({...draft,[key]:node})} groups={groupsFor(key)} labels={labels} rules={rules||draft} context={result.context||context}/><p className="formula-human-preview">{describeFormula(draft[key],labels)}</p><div className="simple-editor-footer"><button type="button" className="text" onClick={()=>setDraft({...draft,[key]:{value:'0'}})}>เริ่มสูตรใหม่</button>{!formulaLabels[key]&&<button type="button" className="text" onClick={()=>{const next={...draft};delete next[key];setDraft(next);}}>ลบสูตรนี้</button>}</div></div>}
 <p role="status" className={result.error?'formula-error':'formula-result'}>{result.error?`ตรวจสูตร: ${result.error}`:`ผลตัวอย่าง = ${formatExample(result.value,key)}`}</p></article>;})}
 <div className="formula-add"><label>เพิ่มสูตรให้ช่องข้อมูลใน Supabase<select aria-label="เลือกช่องข้อมูลที่ต้องการตั้งสูตร" value={newTarget} onChange={e=>setNewTarget(e.target.value)}><option value="">เลือกช่องข้อมูล</option>{extraFields.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label><button type="button" disabled={!newTarget} onClick={()=>{setDraft({...draft,[newTarget]:{var:`raw_${newTarget}`}});setGroup('stock');setExpanded(newTarget);setNewTarget('');}}>+ เพิ่มสูตร</button></div>
 <div className="formula-save"><button disabled={busy||Boolean(invalid)||(!demo&&!settings.formulas)} onClick={saveDraft}>บันทึกและใช้สูตรทั้งหมด</button><button type="button" className="text" onClick={()=>{setDraft(formulaRules(settings));setRewardBs(Object.fromEntries([1,2,3,4].map(i=>[i,rewardTypeB(settings,i)])));setBChanged(false);}}>ยกเลิกการแก้ไข</button></div><p className="muted">TC รับเข้าปัด 2 ตำแหน่งและต้องไม่ติดลบ • {bReady?'แต้มแลกปัดขึ้นถึง 0.01 TC':'ระบบเดิมปัดแต้มแลกขึ้นเป็นจำนวนเต็ม'} และต้องมากกว่า 0 • โอกาสสุ่มต้องอยู่ระหว่าง 0–1 • สูตรผิด หารศูนย์ หรืออ้างอิงวนซ้ำจะไม่บันทึก<br/>ยอดสะสมและยอดใช้เป็นรายการบัญชี ยอดคงเหลือยังเท่ากับสะสม − ใช้ เพื่อไม่ให้ยอดเงินกับประวัติขัดกัน</p></section>;
}

function SampleProductPicker({ products, selected, onSelect }) {
 const [search, setSearch] = useState('');
 const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const suggestions = terms.length ? products.filter(product => {
  const text = [product.model, product.product, product.main].join(' ').toLocaleLowerCase();
  return terms.every(term => text.includes(term));
 }) : [];

 function select(id) {
  onSelect(id);
  setSearch('');
 }

 return <div className="sample-product-picker">
  <label>สินค้าตัวอย่าง
   <select value={selected} onChange={event => select(event.target.value)}>
    {products.map(product => <option key={product.id} value={product.id}>{product.model}</option>)}
   </select>
  </label>
  <label>ค้นหาสินค้าตัวอย่าง
   <input type="search" placeholder="พิมพ์ชื่อ รุ่น หรือหมวดสินค้า" value={search} onChange={event => setSearch(event.target.value)} />
  </label>
  {terms.length > 0 && (
   suggestions.length ? <ul className="sample-product-suggestions" aria-label="สินค้าแนะนำ">
    {suggestions.map(product => <li key={product.id}>
     <button type="button" onClick={() => select(product.id)}>
      {product.model}{product.product && <small>{product.product}</small>}
     </button>
    </li>)}
   </ul> : <p role="status" className="muted">ไม่พบสินค้าที่ตรงกับคำค้น</p>
  )}
 </div>;
}
