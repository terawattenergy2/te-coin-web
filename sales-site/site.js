import {createSellerReview} from './seller-review.js';
import {createSaleSuccess} from './sale-success.js';
import {authUrl, publishableKey} from './auth-config.js';

const $ = id => document.getElementById(id);
const storageKey = 'terawatt.sales.session';
const frame = $('frame');
let session;
let refreshPromise;
let loginEpoch = 0;
let selectedView = 'sales';
let auditRows;
let auditBusy = false;
const views = $('views');
const audit = $('audit');
const success = $('success');
const sellerGroupsPanel = $('seller-groups');
let sellerAliases = new Map();
let rawReport;
let quotePending;
let quoteNamesLoaded = false;
let groupReadSucceeded = false;
const canonicalSeller = name => sellerAliases.get(String(name ?? '').trim()) ?? name;
const saleSuccess = createSaleSuccess(loadQuotes, canonicalSeller);
const sellerReview = createSellerReview(async payload => json(await reportRequest('confirm-sellers', 'POST', undefined, payload)), updateGroups);

async function loadQuotes() {
  if (quotePending) return quotePending;
  const epoch = loginEpoch;
  const request = reportRequest('sale-success').then(json).then(data => {
    if (epoch === loginEpoch) {
      quoteNamesLoaded = true;
      sellerReview.addNames(data.rows.map(row => row.seller));
      sellerReview.status('');
    }
    return data;
  }).finally(() => { if (quotePending === request) quotePending = undefined; });
  quotePending = request;
  return request;
}
function updateGroups(groups) {
  sellerAliases = new Map(groups.flatMap(group => group.names.map(name => [name, group.canonical])));
  sellerReview.showGroups(groups);
  saleSuccess.regroup();
  if (rawReport) setReportFrame();
}
async function reviewSellerNames() {
  const epoch = loginEpoch;
  if (!groupReadSucceeded) {
    try {
      const {groups} = await json(await reportRequest('seller-groups'));
      if (epoch !== loginEpoch) return;
      groupReadSucceeded = true;
      updateGroups(groups);
    } catch (error) {
      if (epoch === loginEpoch) sellerReview.status(error.message);
      return;
    }
  }
  if (!quoteNamesLoaded) {
    sellerReview.status('กำลังโหลดชื่อเพิ่มเติมจากใบเสนอราคา ใช้ชื่อจากใบเสร็จระหว่างรอได้');
    try { await loadQuotes(); }
    catch (error) { if (epoch === loginEpoch) sellerReview.status(error.message); }
  }
}
const labels = new Map([
  ['matched', 'จับคู่แล้ว'],
  ['flow-only', 'มีใน FlowAccount เท่านั้น'],
  ['sheet-only', 'มีใน Sheet เท่านั้น'],
  ['conflict', 'พบหลายกลุ่มใน Sheet'],
]);
for (const [value, label] of labels) $('audit-filter').add(new Option(label, value));

function showView(view) {
  selectedView = view;
  frame.classList.toggle('dashboard-frame', view === 'dashboard');
  if (view !== 'dashboard') document.body.classList.remove('dashboard-detail-open');
  for (const button of views.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  const checking = view === 'audit';
  $('title').textContent = views.querySelector('[aria-pressed="true"]').textContent;
  const measuring = view === 'success';
  const grouping = view === 'seller-groups';
  $('report').hidden = checking || measuring || grouping;
  sellerGroupsPanel.hidden = !grouping;
  success.hidden = !measuring;
  audit.hidden = !checking;
  if (checking && !auditRows) loadAudit();
  if (measuring) saleSuccess.open();
  if (grouping) reviewSellerNames();
  if (!checking && !measuring && !grouping) showReportView();
}

function showReportView() {
  frame.contentWindow?.postMessage({type: 'crm-report-view', view: selectedView}, '*');
}
frame.addEventListener('load', showReportView);
views.addEventListener('click', event => {
  const view = event.target.closest('button')?.dataset.view;
  if (view) showView(view);
});

function renderAudit() {
  const query = $('audit-search').value.trim().normalize('NFKC').toLowerCase();
  const filter = $('audit-filter').value;
  const rows = auditRows.filter(row => (!filter || row.status === filter) &&
    [row.name, row.code, row.category, row.model, row.main, row.group]
      .some(value => String(value ?? '').normalize('NFKC').toLowerCase().includes(query)));
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const value of [row.name, row.code, row.category, row.model, row.main, row.group, labels.get(row.status)]) {
      const td = document.createElement('td');
      td.textContent = value || '—';
      tr.append(td);
    }
    fragment.append(tr);
  }
  $('audit-rows').replaceChildren(fragment);
  $('audit-status').textContent = rows.length ? `แสดง ${rows.length.toLocaleString('th-TH')} จาก ${auditRows.length.toLocaleString('th-TH')} รายการ` : 'ไม่พบรายการตามตัวกรอง';
}

async function loadAudit() {
  if (auditBusy) return;
  const epoch = loginEpoch;
  auditBusy = true;
  $('audit-refresh').disabled = true;
  $('audit-status').textContent = 'กำลังโหลดรายการสินค้าจาก FlowAccount…';
  try {
    const {rows} = await json(await reportRequest('audit'));
    if (epoch !== loginEpoch) return;
    auditRows = rows.filter(row => !/^[–—-]+$/.test(String(row.name ?? '').trim()));
    renderAudit();
  } catch (error) {
    if (epoch === loginEpoch) $('audit-status').textContent = error.message;
  } finally {
    if (epoch === loginEpoch) {
      auditBusy = false;
      $('audit-refresh').disabled = false;
    }
  }
}
$('audit-search').oninput = $('audit-filter').onchange = () => {
  if (auditRows && !auditBusy) renderAudit();
};
$('audit-refresh').onclick = loadAudit;
try { session = JSON.parse(sessionStorage.getItem(storageKey)); } catch {}
const status = text => {
  const signingIn = !$('login-panel').hidden;
  $('login-status').textContent = signingIn ? text : '';
  $('status').textContent = signingIn ? '' : text;
};
function setLoginVisible(visible) {
  $('login-panel').hidden = !visible;
  document.body.classList.toggle('login-mode', visible);
}
function save(next) {
  session = next;
  if (next) sessionStorage.setItem(storageKey, JSON.stringify(next));
  else sessionStorage.removeItem(storageKey);
}
async function json(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(Error(data.message || data.msg || data.error_description || 'ทำรายการไม่สำเร็จ'), {status: response.status});
  return data;
}
function tokenRequest(grant, body) {
  return fetch(authUrl + '/auth/v1/token?grant_type=' + grant, {method:'POST',
    headers:{apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)}).then(json);
}
async function reportRequest(route, method = 'GET', id, payload) {
  if (!session?.access_token) throw Error('กรุณาเข้าสู่ระบบ');
  if (session.expires_at * 1000 <= Date.now() + 30000) {
    const epoch = loginEpoch;
    refreshPromise ??= tokenRequest('refresh_token', {refresh_token:session.refresh_token})
      .then(next => { if (epoch === loginEpoch) save(next); }).finally(() => { refreshPromise = undefined; });
    await refreshPromise;
    if (epoch !== loginEpoch || !session) throw Error('กรุณาเข้าสู่ระบบ');
  }
  const params = new URLSearchParams({route});
  if (id) params.set('id', id);
  const headers = {Authorization:'Bearer '+session.access_token};
  if (payload) headers['Content-Type'] = 'application/json';
  return fetch('/api/report?' + params, {method, headers, body:payload && JSON.stringify(payload), cache:'no-store'});
}
function showLogin(message = '') {
  loginEpoch++;
  save(null);
  selectedView = 'sales';
  auditRows = undefined;
  auditBusy = false;
  $('audit-refresh').disabled = false;
  $('audit-rows').replaceChildren();
  $('audit-search').value = $('audit-filter').value = '';
  $('title').textContent = 'ยอดขายตามเซลส์';
  views.hidden = audit.hidden = success.hidden = sellerGroupsPanel.hidden = true;
  rawReport = quotePending = undefined;
  quoteNamesLoaded = groupReadSucceeded = false;
  sellerAliases.clear();
  sellerReview.reset();
  saleSuccess.reset();
  setLoginVisible(true);
  $('logout').hidden = true;
  $('report').hidden = true;
  document.body.classList.remove('dashboard-detail-open');
  frame.removeAttribute('srcdoc');
  frame.hidden = true;
  status(message);
}
const datasetPattern = /(<script id="dataset" type="application\/json">)([\s\S]*?)(<\/script>)/;
function setReportFrame() {
  const {html, dataset} = rawReport;
  const rows = dataset.rows.map(row => {
    const name = canonicalSeller(row[3]);
    if (name === row[3]) return row;
    const grouped = [...row];
    grouped[3] = name;
    return grouped;
  });
  const payload = JSON.stringify({...dataset, rows}).replace(/</g, '\\u003c');
  const groupedHtml = html.replace(datasetPattern, (_, start, original, end) => start + payload + end);
  frame.srcdoc = groupedHtml.replace(/<head>/i, '<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">');
}
async function openReport() {
  const epoch = loginEpoch;
  try {
    const [response, groupResult] = await Promise.all([
      reportRequest('report'),
      reportRequest('seller-groups').then(json).catch(error => ({error})),
    ]);
    if (!response.ok) await json(response);
    const html = await response.text();
    if (epoch !== loginEpoch) return;
    const match = html.match(datasetPattern);
    if (!match) throw Error('ไม่พบข้อมูลรายงาน');
    const dataset = JSON.parse(match[2]);
    if (groupResult.groups) {
      groupReadSucceeded = true;
      sellerAliases = new Map(groupResult.groups.flatMap(group => group.names.map(name => [name, group.canonical])));
      sellerReview.showGroups(groupResult.groups);
      saleSuccess.regroup();
    }
    rawReport = {html, dataset};
    sellerReview.addNames(dataset.rows.map(row => row[3]));
    setReportFrame();
    frame.hidden = false;
    views.hidden = false;
    showView(selectedView);
    $('logout').hidden = false;
    setLoginVisible(false);
    status(groupResult.error ? 'โหลดกลุ่มชื่อเซลส์ไม่ได้ ผลอาจยังแยกตามชื่อในเอกสาร' : '');
  } catch (error) {
    if (epoch !== loginEpoch) return;
    if (error.status === 401 || error.status === 403) showLogin(error.message);
    else if (session) {
      setLoginVisible(false);
      $('report').hidden = false;
      $('logout').hidden = false;
      status(error.message);
    } else showLogin(error.message);
  }
}
$('login').onsubmit = async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  status('กำลังเข้าสู่ระบบ…');
  try {
    save(await tokenRequest('password', {email:$('email').value.trim(), password:$('password').value}));
    $('password').value = '';
    await openReport();
  } catch (error) { showLogin(error.message); }
  finally { button.disabled = false; }
};
$('logout').onclick = () => showLogin();
$('refresh').onclick = async () => {
  $('refresh').disabled = true;
  status('กำลังดึงใบเสร็จจาก FlowAccount…');
  try {
    await json(await reportRequest('refresh','POST'));
    if (session) await openReport();
  } catch (error) { if (session) status(error.message); }
  finally { $('refresh').disabled = false; }
};
window.addEventListener('message', async event => {
  if (event.source !== frame.contentWindow || !session) return;
  if (selectedView === 'dashboard' && event.data?.type === 'crm-dashboard-height') {
    const {height} = event.data;
    if (Number.isInteger(height) && height > 0 && height <= 50000) {
      $('report').style.setProperty('--dashboard-height', height + 'px');
    }
    return;
  }
  if (selectedView === 'dashboard' && event.data?.type === 'crm-dashboard-detail') {
    document.body.classList.toggle('dashboard-detail-open', event.data.open === true);
    return;
  }
  if (event.data?.type !== 'teracoin-deposit-request' ||
      typeof event.data.id !== 'string' || !/^\d{1,20}$/.test(event.data.id)) return;
  const {id} = event.data;
  try {
    const {sources} = await json(await reportRequest('deposit','GET',id));
    if (session) event.source.postMessage({type:'teracoin-deposit-result',id,sources}, '*');
  } catch {
    event.source.postMessage({type:'teracoin-deposit-result',id,error:true}, '*');
  }
});
if (session) openReport(); else showLogin();
