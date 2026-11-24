import {createSellerGroupStore, parseSellerGroup} from './seller-groups.mjs';
import {createProductGroupStore, parseProductGroup} from './product-groups.mjs';
import {classify, depositPattern, receiptNetBeforeVat, reviewQuoteNumbers} from './sales-review-data.mjs';
import {summarizeQuotePayments} from './quote-payments.mjs';
import {loadSaleSuccess} from './sale-success.mjs';
import {buildModelSegments, modelKey} from './sales-product-classifier.mjs';
import http from 'node:http';
import { createGzip } from 'node:zlib';
import { createHostedReview, validCron } from './sales-review-hosted.mjs';
import { loadCustomerPurchases } from './customer-purchases.mjs';
import { createReviewSync } from './sales-review-sync.mjs';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {documents,normalizeReceipt,matchProduct,purchaseLines}=require('../src/flowaccountDomain.js');
const {normalizeContact,matchContacts}=require('../src/epcMatch.js');
const {previewFlowSale}=require('../src/flowaccountCoin.js');
const config={...process.env};
try{for(const line of (await readFile(new URL('../.env.flowaccount',import.meta.url),'utf8')).split('\n')){if(!line.trim()||line.trim().startsWith('#'))continue;const i=line.indexOf('=');if(i>0)config[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^(['"])(.*)\1$/,'$2');}}catch(e){if(e.code!=='ENOENT')throw e;}
const hosted = process.env.VERCEL === '1';
const environment=config.FLOWACCOUNT_ENVIRONMENT||(hosted?'v1':'test');
const source=config.FLOWACCOUNT_ACCOUNT_ID||'';
const salesDocumentTypes = new Set(['quotations', 'billing-notes', 'tax-invoices', 'receipts']);
const sb=(config.SUPABASE_URL||config.REACT_APP_SUPABASE_URL||'').replace(/\/$/,'');
config.SUPABASE_PUBLISHABLE_KEY ||= config.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
let token=config.FLOWACCOUNT_BEARER_TOKEN||'',expires=0;
let flowRetryAt = 0;
const salesCache = new Map();
const pendingSales = new Map();
const detailDocuments = new Map();
const pendingDocuments = new Map();
const referenceTypes = {3: 'quotations', 5: 'billing-notes', 7: 'tax-invoices', 35: 'cash-invoices'};

function checkFlowRateLimit(response) {
 if (response?.status === 429) {
  const header = response.headers.get('Retry-After');
  const now = Date.now();
  const retryAt = /^\d+$/.test(header || '') ? now + Number(header) * 1000 : Date.parse(header);
  flowRetryAt = Math.max(flowRetryAt, Number.isFinite(retryAt) && retryAt > now ? retryAt : now + 60000);
 }
 if (Date.now() < flowRetryAt) {
  const error = Error('FlowAccount จำกัดจำนวนคำขอชั่วคราว');
  error.retryAfter = Math.max(1, Math.ceil((flowRetryAt - Date.now()) / 1000));
  throw error;
 }
}
async function getToken(){
 if(config.FLOWACCOUNT_CLIENT_ID&&config.FLOWACCOUNT_CLIENT_SECRET&&(!token||Date.now()>expires)){
  const r=await fetch(`https://openapi.flowaccount.com/${environment}/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.FLOWACCOUNT_CLIENT_ID,client_secret:config.FLOWACCOUNT_CLIENT_SECRET,grant_type:'client_credentials',scope:'flowaccount-api'}),signal:AbortSignal.timeout(20000)});
  checkFlowRateLimit(r);
  if(!r.ok)throw Error('ขอ FlowAccount Token ไม่สำเร็จ');const j=await r.json();token=j.access_token;expires=Date.now()+(Number(j.expires_in)-120)*1000;
 }
 if(!token)throw Error('กรอก Token หรือ Client credentials ใน .env.flowaccount ฝั่งเซิร์ฟเวอร์');return token;
}
async function flow(path){
 checkFlowRateLimit();
 const accessToken = await getToken();
 checkFlowRateLimit();
 const r=await fetch(`https://openapi.flowaccount.com/${environment}/${path}`,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 if (r.status === 429) checkFlowRateLimit(r);
 if(!r.ok)throw Error(`FlowAccount HTTP ${r.status}${r.status===401?' — Token หมดอายุ ให้เปลี่ยน Token ฝั่งเซิร์ฟเวอร์':''}`);return r.json();
}
let saleSuccessCache;
let saleSuccessPending;
const reportPath = config.FLOWACCOUNT_SALES_REVIEW_PATH || new URL('./sales-review-paid-receipts-private.html', import.meta.url);
const hostedReview = createHostedReview({
 flow, url: sb, key: config.TERACOIN_REVIEW_STORAGE_KEY, source,
});
const productGroups = createProductGroupStore({url: sb, key: config.TERACOIN_REVIEW_STORAGE_KEY, source});
const sellerGroups = createSellerGroupStore({url: sb, key: config.TERACOIN_REVIEW_STORAGE_KEY, source});
const reviewSync = createReviewSync({
 flow, path: reportPath, enabled: environment === 'v1' && Boolean(source),
});

async function fetchSalesPage(path, page, pageSize) {
 const result = await flow(path);
 if (result.status === false) throw Error('FlowAccount ส่งข้อมูลเอกสารไม่สำเร็จ');
 const rows = documents(result);
 const rawTotal = result.data?.totalDocument;
 const count = Number(rawTotal);
 const total = rawTotal != null && rawTotal !== '' && Number.isSafeInteger(count) && count >= 0 ? count : null;

 return {
  environment, page, total, loadedAt: Date.now(),
  hasNext: rows.length > 0 && (total === null ? rows.length === pageSize : page * pageSize < total),
  documents: rows.map(row => ({
   id: row.documentId ?? row.recordId,
   number: row.documentSerial,
   company: row.contactName,
   customerCode: row.contactCode,
   date: row.publishedOn ?? row.documentDate,
   status: row.statusString || row.status,
   total: row.grandTotal,
   salesName: String(row.salesName ?? '').trim(),
   items: documentItems(row),
  })),
 };
}
async function fetchSalesDocument(path, id) {
 const cached = detailDocuments.get(path);
 if (cached && Date.now() - cached.loadedAt < 300000) return cached.row;
 if (!pendingDocuments.has(path)) {
  const pending = (async () => {
   const result = await flow(path);
   if (result.status === false) throw Error('FlowAccount ส่งรายละเอียดเอกสารไม่สำเร็จ');
   const row = documents(result).find(doc => [doc.documentId, doc.recordId].some(value => String(value) === id));
   if (!row) throw Error('ไม่พบเอกสารนี้ใน FlowAccount');
   detailDocuments.delete(path);
   detailDocuments.set(path, {row, loadedAt: Date.now()});
   if (detailDocuments.size > 200) detailDocuments.delete(detailDocuments.keys().next().value);
   return row;
  })().finally(() => pendingDocuments.delete(path));
  pendingDocuments.set(path, pending);
 }
 return pendingDocuments.get(path);
}

function documentItems(row) {
 return (row.items || []).filter(item => !item.documentId && item.name).map(item => ({
  name: item.name,
  sku: item.sku,
  quantity: item.quantity,
  unit: item.unitName,
  unitPrice: item.pricePerUnit,
  total: item.total,
 }));
}

async function fetchSalesDetail(type, id) {
 const row = await fetchSalesDocument(type + '/' + id, id);
 const references = new Map();
 for (const item of [...(row.items || []), ...(row.documentReference || [])]) {
  if (!item.documentId) continue;
  const refType = referenceTypes[item.documentType ?? (type === 'receipts' ? 7 : 0)];
  references.set(`${refType || item.documentType}:${item.documentId}`, {type: refType, id: String(item.documentId), number: item.documentSerial});
 }

 const refs = [...references.values()];
 const groups = new Array(refs.length);
 let next = 0;
 async function worker() {
 while (next < refs.length) {
  const index = next++;
  const ref = refs[index];
  const group = {number: ref.number || ref.id, items: []};
  if (ref.type && /^\d+$/.test(ref.id)) {
   try {
    const original = await fetchSalesDocument(ref.type + '/' + ref.id, ref.id);
    group.number = original.documentSerial || group.number;
    group.salesName = original.salesName?.trim();
    group.items = documentItems(original);
   } catch (error) {
    if (error.retryAfter) throw error;
   }
  }
  groups[index] = group;
 }
 }
 await Promise.all(Array.from({length: Math.min(2, refs.length)}, () => worker()));
 return {loadedAt: Date.now(), salesName: row.salesName?.trim(), items: documentItems(row), references: groups};
}

async function replyCachedSales(path, load, res, reply, refresh = false) {
 const cached = salesCache.get(path);
 if (!refresh && cached && Date.now() - cached.loadedAt < (path.includes('?') ? 60000 : 300000)) return reply(200, cached);

 if (!pendingSales.has(path)) {
  const pending = load().then(data => {
   salesCache.delete(path);
   salesCache.set(path, data);
   if (salesCache.size > 100) salesCache.delete(salesCache.keys().next().value);
   return data;
  }).finally(() => pendingSales.delete(path));
  pendingSales.set(path, pending);
 }
 try {
  return reply(200, await pendingSales.get(path));
 } catch (error) {
  if (!error.retryAfter) throw error;
  if (cached) return reply(200, {...cached, retryAfter: error.retryAfter});
  res.setHeader('Retry-After', String(error.retryAfter));
  return reply(429, {message: error.message, retryAfter: error.retryAfter});
 }
}

async function supabase(path,authorization,method='GET',body,prefer){
 const r=await fetch(sb+path,{method,headers:{apikey:config.SUPABASE_PUBLISHABLE_KEY,Authorization:authorization,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const j=r.status===204?null:await r.json();if(!r.ok){const e=Error(j?.code==='PGRST205'||j?.code==='PGRST202'?'ยังไม่ได้ติดตั้ง FLOWACCOUNT_DATABASE_SETUP.sql':j?.message||'Supabase request failed');e.status=r.status;throw e;}return j;
}
async function loadCustomerCoin(userId, authorization, page) {
 const customers = await supabase('/rest/v1/tera_coin_customer?' + new URLSearchParams({
  auth_user_id: 'eq.' + userId, select: 'customer_id,banlance_tc',
 }), authorization);
 const customer = customers[0];
 if (!customer) return { linked: false };
 const scope = {
  source: 'eq.' + source, environment: 'eq.v1', customer_id: 'eq.' + customer.customer_id,
 };
 const links = await supabase('/rest/v1/tc_flow_epcs?' + new URLSearchParams({
  ...scope, select: 'contact_id,company_name', order: 'contact_id.asc',
 }), authorization);
 if (!links.length) return { linked: false, balance: customer.banlance_tc };

 const pageSize = 20;
 const matches = await Promise.all(links.map(async link => {
  const query = new URLSearchParams({
   currentPage: String(page), pageSize: String(pageSize), searchString: link.company_name,
  });
  const payload = await flow('receipts?' + query);
  if (payload.status === false) throw Error('ยังโหลดใบเสร็จจาก FlowAccount ไม่สำเร็จ');
  const rows = documents(payload);
  const total = Number(payload.data?.totalDocument);
  return {
   hasNext: rows.length > 0 && (Number.isFinite(total) ? page * pageSize < total : rows.length === pageSize),
   // The name search narrows the API response. Only the verified contact ID grants access.
   receipts: rows.filter(row => String(row.contactId) === link.contact_id).map(row => ({
    id: String(row.documentId ?? row.recordId), number: row.documentSerial,
    date: row.publishedOn ?? row.documentDate, status: row.statusString || row.status,
    total: row.grandTotal,
   })),
  };
 }));
 const receipts = [...new Map(matches.flatMap(match => match.receipts).map(row => [row.id, row])).values()];
 for (const receipt of receipts) {
  if (!/^\d+$/.test(receipt.id)) throw Error('รหัสใบเสร็จจาก FlowAccount ไม่ถูกต้อง');
 }
 const amounts = new Map();
 if (receipts.length) {
  for (let offset = 0; ; offset += 100) {
   const imports = await supabase('/rest/v1/tc_flow_imports?' + new URLSearchParams({
    ...scope, select: 'receipt_id,amount', receipt_id: 'in.(' + receipts.map(row => row.id).join(',') + ')',
    order: 'sale_key.asc', limit: '100', offset: String(offset),
   }), authorization);
   for (const entry of imports) {
    amounts.set(entry.receipt_id, (amounts.get(entry.receipt_id) ?? 0) + Number(entry.amount));
   }
   if (imports.length < 100) break;
  }
 }
 return {
  linked: true, balance: customer.banlance_tc, page, loadedAt: new Date().toISOString(),
  hasNext: matches.some(match => match.hasNext),
  receipts: receipts.sort((a, b) => String(b.date).localeCompare(String(a.date)))
   .map(row => ({ ...row, credited: amounts.get(row.id) ?? null })),
 };
}

async function canonical(id){
 const r=documents(await flow('receipts/'+encodeURIComponent(id))).find(x=>String(x.documentId??x.recordId)===String(id));
 if(!r)throw Error('ไม่พบใบเสร็จที่ร้องขอ');const invoices={};
 for(const ref of r.items||[])if(ref.documentId!=null&&String(ref.documentType)==='7'){
  const k=String(ref.documentId);invoices[k]=documents(await flow('tax-invoices/'+encodeURIComponent(k))).find(x=>String(x.documentId??x.recordId)===k);
 }
 let sales=[],eligibilityError=null;try{sales=normalizeReceipt(r,source,environment,invoices);}catch(e){eligibilityError=e.message;}
 return {receipt:r,sales,purchases:purchaseLines(r,invoices),eligibilityError};
}
async function creditSale(sale, products, authorization, customerId) {
 const mappings = new Map();
 for (const line of sale.lines) {
  const resolved = matchProduct(line, products);
  if (!resolved.product) throw Error(line.name + ': ' + resolved.error);
  mappings.set(line.productKey, {source, environment, product_key: line.productKey, product_id: resolved.product.id});
 }
 await supabase('/rest/v1/tc_flow_product_map?on_conflict=source,environment,product_key', authorization, 'POST', [...mappings.values()], 'resolution=merge-duplicates,return=minimal');
 return supabase('/rest/v1/rpc/tc_flow_credit', authorization, 'POST', {sale, existing_customer: customerId});
}
function contactRows(payload){const d=payload?.data??payload;if(Array.isArray(d))return d;if(Array.isArray(d?.list))return d.list;if(d&&(d.id!=null||d.contactId!=null))return[d];throw Error('รูปแบบรายชื่อ FlowAccount ไม่ถูกต้อง');}
const lookupLimits=new Map();let contactCache=null,contactCacheUntil=0;
async function contacts({ fresh = false } = {}){
 if(!fresh && contactCache&&Date.now()<contactCacheUntil)return contactCache;
 const all=[];for(let page=1;page<=100;page++){const result=await flow(`contacts?currentPage=${page}&pageSize=100`);const rows=contactRows(result);all.push(...rows);if(rows.length<100||all.length>=Number(result.data?.totalDocument||Infinity)){contactCache=all;contactCacheUntil=Date.now()+30000;return all;}}
 throw Error('รายชื่อลูกค้ามากเกินขอบเขตที่ค้นหา กรุณาติดต่อผู้ดูแล');
}
async function findTaxCompanies(tax, fresh = false) {
 const found = (await contacts({fresh})).map(normalizeContact)
  .filter(contact => contact.tax === tax && contact.branch && contact.name);
 if (found.length > 20) return null;
 return Promise.all(found.map(async candidate => {
  const details = contactRows(await flow('contacts/' + encodeURIComponent(candidate.id)))
   .find(row => String(row.id ?? row.contactId) === candidate.id);
  if (!details) throw Error('ไม่พบรายละเอียดบริษัท');
  const contact = normalizeContact(details);
  if (contact.tax !== tax || contact.branch !== candidate.branch) throw Error('ข้อมูลบริษัทเปลี่ยน กรุณาค้นหาใหม่');
  return companyFields(contact, details);
 }));
}
function companyFields(contact, detail) {
 return {
  name: contact.name, branch: contact.branch,
  phone: String(detail.contactMobile || detail.contactNumber || detail.contactPhone || '').trim(),
  code: String(detail.contactCode || contact.id),
 };
}
async function body(req){
 let data = req.body;
 if (data == null) {
  data = '';
  for await (const part of req) {
   data += part;
   if (data.length > 200000) throw Error('Request too large');
  }
 }
 const raw = typeof data === 'string' || Buffer.isBuffer(data) ? String(data) : JSON.stringify(data);
 if (raw.length > 200000) throw Error('Request too large');
 return JSON.parse(raw || '{}');
}
export async function handler(req,res){
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 const reply=(status,data)=>{res.writeHead(status);res.end(JSON.stringify(data));};
 const host = req.headers.host;
 const origin = req.headers.origin;
 if (hosted) {
  if (origin && origin !== 'https://' + host) return reply(403, {message: 'Invalid origin'});
 } else {
  if (!['127.0.0.1:4319','localhost:4319'].includes(host)) return reply(403,{message:'Invalid host'});
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return reply(403,{message:'Invalid origin'});
 }
 const u=new URL(req.url,'http://localhost');const route=u.pathname.replace('/integration/flowaccount','');
 if(!u.pathname.startsWith('/integration/flowaccount/'))return reply(404,{message:'Not found'});
 if(environment !== 'v1' || !source || !sb || !config.SUPABASE_PUBLISHABLE_KEY) return reply(503,{message:'TeraCoin ต้องเชื่อม FlowAccount Production ใน .env.flowaccount'});
 if (hosted && route === '/sales-review/cron' && req.method === 'GET') {
  if (!validCron(req.headers.authorization, config.CRON_SECRET)) return reply(401, {message: 'Unauthorized'});
  try { return reply(200, await hostedReview.refresh()); }
  catch (error) { return reply(502, {message: error.message || 'ดึงรายงานยอดขายไม่สำเร็จ'}); }
 }
 // Exact-tax signup lookup provides the requested contact fields; it never
 // returns credentials, purchase records or Coin balances.
 if(req.method==='POST'&&route==='/lookup-company'){
  try{
   const key=req.socket.remoteAddress||'local',now=Date.now();let limit=lookupLimits.get(key);
   if(!limit||now-limit.start>60000){limit={start:now,count:0};lookupLimits.set(key,limit);}
   if(++limit.count>30)return reply(429,{message:'ค้นหาถี่เกินไป กรุณารอสักครู่'});
   if(lookupLimits.size>1000)for(const [ip,v] of lookupLimits)if(now-v.start>60000)lookupLimits.delete(ip);
   const b=await body(req);if(!/^[0-9]{13}$/.test(b.tax||''))return reply(400,{message:'กรอกเลขผู้เสียภาษีให้ครบ 13 หลัก'});
   const companies=await findTaxCompanies(b.tax);
   if (!companies) return reply(400,{message:'พบหลายรายการ กรุณาติดต่อผู้ดูแล'});
   return reply(200,{companies});
  }catch{return reply(503,{message:'ค้นหา FlowAccount ยังไม่สำเร็จ กรอกข้อมูลเองเพื่อส่งให้ผู้ดูแลตรวจสอบได้'});}
 }
 const authorization=req.headers.authorization;if(!authorization?.startsWith('Bearer '))return reply(401,{message:'เข้าสู่ระบบ Admin ก่อน'});
 try{
  const user=await supabase('/auth/v1/user',authorization);
  const profiles=await supabase('/rest/v1/tc_profiles?select=role&id=eq.'+encodeURIComponent(user.id),authorization);
  if (req.method === 'GET' && route === '/customer-coin') {
   if (environment !== 'v1') return reply(503, {message: 'เปิดยอดซื้อ EPC เมื่อเชื่อม FlowAccount Production'});
   if (profiles[0]?.role !== 'customer') return reply(403, {message: 'สำหรับบัญชีลูกค้า EPC'});
   const active = await supabase('/rest/v1/tc_profiles?select=id&account_status=eq.active&id=eq.'+encodeURIComponent(user.id),authorization);
   if (!active.length) return reply(403, {message: 'บัญชี EPC ยังไม่พร้อมใช้งาน'});
   const page = Number(u.searchParams.get('page') || 1);
   if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return reply(400, {message: 'เลขหน้าไม่ถูกต้อง'});
   return reply(200, await loadCustomerCoin(user.id, authorization, page));
  }
  if(profiles[0]?.role!=='admin')return reply(403,{message:'Admin only'});
  if (req.method === 'GET' && route === '/admin-customers') {
   const page = Number(u.searchParams.get('page') || 1);
   const search = (u.searchParams.get('search') || '').normalize('NFKC').trim().toLowerCase();
   if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || search.length > 100) {
    return reply(400, {message: 'คำค้นหรือเลขหน้าไม่ถูกต้อง'});
   }
   const contactsList = await contacts({fresh: u.searchParams.get('refresh') === '1'});
   const matches = contactsList.flatMap(raw => {
    const contact = normalizeContact(raw);
    if (!/^\d+$/.test(contact.id) || !/^\d{13}$/.test(contact.tax) || !contact.branch || !contact.name) return [];
    const code = String(raw.contactCode || contact.id);
    if (search && ![contact.name, contact.tax, code]
      .some(value => value.normalize('NFKC').toLowerCase().includes(search))) return [];
    return [{...contact, code}];
   }).sort((a, b) => a.name.localeCompare(b.name, 'th') || a.branch.localeCompare(b.branch) || a.id.localeCompare(b.id));
   const pageSize = 15;
   return reply(200, {customers: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize});
  }
  if (req.method === 'POST' && route === '/admin-lookup-company') {
   if (environment !== 'v1') return reply(503, {message: 'การค้นหาลูกค้าจริงต้องเชื่อม FlowAccount Production'});
   const {tax, contactId} = await body(req);
   if (!/^\d{13}$/.test(tax || '')) return reply(400, {message: 'กรอกเลขผู้เสียภาษีให้ครบ 13 หลัก'});
   if (contactId !== undefined) {
    if (typeof contactId !== 'string' || !/^\d{1,20}$/.test(contactId)) return reply(400, {message: 'รหัสลูกค้าไม่ถูกต้อง'});
    const detail = contactRows(await flow('contacts/' + contactId))
     .find(row => String(row.id ?? row.contactId) === contactId);
    const contact = detail && normalizeContact(detail);
    if (!contact || contact.tax !== tax || !contact.branch || !contact.name) {
     return reply(409, {message: 'ข้อมูลลูกค้าเปลี่ยน กรุณาโหลดรายชื่อใหม่'});
    }
    return reply(200, {companies: [companyFields(contact, detail)]});
   }
   const companies = await findTaxCompanies(tax, true);
   if (!companies) return reply(400, {message: 'พบหลายรายการ กรุณาตรวจรายชื่อลูกค้าใน FlowAccount'});
   return reply(200, {companies, loadedAt: new Date().toISOString()});
  }
  if (req.method === 'POST' && route === '/customer-purchases') {
   if (environment !== 'v1') return reply(503, {message: 'ยอดซื้อจริงต้องเชื่อม FlowAccount Production'});
   const {tax, branch, code} = await body(req);
   if (!/^\d{13}$/.test(tax || '') || !/^\d{5}$/.test(branch || '') ||
       typeof code !== 'string' || !code || code.length > 100) {
    return reply(400, {message: 'กรุณาเลือกบริษัทและสาขาจากผลค้นหา'});
   }
   const candidates = (await contacts()).map(normalizeContact)
    .filter(contact => contact.tax === tax && contact.branch === branch && contact.name);
   if (!candidates.length || candidates.length > 20) return reply(409, {message: 'กรุณาค้นหาและเลือกบริษัทอีกครั้ง'});
   const verified = await Promise.all(candidates.map(async candidate => {
    const detail = contactRows(await flow('contacts/' + encodeURIComponent(candidate.id)))
     .find(row => String(row.id ?? row.contactId) === candidate.id);
    if (!detail) return null;
    const contact = normalizeContact(detail);
    return contact.tax === tax && contact.branch === branch &&
     String(detail.contactCode || contact.id) === code ? contact : null;
   }));
   const matches = verified.filter(Boolean);
   if (matches.length !== 1) return reply(409, {message: 'ยืนยันลูกค้า FlowAccount ไม่ได้ กรุณาค้นหาใหม่'});
   return reply(200, {...await loadCustomerPurchases(flow, matches[0]), loadedAt: new Date().toISOString()});
  }
  if (route === '/sales-review/product-groups') {
   if (req.method === 'GET') return reply(200, {groups: await productGroups.read()});
   if (req.method !== 'POST') return reply(405, {message: 'วิธีเรียก API ไม่ถูกต้อง'});
   const group = parseProductGroup(await body(req));
   if (!group) return reply(400, {message: 'กรุณาระบุชื่อสินค้า ยี่ห้อ และหมวดใน CRM'});
   await productGroups.save(group, user.id);
   return reply(200, {group});
  }
  if (route === '/sales-review/seller-groups') {
   if (req.method === 'POST') {
    const group = parseSellerGroup(await body(req));
    if (!group) return reply(400, {message: 'เลือกอย่างน้อยสองชื่อและระบุชื่อหลัก'});
    await sellerGroups.confirm(group, user.id);
   } else if (req.method !== 'GET') return reply(405, {message: 'วิธีเรียก API ไม่ถูกต้อง'});
   return reply(200, {groups: await sellerGroups.read()});
  }
  if (req.method === 'GET' && route === '/sales-review/sale-success') {
   if (environment !== 'v1') return reply(503, {message: 'ต้องเชื่อม FlowAccount Production'});
   if (!saleSuccessPending && (!saleSuccessCache || Date.now() - Date.parse(saleSuccessCache.loadedAt) >= 300000)) {
    saleSuccessPending = (async () => {
     const snapshot = hosted ? JSON.parse(await hostedReview.data()) : null;
     return loadSaleSuccess(flow, snapshot?.meta.receiptNetVersion === 1 ? snapshot.receiptTotals : [], {trace: true});
    })()
     .then(data => (saleSuccessCache = data))
     .finally(() => { saleSuccessPending = undefined; });
   }
   return reply(200, saleSuccessPending ? await saleSuccessPending : saleSuccessCache);
  }
  if (req.method === 'GET' && route === '/sales-review/product-audit') {
   if (environment !== 'v1') return reply(503, {message: 'ต้องเชื่อม FlowAccount Production'});
   const sheet = JSON.parse(await readFile(new URL('./sales-review-product-segments.json', import.meta.url), 'utf8'));
   const segments = buildModelSegments(sheet);
   const items = new Map();
   for (let page = 1; page <= 100; page++) {
    const result = await flow(`products?currentPage=${page}&pageSize=200`);
    const list = result?.data?.list;
    if (result.status === false || !Array.isArray(list)) throw Error('อ่านรายการสินค้า FlowAccount ไม่สำเร็จ');
    for (const product of list) items.set(product.id ?? JSON.stringify([product.code, product.name]), product);
    const total = Number(result.data.total);
    if (!list.length || (total > 0 ? items.size >= total : list.length < 200)) {
     if (total > items.size) throw Error('รายการสินค้า FlowAccount มาไม่ครบ');
     const models = new Map(sheet.map(([, , model]) => [modelKey(model), model]));
     const seen = new Set();
     const rows = [...items.values()].map(product => {
      const key = modelKey(product.name);
      const match = segments.get(key);
      seen.add(key);
      const [crmBrand, crmCategory] = classify(String(product.name ?? ''));
      return {name: product.name, code: product.code, category: product.categoryName, model: models.get(key), crmBrand, crmCategory,
       main: match?.main, group: match?.group, status: match ? 'matched' : match === null ? 'conflict' : 'flow-only'};
     });
     for (const [main, group, model] of sheet) {
      const key = modelKey(model);
      if (!seen.has(key)) rows.push({model, main, group, status: segments.get(key) === null ? 'conflict' : 'sheet-only'});
     }
     return reply(200, {rows});
    }
   }
   throw Error('รายการสินค้า FlowAccount เกินขอบเขตที่ตรวจสอบได้');
  }
  if (req.method === 'GET' && route === '/sales-review/receipt-items') {
   const id = u.searchParams.get('id') || '';
   if (!/^\d{1,20}$/.test(id)) return reply(400, {message: 'รหัสใบเสร็จไม่ถูกต้อง'});
   const receipt = await fetchSalesDocument('receipts/' + id, id);
   if (String(receipt.status) !== '5' || String(receipt.statusString).toLowerCase() !== 'paid') {
    return reply(404, {message: 'ไม่พบใบเสร็จที่ชำระครบ'});
   }
   const direct = documentItems(receipt).filter(item => item.name.trim() && !/^[-–—]+$/.test(item.name.trim()));
   const toItems = (items, source) => items.map(({name, quantity, unit}) => ({name, quantity, unit, source}));
   const sources = new Map();
   for (const ref of [...(receipt.items || []), ...(receipt.documentReference || []), ...(receipt.referencedByMe || [])]) {
    const type = String(ref.documentType ?? ref.referenceDocumentType ?? (ref.documentId ? 7 : ''));
    const refId = String(ref.documentId ?? ref.referenceId ?? '');
    if (!['7', '35'].includes(type) || !/^\d{1,20}$/.test(refId)) continue;
    sources.set(type + ':' + refId, {type, refId, number:ref.documentSerial ?? ref.referenceDocumentSerial});
   }
   let items = toItems(direct, receipt.documentSerial);
   let quotePayment;
   const installmentLines = (receipt.items ?? []).filter(item => depositPattern.test(String(item.name ?? '') + ' ' + String(item.description ?? '')));
   if (installmentLines.length) {
    const numbers = [...new Set(installmentLines.flatMap(item => reviewQuoteNumbers(item, receipt)))];
    if (numbers.length === 1) {
     const [number] = numbers;
     const query = new URLSearchParams({searchString:number, currentPage:'1', pageSize:'20'});
     const result = await flow('quotations?' + query);
     const matches = documents(result).filter(document => String(document.documentSerial).toUpperCase() === number &&
      receipt.contactId != null && String(document.contactId) === String(receipt.contactId) &&
      !/void|cancel|draft/i.test(String(document.statusString ?? '')));
     if (matches.length === 1) {
      const quote = matches[0];
      const quoteProducts = documentItems(quote);
      if (quoteProducts.some(product => classify(product.name)[0] === 'Sigenergy')) {
       items = quoteProducts.map(({name, quantity, unit, total}) => ({name, quantity, unit, quoteAmount:total, source:number}));
       const snapshot = hosted ? await hostedReview.data() : null;
       const data = snapshot ? JSON.parse(snapshot) : null;
       const splitIds = new Set(data?.splitInstallmentReceiptIds ?? []);
       const receiptTotals = (data?.receiptTotals ?? []).filter(row => !splitIds.has(String(row[0])));
       const auditedInvoiceIds = data?.installments?.find(payment => payment.number === number)?.invoices.map(invoice => invoice.id) ?? [];
       const invoiceIds = new Set((quote.referencedToMe ?? [])
        .filter(link => String(link.referenceId) === String(quote.documentId ?? quote.recordId) &&
         String(link.documentType) === '7' && /^\d+$/.test(String(link.documentId)))
        .map(link => String(link.documentId)));
       // The quotation's deposit history in FlowAccount confirms this link.
       for (const id of auditedInvoiceIds) if (/^\d+$/.test(id)) invoiceIds.add(id);
       if (number === 'QT2026100031') invoiceIds.add('98747912');
       const invoiceResults = await Promise.allSettled([...invoiceIds].map(id => fetchSalesDocument('tax-invoices/' + id, id)));
       const invoices = invoiceResults.flatMap(result => result.status === 'fulfilled' &&
        String(result.value.contactId) === String(receipt.contactId) &&
        (invoiceIds.has(String(result.value.documentId ?? result.value.recordId))) &&
        !/void|cancel|draft/i.test(String(result.value.statusString ?? '')) &&
        (number !== 'QT2026100031' || String(result.value.documentId ?? result.value.recordId) !== '98747912' ||
         String(result.value.documentSerial ?? '').toUpperCase() === 'INV2026100034')
        ? [result.value] : []);
       const auditedPayment = data?.installments?.find(payment => payment.number === number);
       const traced = new Map((auditedPayment?.receipts ?? []).map(item => [item.id,
        {...item, netCents: Math.round(item.net * 100)}]));
       quotePayment = summarizeQuotePayments(quote, receipt, receiptTotals, splitIds.has(id) ? null : receiptNetBeforeVat(receipt), invoices, traced);
      }
     }
    }
   }
   if (quotePayment) return reply(200, {items, quotePayment, missing:[]});
   const missing = [];
   const seen = new Set();
   const addInvoice = (invoice, number) => {
    const serial = String(invoice.documentSerial || number).toUpperCase();
    if (seen.has(serial)) return;
    seen.add(serial);
    const products = documentItems(invoice).filter(item => item.name.trim() && !/^[-–—]+$/.test(item.name.trim()));
    if (products.length) items.push(...toItems(products, serial));
    else missing.push(serial);
   };
   for (const {type, refId, number} of sources.values()) {
    try {
     const invoice = await fetchSalesDocument(referenceTypes[type] + '/' + refId, refId);
     addInvoice(invoice, number || refId);
    } catch (error) {
     if (error.retryAfter) throw error;
     missing.push(number || refId);
    }
   }
   if (!direct.length || direct.some(item => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) === 0)) {
    const references = [receipt.reference, ...[...(receipt.items || []), ...(receipt.documentReference || []), ...(receipt.referencedByMe || [])]
      .flatMap(ref => [ref.documentSerial, ref.referenceDocumentSerial])];
    const numbers = new Set(references.flatMap(value => String(value ?? '').toUpperCase().match(/\bINV[0-9][A-Z0-9-]{3,25}\b/g) || []));
    for (const number of [...numbers].filter(number => !seen.has(number)).slice(0, 10)) {
     const query = new URLSearchParams({searchString:number, currentPage:'1', pageSize:'20'});
     const response = await flow('tax-invoices?' + query);
     const matches = documents(response).filter(invoice => String(invoice.documentSerial).toUpperCase() === number &&
      receipt.contactId != null && String(invoice.contactId) === String(receipt.contactId));
     if (matches.length === 1) addInvoice(matches[0], number);
     else missing.push(number);
    }
   }
   return reply(200, {items, missing:[...new Set(missing)].filter(number => !items.some(item => item.source === number))});
  }
  if (req.method === 'GET' && route === '/sales-review/deposit') {
   const id = u.searchParams.get('id') || '';
   if (!/^\d{1,20}$/.test(id)) return reply(400, {message: 'รหัสใบเสร็จไม่ถูกต้อง'});
   const receipt = await fetchSalesDocument('receipts/' + id, id);
   const deposits = (receipt.items || []).filter(item => /มัดจำ|deposit|ชำระล่วงหน้า|เงินล่วงหน้า/i.test(item.name || ''));
   if (!deposits.length || String(receipt.status) !== '5' || String(receipt.statusString).toLowerCase() !== 'paid') {
    return reply(404, {message: 'ไม่พบใบเสร็จมัดจำที่ชำระครบ'});
   }
   const numbers = [...new Set(deposits.flatMap(item => String(item.description || '').match(/\bQT[0-9][A-Z0-9-]{3,25}\b/gi) || []).map(s => s.toUpperCase()))];
   if (numbers.length > 10) return reply(400, {message: 'มีเอกสารอ้างอิงหลายฉบับ กรุณาตรวจใน FlowAccount'});
   const sources = await Promise.all(numbers.map(async number => {
    const query = new URLSearchParams({searchString: number, currentPage: '1', pageSize: '20'});
    const result = await flow('quotations?' + query);
    if (result.status === false) throw Error('ค้นหาใบเสนอราคาใน FlowAccount ไม่สำเร็จ');
    const matches = documents(result).filter(doc => String(doc.documentSerial).toUpperCase() === number &&
      doc.contactId != null && receipt.contactId != null && String(doc.contactId) === String(receipt.contactId));
    const quote = matches.length === 1 ? matches[0] : null;
    return {number, products: [...new Set((quote?.items || []).map(item => String(item.name || '').trim()).filter(Boolean))]};
   }));
   return reply(200, {sources});
  }
  if (route === '/sales-review/refresh') {
   if (req.method === 'GET') return reply(200, hosted ? await hostedReview.status() : reviewSync.status());
   if (req.method === 'POST') {
    if (!hosted) return reply(202, reviewSync.start());
    return reply(200, await hostedReview.refresh());
   }
  }
  if (req.method === 'GET' && route === '/sales-review') {
   let html;
   if (hosted) {
    const data = await hostedReview.data();
    if (!data) return reply(404, {message: 'กดดึงข้อมูลล่าสุดเพื่อสร้างรายงานยอดขายครั้งแรก'});
    const template = await readFile(new URL('./sales-review-template.html', import.meta.url), 'utf8');
    html = template.replace('__DATA__', () => data.replace(/</g, '\\u003c'));
   } else {
    try { html = await readFile(reportPath, 'utf8'); }
    catch (error) {
     if (error.code === 'ENOENT') return reply(503, {message: 'ยังไม่มีไฟล์รายงานยอดขายบนเซิร์ฟเวอร์'});
     throw error;
    }
   }
   const [reportCss, reportExport, reportAnalysis, reportDashboard, productSegments] = await Promise.all([
    readFile(new URL('./sales-review.css', import.meta.url), 'utf8'),
    readFile(new URL('./sales-review-export.js', import.meta.url), 'utf8'),
    readFile(new URL('./sales-review-analysis.js', import.meta.url), 'utf8'),
    readFile(new URL('./sales-review-dashboard.js', import.meta.url), 'utf8'),
    readFile(new URL('./sales-review-product-segments.json', import.meta.url), 'utf8'),
   ]);
   html = html
    .replace('</head>', () => `<style>${reportCss}</style></head>`)
    .replace('<div class="filters">', '<div id="exportStatus" role="status"></div><div class="filters">')
    .replace('</div><div id="exportStatus"', '<button id="exportExcel" type="button">ส่งออก Excel</button></div><div id="exportStatus"')
    .replace('</body>', () => `<script>${reportExport}</script><script>const reportProductSegments = ${productSegments.replace(/</g, '\\u003c')};
const modelKey = ${modelKey.toString()};
${buildModelSegments.toString()}
${reportAnalysis}</script><script>${reportDashboard}</script></body>`);
   res.setHeader('Content-Type', 'text/html; charset=utf-8');
   res.setHeader('X-Content-Type-Options', 'nosniff');
   res.setHeader('Content-Security-Policy', "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
   if (hosted && /(?:^|[, ])gzip(?:[, ;]|$)/i.test(req.headers['accept-encoding'] || '')) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.writeHead(200);
    const gzip = createGzip();
    gzip.pipe(res);
    gzip.end(html);
    return;
   }
   res.writeHead(200);
   return res.end(html);
  }
  const canCredit=environment==='v1'&&config.FLOWACCOUNT_ENABLE_CREDIT==='true';
  if(req.method==='GET'&&route==='/company-requests'){
   const allRequests = await supabase('/rest/v1/tc_epc_requests?select=*&order=updated_at.desc',authorization);
   const requests = allRequests.filter(request =>
    !request.approved_environment || (request.approved_environment === environment && request.approved_source === source));
   const list=await contacts();
   return reply(200,{environment,requests:requests.map(r=>({...r,candidates:matchContacts(r,list)}))});
  }
  if(req.method==='POST'&&route==='/approve-company'){
   const b=await body(req);if(!/^[-a-f0-9]{36}$/i.test(b.profileId||'')||!/^\d+$/.test(String(b.contactId||'')))return reply(400,{message:'ข้อมูลคำขอไม่ถูกต้อง'});
   const requests=await supabase('/rest/v1/tc_epc_requests?select=*&profile_id=eq.'+b.profileId,authorization);const request=requests[0];
   if(!request||request.status!=='pending')return reply(400,{message:'คำขอนี้ไม่อยู่ระหว่างรออนุมัติ'});
   const payload=await flow('contacts/'+encodeURIComponent(b.contactId));
   const raw=contactRows(payload).find(c=>String(c.id??c.contactId)===String(b.contactId));
   const matched=raw&&matchContacts(request,[raw])[0];if(!matched)return reply(400,{message:'เลขผู้เสียภาษีหรือสาขาไม่ตรงกับ FlowAccount'});
   const result=await supabase('/rest/v1/rpc/tc_approve_epc',authorization,'POST',{profile:b.profileId,expected:b.updatedAt,src:source,env:environment,contact:normalizeContact(raw)});
   return reply(200,result);
  }
  if (req.method === 'GET' && route === '/sales-documents') {
   const type = u.searchParams.get('type');
   const page = Number(u.searchParams.get('page') || 1);
   const search = (u.searchParams.get('search') || '').trim();
   if (!salesDocumentTypes.has(type) || !Number.isSafeInteger(page) || page < 1 || search.length > 150) {
    return reply(400, {message: 'ประเภทเอกสาร หน้า หรือคำค้นไม่ถูกต้อง'});
   }

   const pageSize = 20;
   const query = new URLSearchParams({currentPage: String(page), pageSize: String(pageSize)});
   if (search) query.set('searchString', search);
   const path = type + '?' + query;
   const refresh = u.searchParams.get('refresh') === '1';
   return await replyCachedSales(path, () => fetchSalesPage(path, page, pageSize), res, reply, refresh);
  }
  if (req.method === 'GET' && route === '/sales-document') {
   const type = u.searchParams.get('type');
   const id = u.searchParams.get('id') || '';
   if (!salesDocumentTypes.has(type) || !/^[1-9]\d{0,19}$/.test(id)) {
    return reply(400, {message: 'ประเภทหรือรหัสเอกสารไม่ถูกต้อง'});
   }
   return await replyCachedSales(type + '/' + id, () => fetchSalesDetail(type, id), res, reply);
  }

  const syncCoins = req.method === 'POST' && route === '/sync-receipt-coins';
  if (syncCoins && !canCredit) return reply(403,{message:'การบันทึกแต้มจากใบเสร็จเปิดใช้สำหรับ Production ที่ตั้งค่าแล้ว'});
  if((req.method==='GET'&&route==='/receipts')||syncCoins){
   const page=Number(u.searchParams.get('page')||1);if(!Number.isInteger(page)||page<1||page>10000)return reply(400,{message:'Invalid page'});
   const result=await flow(`receipts?currentPage=${page}&pageSize=20`);const rows=documents(result);const resultRows=[];
   for(const r of rows){try{const c=await canonical(r.documentId??r.recordId);resultRows.push({id:String(r.documentId??r.recordId),company:r.contactName,contactId:String(r.contactId||''),documentNumber:r.documentSerial,status:r.statusString,sales:c.sales,purchases:c.purchases,error:c.eligibilityError});}catch(e){resultRows.push({id:String(r.documentId??r.recordId),company:r.contactName,contactId:String(r.contactId||''),documentNumber:r.documentSerial,status:r.statusString,sales:[],purchases:purchaseLines(r),error:e.message});}}
   let mappings=[],epcs=[],imports=[],setupRequired=false;
   try{[mappings,epcs,imports]=await Promise.all(['tc_flow_product_map','tc_flow_epcs','tc_flow_imports'].map(t=>supabase(`/rest/v1/${t}?source=eq.${encodeURIComponent(source)}&environment=eq.${environment}&select=*`,authorization)));}catch{setupRequired=true;}
   if (syncCoins && setupRequired) return reply(503,{message:'ยังอ่านข้อมูลเชื่อมบัญชี EPC ไม่สำเร็จ'});
   const sync = {credited: 0, duplicates: 0, skipped: [], tc: 0};
   // Publish only linked companies' sanitized receipt previews. Customer RLS
   // never exposes catalog cost, commissions or another company's purchases.
   let previewSyncError=null;
   if(!setupRequired&&epcs.length){try{
    const settings=(await supabase('/rest/v1/tc_settings?id=eq.1&select=*',authorization))[0];
    const products=[];for(let offset=0;;offset+=200){const rows=await supabase('/rest/v1/stock_profit?select=*&order=id.asc&limit=200&offset='+offset,authorization);products.push(...rows);if(rows.length<200)break;}
    if (syncCoins) {
     const seen = new Set();
     for (const row of resultRows) {
      const link = epcs.find(epc => epc.contact_id === row.contactId);
      const document = row.documentNumber || row.id;
      if (!link || !row.sales.length) {
       sync.skipped.push({document, reason: row.error || 'ยังไม่ได้เชื่อมบัญชี EPC'});
       continue;
      }
      for (const sale of row.sales) {
       if (seen.has(sale.saleKey)) continue;
       seen.add(sale.saleKey);
       try {
        const preview = previewFlowSale(sale, products, settings);
        if (preview.partial) throw Error(preview.errors.join(' · '));
        const result = await creditSale(sale, products, authorization, link.customer_id);
        if (result.duplicate) sync.duplicates++;
        else {
         sync.credited++;
         sync.tc += Number(result.tc);
        }
       } catch (error) {
        sync.skipped.push({document, reason: error.message});
       }
      }
     }
    }
    const previews=resultRows.flatMap(r=>{const link=epcs.find(e=>e.contact_id===r.contactId);if(!link)return [];
     return [{source,environment,receipt_id:r.id,contact_id:r.contactId,customer_id:link.customer_id,document_number:r.documentNumber,status:r.status,updated_at:new Date().toISOString(),summary:{error:r.error,sales:r.sales.map(s=>{const p=previewFlowSale(s,products,settings);return {saleKey:s.saleKey,tc:p.tc,partial:p.partial,lines:p.lines.map(l=>({name:l.name,quantity:l.quantity,tc:l.tc,error:l.error||null}))};})}}];});
    if(previews.length)try{await supabase('/rest/v1/tc_flow_previews?on_conflict=source,environment,receipt_id',authorization,'POST',previews,'resolution=merge-duplicates,return=minimal');}catch{previewSyncError='บันทึกสถานะตัวอย่างในหน้าบัญชี EPC ไม่สำเร็จ';}
   }catch(error){if(syncCoins) return reply(503,{message:error.message});previewSyncError='แสดงผลคำนวณได้ แต่ยังอัปเดตหน้าบัญชี EPC ไม่สำเร็จ';}}
   if (syncCoins) {
    if (!epcs.length) sync.skipped = resultRows.map(row => ({document: row.documentNumber || row.id, reason: 'ยังไม่ได้เชื่อมบัญชี EPC'}));
    return reply(200, {...sync, previewSyncError});
   }
   return reply(200,{source,environment,canCredit,setupRequired,previewSyncError,page,total:Number(result.data?.totalDocument||rows.length),receipts:resultRows,mappings,epcs,imports});
  }
  if(req.method==='POST'&&route==='/mapping'){
   const b=await body(req);if(typeof b.productKey!=='string'||!b.productKey||b.productKey.length>200||!/^[-0-9a-f]{36}$/i.test(b.productId||''))return reply(400,{message:'Invalid product mapping'});
   await supabase('/rest/v1/tc_flow_product_map?on_conflict=source,environment,product_key',authorization,'POST',{source,environment,product_key:b.productKey,product_id:b.productId},'resolution=merge-duplicates,return=minimal');return reply(200,{ok:true});
  }
  if(req.method==='POST'&&route==='/credit'){
   if(!canCredit)return reply(403,{message:'Sandbox ใช้ตรวจข้อมูลเท่านั้น ยังไม่เพิ่ม Coin จริง'});
   const b=await body(req);if(!/^\d+$/.test(String(b.receiptId||'')))return reply(400,{message:'Invalid receipt ID'});
   const c=await canonical(b.receiptId);const sale=c.sales.find(s=>s.saleKey===b.saleKey);if(!sale)return reply(400,{message:c.eligibilityError||'ไม่พบยอดขายที่เข้าเงื่อนไข'});
   const products=[];for(let offset=0;;offset+=200){const page=await supabase('/rest/v1/stock_profit?select=*&order=id.asc&limit=200&offset='+offset,authorization);products.push(...page);if(page.length<200)break;}
   return reply(200, await creditSale(sale, products, authorization, b.customerId||null));
  }
  return reply(405,{message:'Unsupported operation'});
 }catch(e){return reply(e.status===401?401:400,{message:e.message||'FlowAccount request failed'});}
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
 http.createServer(handler).listen(4319, '127.0.0.1', () => {
  reviewSync.schedule();
  console.log('FlowAccount bridge listening on 127.0.0.1:4319; ' + environment + '; credentials hidden');
 });
}
