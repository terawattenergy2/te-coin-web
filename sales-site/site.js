import {createSellerReview} from './seller-review.js';
import {createSaleSuccess} from './sale-success.js';
import {authUrl, publishableKey} from './auth-config.js';

const $ = id => document.getElementById(id);
const loaders = new Map();
function beginLoading(area, title, description) {
  const slot = $(area + '-loading');
  const card = $('loading-template').content.firstElementChild.cloneNode(true);
  card.querySelector('strong').textContent = title;
  card.querySelector('small').textContent = description;
  if (!loaders.has(slot)) loaders.set(slot, new Set());
  const active = loaders.get(slot);
  active.add(card);
  slot.replaceChildren(card);
  slot.hidden = false;
  return () => {
    active.delete(card);
    if (loaders.get(slot) !== active) return;
    if (active.size) slot.replaceChildren([...active].at(-1));
    else {
      slot.replaceChildren();
      slot.hidden = true;
      loaders.delete(slot);
    }
  };
}

async function withLoading(area, title, description, action) {
  const finish = beginLoading(area, title, description);
  try { return await action(); }
  finally { finish(); }
}

const storageKey = 'terawatt.sales.session';
const quoteCacheKey = 'terawatt.crm.sale-success.v1';
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
const reviewPanel = $('review');
const reviewViews = $('review-views');
let selectedReview = 'products';
let sellerAliases = new Map();
let rawReport;
let productGroups = new Map();
let productGroupVersion = 0;
let editingProduct;
let savingProduct = false;
const productKey = name => String(name ?? '').normalize('NFKC').trim().toLowerCase()
  .replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/\s+/g, ' ');
let quotePending;
let quoteNamesLoaded = false;
let groupReadSucceeded = false;
const canonicalSeller = name => sellerAliases.get(String(name ?? '').trim()) ?? name;
const saleSuccess = createSaleSuccess(loadQuotes, canonicalSeller, beginLoading, readCachedQuotes, showReceiptProducts, () => rawReport?.dataset);
const sellerReview = createSellerReview(payload => withLoading('seller', 'กำลังบันทึกกลุ่มชื่อเซลส์',
  'กำลังอัปเดตชื่อหลักในรายงาน CRM', async () => json(await reportRequest('confirm-sellers', 'POST', undefined, payload))), updateGroups);

function readCachedQuotes() {
  const owner = session?.user?.id;
  if (!owner) return;
  try {
    const cached = JSON.parse(sessionStorage.getItem(quoteCacheKey));
    if (cached?.owner === owner && Array.isArray(cached.data?.rows) &&
        Number.isFinite(Date.parse(cached.data.loadedAt))) return cached.data;
  } catch {
    // A missing or unreadable cache falls through to the report request.
  }
}

function cacheQuotes(data) {
  const owner = session?.user?.id;
  if (!owner) return;
  try {
    sessionStorage.setItem(quoteCacheKey, JSON.stringify({owner, data}));
  } catch {
    // Keep working in memory if browser storage is unavailable or full.
  }
}

async function loadQuotes() {
  if (quotePending) return quotePending;
  const epoch = loginEpoch;
  const request = reportRequest('sale-success').then(json).then(data => {
    if (epoch === loginEpoch) {
      quoteNamesLoaded = true;
      cacheQuotes(data);
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
  if (groupReadSucceeded && quoteNamesLoaded) return;
  return withLoading('seller', 'กำลังโหลดชื่อเซลส์', 'กำลังอ่านชื่อจากใบเสร็จและใบเสนอราคา', readSellerNames);
}

async function readSellerNames() {
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
    sellerReview.status('');
    try { await loadQuotes(); }
    catch (error) { if (epoch === loginEpoch) sellerReview.status(error.message); }
  }
}
const labels = new Map([
  ['matched', 'จับคู่แล้ว'],
  ['flow-only', 'มีใน FlowAccount เท่านั้น'],
  ['sheet-only', 'มีใน Sheet เท่านั้น'],
  ['conflict', 'พบหลายกลุ่มใน Sheet'],
  ['receipt-only', 'พบชื่อในใบเสร็จ'],
]);
for (const [value, label] of labels) $('audit-filter').add(new Option(label, value));

const projectMoney = new Intl.NumberFormat('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
let projectRows = [];

async function showReceiptProducts(number) {
  const receipts = rawReport?.dataset.receiptTotals ?? [];
  const matches = receipts.filter(receipt => receipt[1] === number);
  const dialog = $('receipt-products');
  const status = $('receipt-products-status');
  const list = $('receipt-products-list');
  $('receipt-products-title').textContent = 'สินค้าในใบเสร็จ ' + number;
  list.replaceChildren();
  status.textContent = matches.length === 1 ? 'กำลังอ่านรายการจาก FlowAccount…' : 'ไม่พบใบเสร็จที่ระบุได้ในรายงาน CRM';
  if (!dialog.open) dialog.showModal();
  if (matches.length !== 1) return;
  const epoch = loginEpoch;
  try {
    const {items, missing, quotePayment} = await json(await reportRequest('receipt-items', 'GET', matches[0][0]));
    if (epoch !== loginEpoch || !dialog.open || $('receipt-products-title').textContent !== 'สินค้าในใบเสร็จ ' + number) return;
    status.textContent = items.length ? 'จำนวนสินค้าตามเอกสารที่แสดงในวงเล็บ' : 'ยังไม่พบรายการสินค้าจากเอกสารต้นทาง';
    if (quotePayment) {
      const {number, net, paid, remaining, receipts, invoices = [], depositPercent} = quotePayment;
      const outstanding = invoices.some(invoice => invoice.awaiting);
      const state = remaining == null ? 'รอตรวจยอดใบเสนอราคา'
        : remaining === 0 ? 'ชำระครบ' : outstanding ? 'รอเก็บเงิน'
        : 'ยังไม่พบใบเสร็จครบตาม QT';
      status.textContent = [number, ...(depositPercent ? ['รับมัดจำ ' + depositPercent + '% แล้ว'] : []),
        remaining > 0 && net > 0 ? 'งวดคงเหลือ ' + projectMoney.format(100 * remaining / net).replace(/\.00$/, '') + '% ' + state : state, ...[
        ['ยอด QT', net], ['ยอดรับแล้วที่จับคู่ได้', paid], ['ยอดคงเหลือตามเอกสารที่จับคู่ได้', remaining],
      ].filter(([, value]) => value != null).map(([label, value]) => label + ' ' + projectMoney.format(value) + ' บาท (ไม่รวม VAT)'),
      'ใบเสร็จที่พบ ' + receipts.map(receipt => receipt.number).join(', ')].join(' · ');
      for (const invoice of invoices) {
        if (!/^\d{1,20}$/.test(invoice.id)) continue;
        const link = document.createElement('a');
        link.href = 'https://advance.flowaccount.com/N355072/business/invoices/' + invoice.id;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = invoice.number;
        status.append(' · ', link);
      }
    }
    if (missing?.length) status.textContent += ' · ยังอ่านรายละเอียดไม่ได้จาก ' + missing.join(', ');
    list.replaceChildren(...items.map(item => {
      const li = document.createElement('li');
      li.textContent = [item.name, !Number.isFinite(Number(item.quantity)) || Number(item.quantity) === 0 ? 'ไม่พบจำนวนในเอกสาร' : [item.quantity, item.unit].filter(value => value != null).join(' ')]
        .join(' · ') + (item.quoteAmount != null ? ' · ยอดรายการตาม QT ' + projectMoney.format(item.quoteAmount) + ' บาท' : '') +
        (item.source ? ' (' + item.source + ')' : '');
      return li;
    }));
  } catch {
    if (epoch === loginEpoch && $('receipt-products-title').textContent === 'สินค้าในใบเสร็จ ' + number) {
      status.textContent = 'อ่านรายละเอียดไม่สำเร็จ กรุณาลองเปิดอีกครั้ง';
    }
  }
}

function renderProjects() {
  const dataset = rawReport?.dataset;
  const projectsReady = dataset?.meta.receiptProjectVersion === 1;
  const receipts = projectsReady ? dataset.receiptTotals : [];
  const select = $('project-name');
  const current = select.value;
  const projects = [...new Set(receipts.map(receipt => receipt[11]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'th'));
  select.replaceChildren(new Option('ทุกโปรเจกต์', ''), ...projects.map(name => new Option(name)));
  if (projects.includes(current)) select.value = current;
  const from = $('project-from').value;
  const to = $('project-to').value;
  const invalidDates = from && to && from > to;
  projectRows = invalidDates ? [] : receipts.filter(receipt =>
    (!select.value || receipt[11] === select.value) && (!from || receipt[2] >= from) && (!to || receipt[2] <= to))
    .sort((a, b) => b[2].localeCompare(a[2]) || b[1].localeCompare(a[1]));
  const total = projectRows.reduce((sum, receipt) => sum + Math.round((receipt[7] ?? 0) * 100), 0);
  const missing = projectRows.filter(receipt => receipt[7] == null).length;
  $('project-summary').textContent = !projectsReady ? 'กรุณากดดึงข้อมูลล่าสุดเพื่อโหลดชื่อโปรเจกต์'
    : invalidDates ? 'วันที่เริ่มต้นต้องอยู่ก่อนหรือเท่ากับวันที่สิ้นสุด'
    : `${projectRows.length.toLocaleString('th-TH')} ใบเสร็จ · รวม ${projectMoney.format(total / 100)} บาท (ไม่รวม VAT)${missing ? ` · รอตรวจยอด ${missing} ใบ` : ''}`;
  $('project-export').disabled = !projectRows.length;
  const table = document.createDocumentFragment();
  for (const receipt of projectRows) {
    const [id, number, date] = receipt;
    const row = document.createElement('tr');
    const cell = row.insertCell();
    if (/^\d{1,20}$/.test(id)) {
      const link = document.createElement('a');
      link.href = 'https://advance.flowaccount.com/N355072/business/receipts/' + id;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = number;
      cell.append(link);
    } else cell.textContent = number;
    for (const value of [date, receipt[11] || 'ไม่มีชื่อโปรเจกต์บนใบเสร็จ', receipt[7] == null ? 'รอตรวจ' : projectMoney.format(receipt[7])]) {
      row.insertCell().textContent = value;
    }
    const details = document.createElement('button');
    details.type = 'button';
    details.textContent = 'ดูสินค้า';
    details.addEventListener('click', () => showReceiptProducts(number));
    row.insertCell().append(details);
    table.append(row);
  }
  $('project-rows').replaceChildren(table);
}

for (const id of ['project-name', 'project-from', 'project-to']) $(id).onchange = renderProjects;
$('project-export').onclick = () => {
  const csv = value => {
    const text = String(value ?? '');
    return '"' + (/^[=+@\t\r-]/.test(text) && typeof value === 'string' ? "'" : '') + text.replaceAll('"', '""') + '"';
  };
  const rows = [['เลขที่ใบเสร็จ', 'วันที่', 'โปรเจกต์', 'ยอดท้ายใบเสร็จ (ไม่รวม VAT)'],
    ...projectRows.map(receipt => [receipt[1], receipt[2], receipt[11], receipt[7]])];
  const url = URL.createObjectURL(new Blob(['\ufeff', rows.map(row => row.map(csv).join(',')).join('\r\n')],
    {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'crm-project-receipts.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function showView(view) {
  selectedView = view;
  frame.classList.toggle('dashboard-frame', view === 'dashboard');
  if (view !== 'dashboard') document.body.classList.remove('dashboard-detail-open');
  for (const button of views.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  const reviewing = view === 'review';
  const measuring = view === 'success';
  const projects = view === 'projects';
  $('title').textContent = views.querySelector('[aria-pressed="true"]').textContent;
  $('report').hidden = reviewing || measuring;
  frame.hidden = projects;
  $('projects').hidden = !projects;
  if (projects) renderProjects();
  success.hidden = !measuring;
  reviewPanel.hidden = !reviewing;
  if (reviewing) showReview(selectedReview);
  if (view === 'dashboard' && !auditRows) loadAudit();
  if (measuring) saleSuccess.open();
  if (!reviewing && !measuring && !projects) showReportView();
}

function showReview(view) {
  selectedReview = view;
  for (const button of reviewViews.querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.review === view));
  }
  const products = view === 'products';
  audit.hidden = !products;
  sellerGroupsPanel.hidden = products;
  if (products) {
    if (!auditRows) loadAudit();
  } else {
    reviewSellerNames();
  }
}

reviewViews.addEventListener('click', event => {
  const view = event.target.closest('button')?.dataset.review;
  if (view) showReview(view);
});

function showReportView() {
  frame.contentWindow?.postMessage({type: 'crm-report-view', view: selectedView}, '*');
  sendDashboardCatalog();
}
function sendDashboardCatalog() {
  if (selectedView !== 'dashboard' || !auditRows) return;
  const mountNames = auditRows.filter(row => /^TL-/i.test(row.code || '')).map(row => row.name).filter(Boolean);
  frame.contentWindow?.postMessage({type: 'crm-dashboard-bu-catalog', mountNames}, '*');
}
frame.addEventListener('load', showReportView);
views.addEventListener('click', event => {
  const view = event.target.closest('button')?.dataset.view;
  if (view) showView(view);
});

function reportProducts() {
  return new Map((rawReport?.dataset.products ?? []).map(product => [productKey(product.name), product]));
}

function effectiveProduct(name, fallback, catalog = auditRows?.find(row => row.name === name)) {
  const key = productKey(name);
  return productGroups.get(key) ?? fallback.get(key) ??
    (catalog?.crmBrand ? {brand:catalog.crmBrand, category:catalog.crmCategory} : undefined);
}

function renderAudit() {
  const query = $('audit-search').value.trim().normalize('NFKC').toLowerCase();
  const filter = $('audit-filter').value;
  const fallback = reportProducts();
  const catalogNames = new Set(auditRows.map(row => productKey(row.name)).filter(Boolean));
  const entries = [...auditRows, ...[...fallback].filter(([key]) => key && !catalogNames.has(key) && !/^[–—-]+$/.test(key))
    .map(([, product]) => ({name: product.name, status: 'receipt-only'}))];
  const brandFilter = $('audit-brand');
  const selectedBrand = brandFilter.value;
  const needsBrand = new Set(['', 'ไม่ระบุยี่ห้อ', 'ระบุไม่ได้', 'รอยืนยัน Sigenergy']);
  const brands = new Set(entries.map(row => effectiveProduct(row.name, fallback, row)?.brand || ''));
  brandFilter.replaceChildren(new Option('ทั้งหมด', ''), new Option('ยังไม่ระบุ / รอยืนยัน', ':unassigned'),
    ...[...brands].filter(Boolean).sort().map(brand => new Option(brand)));
  brandFilter.value = [...brandFilter.options].some(option => option.value === selectedBrand) ? selectedBrand : '';
  const rows = entries.filter(row => {
    const grouping = effectiveProduct(row.name, fallback, row);
    const brand = grouping?.brand || '';
    const matchesBrand = brandFilter.value === ':unassigned' ? needsBrand.has(brand)
      : !brandFilter.value || brandFilter.value === brand;
    return matchesBrand && (!filter || row.status === filter) &&
      [row.name, row.code, row.category, row.model, row.main, row.group, grouping?.brand, grouping?.category]
        .some(value => String(value ?? '').normalize('NFKC').toLowerCase().includes(query));
  });
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    const group = effectiveProduct(row.name, fallback, row);
    for (const value of [row.name, row.code, row.category, row.model, row.main, row.group, labels.get(row.status),
      group ? group.brand + ' / ' + group.category : null]) {
      const td = document.createElement('td');
      td.textContent = value || '—';
      tr.append(td);
    }
    const editCell = document.createElement('td');
    if (productKey(row.name)) {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.dataset.productName = row.name;
      edit.textContent = 'จัดประเภท';
      edit.setAttribute('aria-label', 'จัดประเภท ' + row.name);
      editCell.append(edit);
    }
    tr.append(editCell);
    fragment.append(tr);
  }
  $('audit-rows').replaceChildren(fragment);
  $('audit-status').textContent = rows.length ? `แสดง ${rows.length.toLocaleString('th-TH')} จาก ${entries.length.toLocaleString('th-TH')} รายการ` : 'ไม่พบรายการตามตัวกรอง';
}

const productEditor = $('product-group-editor');
$('audit-rows').addEventListener('click', event => {
  const name = event.target.closest('[data-product-name]')?.dataset.productName;
  if (!name || savingProduct) return;
  openGroupEditor(name);
});
$('receipt-group-search').onsubmit = event => {
  event.preventDefault();
  if (savingProduct) return;
  const number = $('receipt-group-number').value.trim().toUpperCase();
  const matches = (rawReport?.dataset.receiptTotals ?? []).filter(receipt => receipt[1].toUpperCase() === number);
  if (matches.length !== 1) {
    $('receipt-group-status').textContent = matches.length ? 'พบเลขเอกสารซ้ำ กรุณาตรวจสอบใบเสร็จ' : 'ไม่พบใบเสร็จนี้ในรายงานใบเสร็จที่ชำระครบ';
    return;
  }
  $('receipt-group-status').textContent = '';
  openGroupEditor(matches[0][1], String(matches[0][0]));
};

function openGroupEditor(name, receiptId) {
  const key = receiptId ? 'receipt:' + receiptId : productKey(name);
  editingProduct = {name, receiptId, key};
  const fallback = reportProducts();
  const group = receiptId ? productGroups.get(key) : effectiveProduct(name, fallback);
  $('product-group-title').textContent = receiptId ? 'จัดประเภทใบเสร็จใน CRM' : 'จัดประเภทสินค้าใน CRM';
  $('product-group-scope').textContent = receiptId
    ? 'หมวดนี้มีผลกับยอดทั้งใบและมีผลเหนือหมวดตามชื่อสินค้าในใบเสร็จนี้'
    : 'ใช้กับบรรทัดที่มีชื่อสินค้านี้ในรายงาน CRM';
  const catalog = (auditRows ?? []).map(row => ({brand:row.crmBrand, category:row.crmCategory}));
  const options = [...fallback.values(), ...catalog, ...productGroups.values()];
  for (const field of ['brand', 'category']) {
    const select = $('product-group-' + field);
    const choices = new Set(options.map(option => option[field]).filter(Boolean));
    if (field === 'brand') choices.add('Sigenergy');
    if (group?.[field]) choices.add(group[field]);
    select.replaceChildren(new Option('เลือกจากรายการ', ''),
      ...[...choices].sort((a, b) => a.localeCompare(b, 'th')).map(value => new Option(value)),
      new Option('กำหนดชื่อใหม่…', newGroupOption));
    select.value = group?.[field] ?? '';
    $('product-group-' + field + '-new').value = '';
    updateGroupInput(field);
  }
  $('product-group-name').textContent = name;
  $('product-group-status').textContent = '';
  $('product-group-reset').disabled = !productGroups.has(key);
  productEditor.showModal();
}

const newGroupOption = ':new-group';
function updateGroupInput(field) {
  const id = 'product-group-' + field;
  const isNew = $(id).value === newGroupOption;
  $(id + '-new-label').hidden = !isNew;
  $(id + '-new').disabled = !isNew;
}

function selectedGroupValue(field) {
  const id = 'product-group-' + field;
  const select = $(id);
  if (select.value !== newGroupOption) return select.value;
  const value = $(id + '-new').value.trim();
  return [...select.options].find(option => option.value !== newGroupOption &&
    productKey(option.value) === productKey(value))?.value ?? value;
}

for (const field of ['brand', 'category']) {
  $('product-group-' + field).onchange = () => updateGroupInput(field);
}

async function saveProductGroup(reset) {
  if (savingProduct || !editingProduct) return;
  const epoch = loginEpoch;
  const payload = {name:editingProduct.name, receiptId:editingProduct.receiptId, brand:selectedGroupValue('brand'),
    category:selectedGroupValue('category'), reset};
  savingProduct = true;
  for (const id of ['product-group-save', 'product-group-reset', 'product-group-close']) $(id).disabled = true;
  $('product-group-status').textContent = 'กำลังบันทึกหมวดสินค้า…';
  try {
    const {group} = await json(await reportRequest('save-product-group', 'POST', undefined, payload));
    if (epoch !== loginEpoch) return;
    productGroupVersion++;
    if (group.reset) productGroups.delete(group.productKey);
    else productGroups.set(group.productKey, group);
    if (rawReport) setReportFrame();
    if (auditRows) renderAudit();
    productEditor.close();
    $(group.receiptId ? 'receipt-group-status' : 'audit-status').textContent = group.reset ? 'คืนค่าจัดประเภทอัตโนมัติแล้ว' : 'บันทึกหมวดสินค้าและอัปเดตรายงาน CRM แล้ว';
  } catch (error) {
    if (epoch === loginEpoch) $('product-group-status').textContent = error.message;
  } finally {
    if (epoch === loginEpoch) {
      savingProduct = false;
      $('product-group-save').disabled = $('product-group-close').disabled = false;
      $('product-group-reset').disabled = !productGroups.has(editingProduct?.key);
    }
  }
}
$('product-group-form').onsubmit = event => { event.preventDefault(); saveProductGroup(false); };
$('product-group-reset').onclick = () => saveProductGroup(true);
$('product-group-close').onclick = () => productEditor.close();
productEditor.addEventListener('cancel', event => { if (savingProduct) event.preventDefault(); });

async function loadAudit() {
  if (auditBusy) return;
  const epoch = loginEpoch;
  auditBusy = true;
  $('audit-refresh').disabled = true;
  $('audit-status').textContent = '';
  const finish = beginLoading('audit', 'กำลังโหลดรายการสินค้า',
    'กำลังเทียบสินค้าใน FlowAccount กับกลุ่มใน Stock Profit');
  try {
    const {rows} = await json(await reportRequest('audit'));
    if (epoch !== loginEpoch) return;
    auditRows = rows.filter(row => !/^[–—-]+$/.test(String(row.name ?? '').trim()));
    sendDashboardCatalog();
    renderAudit();
  } catch (error) {
    if (epoch === loginEpoch) $('audit-status').textContent = error.message;
  } finally {
    finish();
    if (epoch === loginEpoch) {
      auditBusy = false;
      $('audit-refresh').disabled = false;
    }
  }
}
$('audit-search').oninput = $('audit-filter').onchange = $('audit-brand').onchange = () => {
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
  for (const slot of loaders.keys()) { slot.hidden = true; slot.replaceChildren(); }
  loaders.clear();
  try { sessionStorage.removeItem(quoteCacheKey); } catch {}
  save(null);
  selectedView = 'sales';
  auditRows = undefined;
  auditBusy = false;
  $('audit-refresh').disabled = false;
  $('audit-rows').replaceChildren();
  $('audit-search').value = $('audit-filter').value = $('audit-brand').value = '';
  $('title').textContent = 'ยอดขายตามเซลส์';
  selectedReview = 'products';
  views.hidden = audit.hidden = success.hidden = sellerGroupsPanel.hidden = reviewPanel.hidden = true;
  rawReport = quotePending = undefined;
  for (const id of ['project-name', 'project-from', 'project-to']) $(id).value = '';
  $('projects').hidden = true;
  renderProjects();
  productGroups.clear();
  productGroupVersion++;
  editingProduct = undefined;
  savingProduct = false;
  $('product-group-save').disabled = $('product-group-close').disabled = false;
  if (productEditor.open) productEditor.close();
  if ($('receipt-products').open) $('receipt-products').close();
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
    const override = productGroups.get(row[5]);
    if (name === row[3] && !override) return row;
    const grouped = [...row];
    grouped[3] = name;
    if (override) {
      grouped[7] = override.brand;
      grouped[8] = override.category;
    }
    return grouped;
  });
  const products = dataset.products.map(product => {
    const override = productGroups.get(product.key);
    return override ? {...product, brand:override.brand, category:override.category, reason:'จัดประเภทใน CRM'} : product;
  });
  const receiptGroups = [...productGroups.values()].filter(group => group.receiptId);
  const payload = JSON.stringify({...dataset, rows, products, receiptGroups, receiptTotals: dataset.receiptTotals?.map(receipt => {
    const grouped = [...receipt];
    grouped[3] = canonicalSeller(receipt[3]);
    return grouped;
  })}).replace(/</g, '\\u003c');
  const groupedHtml = html.replace(datasetPattern, (_, start, original, end) => start + payload + end);
  frame.srcdoc = groupedHtml.replace(/<head>/i, '<head><meta name="crm-report" content="all-brands"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">');
}
async function openReport() {
  const epoch = loginEpoch;
  const productVersion = productGroupVersion;
  try {
    const [response, groupResult, productResult] = await Promise.all([
      reportRequest('report'),
      reportRequest('seller-groups').then(json).catch(error => ({error})),
      reportRequest('product-groups').then(json).catch(error => ({error})),
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
    }
    if (productVersion === productGroupVersion && productResult.groups) {
      productGroups = new Map(productResult.groups.map(group => [group.productKey, group]));
    }
    rawReport = {html, dataset};
    saleSuccess.regroup();
    if (auditRows) renderAudit();
    sellerReview.addNames(dataset.rows.map(row => row[3]));
    setReportFrame();
    frame.hidden = false;
    views.hidden = false;
    showView(selectedView);
    $('logout').hidden = false;
    setLoginVisible(false);
    status([groupResult.error && 'โหลดกลุ่มชื่อเซลส์ไม่ได้', productResult.error && 'โหลดหมวดสินค้าที่บันทึกไว้ไม่ได้'].filter(Boolean).join(' · '));
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
  status('');
  const finish = beginLoading('login', 'กำลังเข้าสู่ระบบ', 'กำลังตรวจสอบบัญชีและเตรียมรายงาน CRM');
  try {
    save(await tokenRequest('password', {email:$('email').value.trim(), password:$('password').value}));
    $('password').value = '';
    await openReport();
  } catch (error) { showLogin(error.message); }
  finally { finish(); button.disabled = false; }
};
$('logout').onclick = () => showLogin();
$('refresh').onclick = async () => {
  $('refresh').disabled = true;
  status('');
  const finish = beginLoading('report', 'กำลังดึงใบเสร็จล่าสุด',
    'กำลังซิงก์ข้อมูลจาก FlowAccount และคำนวณยอดรายงานใหม่');
  try {
    await json(await reportRequest('refresh','POST'));
    if (session) await openReport();
  } catch (error) { if (session) status(error.message); }
  finally { finish(); $('refresh').disabled = false; }
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
  if (event.data?.type === 'crm-open-receipt-products') {
    if (typeof event.data.number === 'string' && /^RE[0-9]+$/i.test(event.data.number)) showReceiptProducts(event.data.number);
    return;
  }
  if (event.data?.type === 'crm-receipt-items-request') {
    const {id} = event.data;
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) return;
    if (!rawReport?.dataset.receiptTotals?.some(receipt => String(receipt[0]) === id)) {
      event.source.postMessage({type:'crm-receipt-items-result', id, error:true}, '*');
      return;
    }
    const epoch = loginEpoch;
    try {
      const {items, missing, quotePayment} = await json(await reportRequest('receipt-items', 'GET', id));
      if (epoch === loginEpoch) event.source.postMessage({type:'crm-receipt-items-result', id, items, missing, quotePayment}, '*');
    } catch {
      if (epoch === loginEpoch) event.source.postMessage({type:'crm-receipt-items-result', id, error:true}, '*');
    }
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
if (session) withLoading('startup', 'กำลังเปิด CRM', 'กำลังเตรียมรายงานยอดขายและตัวกรอง', openReport);
else showLogin();
