import React,{useEffect,useRef,useState} from 'react';
import PasswordField from './PasswordField';
import EpcCompanyLookup from './EpcCompanyLookup';
import {api} from './api';

export default function Login({onSubmit,onDemo,connected,message,busy,registrationSuccess,onRegistrationContinue}){
 const [signup,setSignup]=useState(false),[step,setStep]=useState('company');
 const [email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [name,setName]=useState(''),[tax,setTax]=useState(''),[branch,setBranch]=useState('00000'),[phone,setPhone]=useState(''),[code,setCode]=useState('');
 const [editCompany,setEditCompany]=useState(false),[error,setError]=useState('');
 const emailRef=useRef(null);
 useEffect(()=>{if(signup&&step==='credentials'&&!registrationSuccess)emailRef.current?.focus({preventScroll:true});},[signup,step,registrationSuccess]);
 function match(c){setName(c.name);setBranch(c.branch);setPhone(c.phone||'');setCode(c.code||'');setEditCompany(!c.phone);setError('');setStep('credentials');}
 function changeCompany(){setStep('company');setTax('');setName('');setPhone('');setCode('');setBranch('00000');setError('');}
 function switchMode(value){setSignup(value);setError('');}
 function submit(e){
  e.preventDefault();if(signup&&step!=='credentials')return;
  if(signup&&(!name.trim()||!phone.trim()||!/^\d{13}$/.test(tax)||!/^\d{5}$/.test(branch))){setEditCompany(true);setError('กรุณาตรวจชื่อบริษัท เบอร์ติดต่อ และรหัสสาขาให้ครบ');return;}
  const fields=new FormData(e.currentTarget);
  setPassword(String(fields.get('password')||''));setEmail(String(fields.get('email')||'').trim());
  onSubmit(String(fields.get('email')||'').trim(),String(fields.get('password')||''),name,signup,{epc_tax_id:tax,epc_branch_code:branch,epc_phone:phone});
 }
 return <div className={`login-layout compact-auth ${registrationSuccess?'registration-complete':''}`}>
  <section className="login-story">
   <div className="brand"><span className="brand-symbol">T</span><div>TeraCoin<small>by TERAWATT</small></div></div>
   {registrationSuccess?<div className="registration-story" role="status">
    <div className="registration-check" aria-label="สมัครสมาชิกสำเร็จ"><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><circle cx="40" cy="40" r="35"/><path d="M24 40l11 11 22-23"/></svg></div>
    <div className="eyebrow">WELCOME TO TERACOIN</div><h1>สมัครสมาชิก<br/>สำเร็จแล้ว</h1><p>{registrationSuccess.requiresConfirmation?'ตรวจสอบอีเมลเพื่อยืนยันบัญชีของคุณ':'บัญชีของคุณพร้อมสำหรับขั้นตอนถัดไป'}</p>
   </div>:<><div className="auth-story-copy"><div className="eyebrow">GROW WITH GOOD ENERGY</div><h1>โซลาร์ที่คุ้มค่า<br/>ทุกการสะสม</h1><p>สะสม TeraCoin จากยอดซื้อ แล้วใช้แลกเงินคืนและสิทธิประโยชน์จาก Terawatt</p></div></>}
   <small>TERAWATT ENERGY · PARTNER REWARDS</small>
  </section>
  <section className="login-side"><div className="login-card">
   {registrationSuccess?<div className="registration-next"><div className="eyebrow">ขั้นตอนถัดไป</div><h2>{registrationSuccess.requiresConfirmation?'ยืนยันอีเมลของคุณ':'ยินดีต้อนรับสู่ TeraCoin'}</h2><p>{registrationSuccess.requiresConfirmation?'เปิดอีเมลและกดลิงก์ยืนยันบัญชีที่ส่งไปยัง':'สมัครสมาชิกด้วยอีเมล'}</p><div className="registration-credentials"><label>Username (อีเมล)<input readOnly name="registered_username" value={registrationSuccess.email}/></label><PasswordField readOnly name="registered_password" autoComplete="off" value={password}/></div><p className="muted">หลังยืนยันบัญชี รอผู้ดูแลยืนยันบริษัท EPC เพื่อดูยอดซื้อและ Coin ของบริษัทคุณ</p><button type="button" onClick={()=>{setSignup(false);setPassword('');onRegistrationContinue?.();}}>{registrationSuccess.requiresConfirmation?'กลับไปเข้าสู่ระบบ':'เริ่มใช้งาน'} ↗</button></div>:<>
    <div className="eyebrow">WELCOME TO TERACOIN</div>
    <h2>{signup?step==='company'?'เริ่มต้นเป็นสมาชิก':'ตั้งค่าบัญชีของคุณ':'ยินดีต้อนรับกลับ'}</h2>
    <p className="auth-intro">{signup?step==='company'?'กรอกเลขผู้เสียภาษี แล้วเราจะค้นหาบริษัทให้คุณ':'อีกนิดเดียว กรอกอีเมลและตั้งรหัสผ่านเพื่อสมัคร':'เข้าสู่ระบบเพื่อดูยอดซื้อและ TeraCoin ของคุณ'}</p>
    <div className="auth-tabs"><button type="button" className={!signup?'selected':''} onClick={()=>switchMode(false)}>เข้าสู่ระบบ</button><button type="button" className={signup?'selected':''} onClick={()=>switchMode(true)}>สมัครเข้าใช้งาน</button></div>
    {signup&&<div className="signup-progress" aria-label="ขั้นตอนสมัคร"><span className={step==='company'?'current':'complete'}><b>{step==='company'?'1':'✓'}</b> ข้อมูลบริษัท</span><i/><span className={step==='credentials'?'current':''}><b>2</b> อีเมลและรหัสผ่าน</span></div>}
    {(message||error)&&<div className="notice" role="alert">{error||message}</div>}
    <form onSubmit={submit}>
     {signup&&step==='company'?<div className="signup-company-step">
      <label>เลขประจำตัวผู้เสียภาษีบริษัท (13 หลัก)<input required name="epc_tax_id" inputMode="numeric" pattern="[0-9]{13}" maxLength={13} value={tax} onChange={e=>setTax(e.target.value.replace(/\D/g,''))} placeholder="กรอกเลขผู้เสียภาษีเพื่อเริ่มต้น"/></label>
      <EpcCompanyLookup api={api} tax={tax} onMatch={match}/>
      <p className="signup-help">เมื่อพบข้อมูล ระบบจะพาไปกรอกอีเมลและรหัสผ่านทันที</p>
      <button type="button" className="signup-manual" disabled={!/^\d{13}$/.test(tax)} onClick={()=>{setEditCompany(true);setStep('credentials');}}>ไม่พบข้อมูล? กรอกข้อมูลบริษัทเอง</button>
     </div>:<>
      {signup&&<div className="signup-company-summary"><div><small>บริษัทที่กำลังสมัคร</small><strong>{name||'กรุณากรอกชื่อบริษัท'}</strong><span>{code&&`รหัส ${code} · `}{branch==='00000'?'สำนักงานใหญ่':`สาขา ${branch}`}{phone&&` · ${phone}`}</span></div><button type="button" className="text" onClick={()=>setEditCompany(!editCompany)}>{editCompany?'ย่อ':'แก้ไข'}</button></div>}
      {signup&&editCompany&&<div className="signup-company-edit"><label>ชื่อบริษัท<input required name="customer_name" value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label><label>รหัสสาขา<input required name="epc_branch_code" pattern="[0-9]{5}" maxLength={5} value={branch} onChange={e=>setBranch(e.target.value.replace(/\D/g,''))}/></label><label>เบอร์ผู้ติดต่อ<input required name="epc_phone" type="tel" maxLength={40} value={phone} onChange={e=>setPhone(e.target.value)}/></label></div>}
      <div className={`signup-credentials ${signup?'highlighted':''}`}>
       {signup&&<div className="signup-credentials-heading"><strong>กรอกข้อมูลสำหรับเข้าสู่ระบบ</strong><small>อีเมลและรหัสผ่านของคุณเอง</small></div>}
       <label>อีเมล<input ref={emailRef} required name="email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></label>
       <PasswordField value={password} onChange={e=>setPassword(e.target.value)} autoComplete={signup?'new-password':'current-password'} placeholder={signup?'ตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร':'กรอกรหัสผ่านของคุณ'}/>
      </div>
      <button disabled={busy||!connected}>{busy?'กำลังดำเนินการ…':signup?'สมัครสมาชิก ↗':'เข้าสู่ระบบ ↗'}</button>
      {signup&&<button type="button" className="signup-change-company" onClick={changeCompany}>← เปลี่ยนบริษัท / เลขผู้เสียภาษี</button>}
     </>}
    </form>
    <button className="text auth-switch" onClick={()=>switchMode(!signup)}>{signup?'มีบัญชีแล้ว? เข้าสู่ระบบ':'ยังไม่มีบัญชี? สมัครสมาชิก'}</button>
    {!connected&&<p className="notice">ยังไม่ตั้งค่า Supabase</p>}
    {!signup&&onDemo&&<details className="demo-options"><summary>ทดลองหน้าจอ (ข้อมูลตัวอย่าง)</summary><div className="demo-buttons"><small>ข้อมูลทดลองไม่ใช่ข้อมูลจาก Supabase</small>{['customer','viewer','admin'].map(r=><button key={r} onClick={()=>onDemo(r)}>{r}</button>)}</div></details>}
   </>}
  </div></section>
 </div>;
}
