import { readAllRows } from './pagination';
const url = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY || '';
export const connected = Boolean(url && key);
let session = null;
export function setSession(value) { session = value; try { if(value) sessionStorage.setItem('teracoin.session',JSON.stringify(value)); else sessionStorage.removeItem('teracoin.session'); } catch {} }
export function restoreSession() { try { const value=JSON.parse(sessionStorage.getItem('teracoin.session')||'null'); if(value?.access_token&&value?.refresh_token){session=value;return value;} }catch{}return null; }
async function request(path, { skipSession = false, ...options } = {}, responseType = "json") {
  if (!connected) throw new Error("กรุณาตั้งค่า Supabase URL และ publishable/anon key ใน .env.local แล้วเริ่มแอปใหม่");
  if (!skipSession && session && session.expires_at * 1000 < Date.now() + 30000) {
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token }) });
    const data = await response.json();
    if (!response.ok) throw new Error('เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่');
    setSession(data);
  }
  const integration = path.startsWith('/integration/flowaccount/');
  const response = await fetch(path.startsWith('/integration/') ? path : url + path, { ...options, headers: { apikey: key, ...(!skipSession && session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers } });
  const unavailableMessage = 'เว็บนี้ยังเชื่อมเซิร์ฟเวอร์ FlowAccount ไม่ได้ กรุณาติดต่อผู้ดูแล';
  if (response.ok && responseType === "text") {
    const html = await response.text();
    if (integration && !html.includes('<script id="dataset" type="application/json">')) {
      throw new Error(unavailableMessage);
    }
    return html;
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (integration && response.status !== 204 && (data === null || typeof data !== 'object')) {
    if (response.ok || response.status === 404 || response.status >= 500) {
      throw new Error(unavailableMessage);
    }
  }
  if (!response.ok) {
    const details = data ?? {};
    if (response.status === 429 && Number.isFinite(details.retryAfter)) {
      const error = new Error(details.message);
      error.retryAfter = details.retryAfter;
      throw error;
    }
    if ((['PGRST204','42703'].includes(details.code)&&/membership_config|redemption_d|redemption_b|win_rate/.test(details.message||'')) || (details.code==='PGRST202'&&/tc_record_sale|tc_save_reward_formulas/.test(path))) throw new Error('กรุณารัน supabase/007_reward_multipliers.sql เพื่อใช้ตัวคูณ B สำหรับแลกรางวัล');
    if (['PGRST204','42703'].includes(details.code)&&/tc_base|tc_indicator/.test(details.message||'')) throw new Error('กรุณารัน supabase/005_reward_tc_indicators.sql ก่อนบันทึก TC และตัวคูณรางวัล');
    if (details.code === 'PGRST205' || (details.code === '42703' && details.message?.includes('id'))) throw new Error('ยังไม่ได้ติดตั้งโครงสร้าง TeraCoin ใน Supabase โปรเจกต์นี้ กรุณารันไฟล์ supabase/001_teracoin.sql ก่อน');
    if (details.code === 'PGRST202') throw new Error('กรุณารันไฟล์ supabase/002_customer_pricing.sql เพื่อเปิดใช้การอนุมัติระดับราคา');
    if (details.code === '42501') throw new Error('บัญชีนี้ยังไม่มีสิทธิ์อ่านข้อมูล กรุณาเข้าสู่ระบบจริงและให้ Admin ตรวจสิทธิ์ของบัญชี');
    const retry=String(details.message||details.error_description||details.msg||'').match(/after (\d+) seconds/i);
    if(retry)throw new Error(`กรุณารอ ${retry[1]} วินาทีก่อนลองสมัครอีกครั้ง`);
    const error = new Error(details.message || details.error_description || details.msg || 'ไม่สามารถทำรายการได้');
    error.status = response.status;
    throw error;
  }
  return data;
}
export const api = {
  adminCustomers: (page, search, fresh, signal) => request('/integration/flowaccount/admin-customers?' +
    new URLSearchParams({ page, search, refresh: fresh ? '1' : '0' }), { signal, cache: 'no-store' }),
  adminLookupCompany: (tax, contactId) => request('/integration/flowaccount/admin-lookup-company', {
    method: 'POST', body: JSON.stringify({ tax, contactId }), cache: 'no-store',
  }),
  customerPurchases: (company, signal) => request('/integration/flowaccount/customer-purchases', {
    method: 'POST', body: JSON.stringify(company), signal,
  }),
  customerCoin: (page, signal) => request("/integration/flowaccount/customer-coin?page=" + page, { signal, cache: "no-store" }),
  salesReviewRefresh: (method, signal) => request("/integration/flowaccount/sales-review/refresh", { method, signal, cache: "no-store" }),
  salesDeposit: (id, signal) => request('/integration/flowaccount/sales-review/deposit?' +
    new URLSearchParams({id}), {signal, cache: 'no-store'}),
  salesReview: signal => request("/integration/flowaccount/sales-review", { signal, cache: "no-store" }, "text"),
  lookupCompany:(tax,signal)=>request('/integration/flowaccount/lookup-company',{method:'POST',body:JSON.stringify({tax}),signal}),
  flowaccount: (path, body) => request('/integration/flowaccount/'+path, body === undefined ? {} : {method:'POST',body:JSON.stringify(body)}),
  me: () => request('/auth/v1/user'),
  catalog: () => readAllRows(offset => request('/rest/v1/rpc/tc_catalog', { method:'POST', body:JSON.stringify({page_offset:offset,page_size:200}) })),
  login: (email, password) => request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signup: (email, password, name, companyData = {}) => request('/auth/v1/signup', { method: 'POST', skipSession: true, body: JSON.stringify({ email, password, data: { customer_name: name, epc_tax_id: companyData.epc_tax_id, epc_branch_code: companyData.epc_branch_code, epc_phone: companyData.epc_phone } }) }),
  logout: () => request('/auth/v1/logout', { method: 'POST' }),
  read: table => request(`/rest/v1/${table}?select=*`),
  readAll: table => readAllRows(offset => request(`/rest/v1/${encodeURIComponent(table)}?select=*&order=id.asc&limit=200&offset=${offset}`)),
  save: (table,value) => { const payload=table==='tc_settings'?Object.fromEntries(['y','commission','baht_per_tc','success_rate','membership_config'].map(k=>[k,value[k]])):value; return request(`/rest/v1/${table}${value.id?`?id=eq.${encodeURIComponent(value.id)}`:''}`,{method:value.id?'PATCH':'POST',body:JSON.stringify(payload)}); },
  rpc: (name, args) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify(args) })
};
