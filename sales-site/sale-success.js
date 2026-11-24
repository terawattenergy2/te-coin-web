const $ = id => document.getElementById(id);
const outcomes = {won: 'ปิดได้', lost: 'ปิดไม่ได้', open: 'ยังเปิดอยู่'};
const missingSeller = 'ไม่ระบุเซลส์';
const thaiNumber = new Intl.NumberFormat('th-TH');
const money = new Intl.NumberFormat('th-TH', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const receiptNet = cents => cents == null ? 'ยังไม่พบใบเสร็จที่เชื่อมได้' : money.format(cents / 100);
const salesNet = cents => cents == null ? '—' : money.format(cents / 100);
const percent = new Intl.NumberFormat('th-TH', {style: 'percent', maximumFractionDigits: 1});
const bangkokDate = new Intl.DateTimeFormat('th-TH', {dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok'});
const pageSize = 50;

function renderTable(target, records) {
  const body = document.createDocumentFragment();
  for (const record of records) {
    const row = document.createElement('tr');
    for (const value of record) {
      const cell = document.createElement('td');
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value || '—';
      row.append(cell);
    }
    body.append(row);
  }
  $(target).replaceChildren(body);
}

function counts(rows) {
  const result = {total: rows.length, won: 0, lost: 0, open: 0};
  for (const row of rows) result[row.outcome]++;
  return result;
}

export function summarizeReceiptSales(receipts, canonicalSeller, year, sellers) {
  const bySeller = new Map();
  const added = new Set();
  let total = 0;
  for (const [id, , date, seller, , , , net] of receipts) {
    const name = canonicalSeller(seller) || missingSeller;
    if (added.has(String(id)) || !Number.isFinite(net) ||
        year && !date?.startsWith(year + '-') || sellers.size && !sellers.has(name)) continue;
    added.add(String(id));
    const cents = Math.round(net * 100);
    bySeller.set(name, (bySeller.get(name) ?? 0) + cents);
    total += cents;
  }
  return {bySeller, total};
}

export function createSaleSuccess(request, canonicalSeller, beginLoading, readCache, showReceiptProducts, readReceiptReport) {
  const sellerOf = row => canonicalSeller(row.seller) || missingSeller;
  let data;
  let pending = false;
  let epoch = 0;
  let page = 0;
  const status = $('success-status');
  const refresh = $('success-refresh');
  const year = $('success-year');
  const seller = $('success-seller');
  const sellerSearch = $('success-seller-search');
  const sellerOptions = $('success-seller-options');
  const selectedSellers = new Set();
  const collator = new Intl.Collator('th');
  let sellerNames = [];
  const query = $('success-search');
  const outcome = $('success-outcome');

  function render() {
    if (!data) return;
    const term = query.value.trim().toLowerCase();
    const filtered = data.rows.filter(row =>
      (!year.value || row.date.startsWith(year.value + '-')) &&
      (!selectedSellers.size || selectedSellers.has(sellerOf(row))) &&
      [row.customer, row.number].some(value => value.toLowerCase().includes(term)));
    const selected = sellerNames.filter(name => selectedSellers.has(name));
    $('success-seller-summary').textContent = selected.length ? `เลือก ${thaiNumber.format(selected.length)} คน` : 'ทุกคน';
    const selectedLabel = $('success-selected');
    selectedLabel.hidden = !selected.length;
    selectedLabel.textContent = selected.length ? 'กำลังดู ' + selected.join(' · ') : '';
    const total = counts(filtered);
    const receiptReport = readReceiptReport();
    const sales = receiptReport ? summarizeReceiptSales(receiptReport.receiptTotals ?? [], canonicalSeller, year.value, selectedSellers) : null;
    $('success-receipt-date').textContent = receiptReport?.meta?.loaded
      ? 'ข้อมูลยอดขายตามใบเสร็จ ณ ' + receiptReport.meta.loaded : '';
    const metrics = [['ใบเสนอราคา', thaiNumber.format(total.total)], ...Object.entries(outcomes).map(([key, label]) =>
      [label, `${thaiNumber.format(total[key])} · ${total.total ? percent.format(total[key] / total.total) : '—'}`])];
    metrics.push(['ยอดสุทธิใบเสร็จ (ไม่รวม VAT)', salesNet(sales?.total)]);
    $('success-metrics').replaceChildren(...metrics.map(([label, value]) => {
      const card = document.createElement('div');
      const heading = document.createElement('span');
      const number = document.createElement('strong');
      heading.textContent = label;
      number.textContent = value;
      card.append(heading, number);
      return card;
    }));
    const grouped = new Map();
    for (const row of filtered) {
      const name = sellerOf(row);
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row);
    }
    for (const name of sales?.bySeller.keys() ?? []) if (!grouped.has(name)) grouped.set(name, []);
    const team = [...grouped].map(([name, rows]) => ({name, ...counts(rows)}));
    team.sort((a, b) => (b.total ? b.won / b.total : -1) - (a.total ? a.won / a.total : -1) || b.total - a.total || a.name.localeCompare(b.name, 'th'));
    renderTable('success-team', team.map(r => [r.name, ...[r.total, r.won, r.lost, r.open].map(n => thaiNumber.format(n)), r.total ? percent.format(r.won / r.total) : '—', r.total ? percent.format(r.lost / r.total) : '—', salesNet(sales?.bySeller.get(r.name))]));
    const detail = filtered.filter(row => !outcome.value || row.outcome === outcome.value);
    const pages = Math.max(1, Math.ceil(detail.length / pageSize));
    page = Math.min(page, pages - 1);
    function receiptLinks(row) {
      if (!row.receipts?.length) return row.receiptIssue;
      const links = document.createDocumentFragment();
      for (const [index, receipt] of row.receipts.entries()) {
        if (index) links.append(' · ');
        if (receipt.invoiceNumbers.length) links.append(receipt.invoiceNumbers.join(' / ') + ' → ');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = receipt.number;
        button.onclick = () => showReceiptProducts(receipt.number);
        links.append(button);
      }
      return links;
    }
    renderTable('success-quotes', detail.slice(page * pageSize, (page + 1) * pageSize).map(row =>
      [row.number, row.date, row.customer, sellerOf(row), outcomes[row.outcome], row.status,
        receiptLinks(row),
        receiptNet(row.receiptNetCents)]));
    $('success-prev').disabled = page === 0;
    $('success-next').disabled = page + 1 >= pages;
    $('success-page').textContent = detail.length ? `หน้า ${page + 1} จาก ${pages} · ${thaiNumber.format(detail.length)} ใบ` : 'ไม่มีใบเสนอราคาที่ตรงตัวกรอง';
  }

  function useReport(next) {
    data = next;
    const selectedYear = year.value;
    const dates = [...data.rows.map(row => row.date), ...(readReceiptReport()?.receiptTotals ?? []).map(row => row[2])];
    const years = [...new Set(dates.map(date => date?.slice(0, 4)).filter(value => /^\d{4}$/.test(value)))].sort().reverse();
    year.replaceChildren(year.options[0], ...years.map(value => new Option(value, value)));
    if (years.includes(selectedYear)) year.value = selectedYear;
    updateSellerOptions();
    render();
  }

  function reportTime() {
    return `ข้อมูล ณ ${bangkokDate.format(new Date(data.loadedAt))} (เวลาไทย)`;
  }

  async function load() {
    if (pending) return;
    const requestEpoch = epoch;
    pending = true;
    refresh.disabled = true;
    const showingPrevious = Boolean(data);
    status.classList.toggle('success-updating', showingPrevious);
    status.textContent = showingPrevious ? reportTime() + ' · กำลังตรวจข้อมูลใหม่…' : '';
    const finish = showingPrevious ? undefined : beginLoading('success', 'กำลังโหลด Sale Success',
      'กำลังไล่เลขอ้างอิงใบเสนอราคา ใบแจ้งหนี้ และใบเสร็จจาก FlowAccount');
    try {
      const next = await request();
      if (requestEpoch !== epoch) return;
      if (!data || Date.parse(next.loadedAt) > Date.parse(data.loadedAt)) useReport(next);
      status.textContent = reportTime();
    } catch (error) {
      if (requestEpoch === epoch) {
        status.textContent = data ? reportTime() + ' · อัปเดตไม่สำเร็จ ' + error.message : error.message;
      }
    } finally {
      finish?.();
      if (requestEpoch === epoch) {
        status.classList.remove('success-updating');
        pending = false;
        refresh.disabled = false;
      }
    }
  }

  function updateSellerOptions() {
    if (!data) return;
    const nextSelected = [...selectedSellers].map(canonicalSeller);
    sellerNames = [...new Set([...data.rows.map(sellerOf), ...(readReceiptReport()?.receiptTotals ?? [])
      .map(row => canonicalSeller(row[3]) || missingSeller)])].sort(collator.compare);
    selectedSellers.clear();
    for (const name of nextSelected) if (sellerNames.includes(name)) selectedSellers.add(name);
    renderSellerOptions();
  }

  function renderSellerOptions() {
    const term = sellerSearch.value.trim().toLowerCase();
    const names = sellerNames.filter(name => name.toLowerCase().includes(term));
    sellerOptions.replaceChildren(...names.map(name => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.checked = selectedSellers.has(name);
      label.append(checkbox, document.createTextNode(name));
      return label;
    }));
    $('success-seller-empty').hidden = names.length > 0;
  }

  sellerSearch.addEventListener('input', renderSellerOptions);
  sellerOptions.addEventListener('change', event => {
    const {value, checked} = event.target;
    if (checked) selectedSellers.add(value);
    else selectedSellers.delete(value);
    page = 0;
    render();
  });
  $('success-seller-clear').onclick = () => {
    selectedSellers.clear();
    page = 0;
    renderSellerOptions();
    render();
  };
  $('success-seller-done').onclick = () => {
    seller.open = false;
    seller.querySelector('summary').focus();
  };

  for (const control of [year, query, outcome]) {
    control.addEventListener(control === query ? 'input' : 'change', () => { page = 0; render(); });
  }
  $('success-prev').onclick = () => { page--; render(); };
  $('success-next').onclick = () => { page++; render(); };
  refresh.onclick = load;

  return {
    open() {
      if (!data && !pending) {
        const cached = readCache();
        if (cached) useReport(cached);
      }
      load();
    },
    regroup() { if (data) useReport(data); },
    reset() {
      epoch++;
      status.classList.remove('success-updating');
      data = undefined;
      pending = false;
      page = 0;
      refresh.disabled = false;
      year.replaceChildren(year.options[0]);
      sellerNames = [];
      selectedSellers.clear();
      seller.open = false;
      sellerSearch.value = '';
      sellerOptions.replaceChildren();
      $('success-seller-summary').textContent = 'ทุกคน';
      $('success-selected').hidden = true;
      $('success-selected').textContent = '';
      query.value = outcome.value = status.textContent = $('success-page').textContent = $('success-receipt-date').textContent = '';
      for (const id of ['success-metrics', 'success-team', 'success-quotes']) $(id).replaceChildren();
      $('success-prev').disabled = $('success-next').disabled = true;
    },
  };
}
