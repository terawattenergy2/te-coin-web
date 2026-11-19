import React,{useState} from 'react';

export default function PasswordField({value,onChange,readOnly=false,name='password',autoComplete='current-password',placeholder}){
 const [visible,setVisible]=useState(false);
 return <label>รหัสผ่าน<div className="password-control">
  <input required={!readOnly} readOnly={readOnly} name={name} type={visible?'text':'password'} minLength={readOnly?undefined:8} autoComplete={autoComplete} value={value} onChange={onChange} placeholder={placeholder}/>
  <button type="button" className="password-visibility" aria-label={visible?'ซ่อนรหัสผ่าน':'แสดงรหัสผ่าน'} aria-pressed={visible} onClick={()=>setVisible(!visible)}>
   <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>{visible&&<path d="m3 3 18 18"/>}</svg>
  </button>
 </div></label>;
}
