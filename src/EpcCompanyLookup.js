import React,{useEffect,useState} from 'react';
export default function EpcCompanyLookup({api,tax,onMatch,onReset}){
 const [state,setState]=useState({tax:'',loading:false,companies:[],message:''});
 useEffect(()=>{
  if(onReset)onReset();
  if(!/^[0-9]{13}$/.test(tax)){setState({tax,loading:false,companies:[],message:''});return;}
  const controller=new AbortController();let active=true;
  setState({tax,loading:true,companies:[],message:'กำลังค้นหาบริษัทจากเลขผู้เสียภาษี…'});
  const timer=setTimeout(async()=>{try{const result=await api.lookupCompany(tax,controller.signal);if(!active)return;
   const companies=result.companies||[];setState({tax,loading:false,companies,message:companies.length?companies.length===1?'พบข้อมูลแล้ว เติมข้อมูลจาก FlowAccount ให้แล้ว กรุณาตรวจสอบและตั้งรหัสผ่านของคุณ':'พบหลายรายชื่อหรือหลายสาขา กรุณาเลือกบริษัทของคุณ':'ไม่พบข้อมูลตรงกัน กรอกชื่อบริษัทและสาขาเองได้ ผู้ดูแลจะตรวจสอบให้'});
   if(companies.length===1)onMatch(companies[0]);
  }catch(e){if(active&&e.name!=='AbortError')setState({tax,loading:false,companies:[],message:'ค้นหาข้อมูลยังไม่สำเร็จ กรอกเองได้แล้วให้ผู้ดูแลตรวจสอบ'});}},500);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 // onMatch/onReset update the form; it must not retrigger the lookup on each render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tax,api]);
 if(state.tax!==tax||!state.message)return null;
 return <div aria-live="polite"><p className="notice">{state.message}</p>{state.companies.length>1&&<label>เลือกบริษัทและสาขาที่ตรงกับเอกสารของคุณ<select defaultValue="" key={tax} onChange={e=>{const c=state.companies[Number(e.target.value)];if(c)onMatch(c);}}><option value="" disabled>เลือกบริษัท / สาขา</option>{state.companies.map((c,i)=><option value={i} key={i}>{c.name} · {c.branch==='00000'?'สำนักงานใหญ่':'สาขา '+c.branch}</option>)}</select></label>}</div>;
}
