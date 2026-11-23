(() => {
  const matchText = text => String(text ?? '').normalize('NFKC').toLowerCase().trim();
  const matchesTerms = (label, query) => matchText(query).split(/\s+/).every(term => matchText(label).includes(term));
  const keywords = new Set(R.flatMap(row => [row[6], row[3], row[4], row[1]]).filter(Boolean));
  const search = $('search');
  const suggestions = document.createElement('datalist');
  suggestions.id = 'salesSuggestions';
  search.setAttribute('list', suggestions.id);
  search.after(suggestions);
  search.addEventListener('input', () => {
    suggestions.replaceChildren(...(search.value.trim()
      ? [...keywords].filter(label => matchesTerms(label, search.value)).slice(0, 20).map(label => new Option(label))
      : []));
  });

  const businessUnits = ['Inverter', 'PV (แผง)', 'Tlock', 'TCable'];
  const compactName = text => matchText(text).replace(/\s+/g, '');
  let mountNames = new Set();
  let hasBuCatalog = false;

  function businessUnit(row) {
    const name = matchText(row[6]);
    const category = matchText(row[8]);
    if (mountNames.has(compactName(name)) || /(?:^|[^a-z])(?:t[ ._-]*lock\b|tl-[a-z0-9])|ทีล็อ[กค]/i.test(name)) return 'Tlock';
    if (/(?:^|[^a-z])t[ ._-]*cable(?:$|[^a-z])|ที[ -]*เคเบิ[ล้]/i.test(name)) return 'TCable';
    if (/warranty|license|ประกัน|สายไฟ|charger|optimizer|dongle|logger|meter|sensor|connector|battery|แบตเตอร์รี่/i.test(name)) return '';
    if (category === 'แผงโซลาร์' || /แผงโซลาร์|แผงเซลล์แสงอาทิตย์|solar panel|pv module/i.test(name)) return 'PV (แผง)';
    if (category === 'sigenergy · inverter / controller' || /inverter|อินเวอร์เตอร์|sun2000|sun5000/i.test(name)) return 'Inverter';
    return '';
  }

  const tabs = document.querySelector('.tabs');
  const section = document.createElement('section');
  const expandIcon = '<span class="dashboard-expand-icon" aria-hidden="true"></span>';
  const chartSources = {
    overview: ['ยอดและจำนวนใบเสร็จใช้ตัวกรองรายงาน ลูกค้าและเซลส์นับตามชื่อในใบเสร็จ'],
    trend: ['จัดกลุ่มตามวันที่เอกสารใบเสร็จ เลือกแสดงรายสัปดาห์ รายเดือน หรือรายปีได้'],
    categories: ['ยอดแยกตามหมวดที่ CRM จัดจากชื่อสินค้า และใช้ช่วงเวลาที่เลือกเหนือกราฟ'],
    bu: ['จัดกลุ่มเป็น Inverter, PV (แผง), Tlock และ TCable จากชื่อสินค้าและหมวดที่ CRM จัดไว้'],
    customers: ['จัดอันดับจากยอดสุทธิของใบเสร็จตามชื่อลูกค้าในเอกสาร ภายใต้ตัวกรองรายงาน'],
    sellers: ['จัดอันดับจากยอดสุทธิของใบเสร็จตามชื่อเซลส์ในเอกสาร โดยใช้ชื่อที่ยืนยันรวมในหน้าตรวจสอบข้อมูล'],
  };
  const source = (key, title) => sourceInfo(key, title, [...receiptSourceNotes, ...chartSources[key]]);
  section.className = 'product-analysis sales-dashboard';
  section.innerHTML = `
    <div class="dashboard-heading"><div class="source-heading"><h2>ภาพรวมยอดขาย</h2>${source('overview', 'ภาพรวมยอดขาย')}</div>
      <div class="dashboard-actions">
        <label class="dashboard-frequency">ช่วงเวลา<select id="dashboardPeriod">
          <option value="month">รายเดือน</option><option value="week">รายสัปดาห์ (จันทร์–อาทิตย์)</option>
          <option value="year">รายปี</option>
        </select></label>
        <button type="button" id="dashboardExport">ส่งออก Excel ทั้งหมด</button>
      </div>
    </div>
    <div id="dashboardKpis" class="dashboard-kpis"></div>
    <div id="dashboardMissing" class="muted" role="status"></div>
    <div class="dashboard-grid">
      <article class="dashboard-panel"><div class="dashboard-card-heading"><div class="source-heading"><h3>แนวโน้มยอดขาย</h3>${source('trend', 'แนวโน้มยอดขาย')}</div><button type="button" class="dashboard-icon-button" data-chart="trend" aria-label="ขยายกราฟแนวโน้มยอดขาย" title="ขยายกราฟแนวโน้มยอดขาย">${expandIcon}</button></div><div id="dashboardTrend"></div></article>
      <article class="dashboard-panel"><div class="dashboard-card-heading"><div class="source-heading"><h3>ยอดขายตามหมวดสินค้า</h3>${source('categories', 'ยอดขายตามหมวดสินค้า')}</div><button type="button" class="dashboard-icon-button" data-chart="categories" aria-label="ขยายกราฟยอดขายตามหมวดสินค้า" title="ขยายกราฟยอดขายตามหมวดสินค้า">${expandIcon}</button></div><div id="dashboardCategories"></div></article>
      <article id="dashboardBu" class="dashboard-panel dashboard-bu" hidden><div class="dashboard-card-heading"><div class="source-heading"><h3>ยอดขายตาม BU</h3>${source('bu', 'ยอดขายตาม BU')}</div><button type="button" class="dashboard-icon-button" data-chart="bu" aria-label="ขยายกราฟยอดขายตาม BU" title="ขยายกราฟยอดขายตาม BU">${expandIcon}</button></div>
        <div id="dashboardBuChart"></div><p id="dashboardBuStatus" class="dashboard-caption"></p></article>
      <article class="dashboard-panel"><div class="dashboard-card-heading"><div class="source-heading"><h3>ลูกค้าซื้อสูงสุด 10 อันดับ</h3>${source('customers', 'ลูกค้าซื้อสูงสุด 10 อันดับ')}</div><button type="button" class="dashboard-icon-button" data-chart="customers" aria-label="ขยายกราฟอันดับลูกค้า" title="ขยายกราฟอันดับลูกค้า">${expandIcon}</button></div><div id="dashboardCustomers"></div></article>
      <article class="dashboard-panel"><div class="dashboard-card-heading"><div class="source-heading"><h3>เซลส์ขายสูงสุด 10 อันดับ</h3>${source('sellers', 'เซลส์ขายสูงสุด 10 อันดับ')}</div><button type="button" class="dashboard-icon-button" data-chart="sellers" aria-label="ขยายกราฟอันดับเซลส์" title="ขยายกราฟอันดับเซลส์">${expandIcon}</button></div><div id="dashboardSellers"></div></article>
    </div>
    <dialog id="dashboardDetail" class="dashboard-detail" aria-labelledby="dashboardDetailTitle">
      <div class="dialog-head"><h2 id="dashboardDetailTitle"></h2>
        <div class="dashboard-actions"><button type="button" id="dashboardReceiptsBack" hidden>กลับไปที่กราฟ</button><button type="button" id="dashboardDetailExport">ส่งออก Excel</button>
        <button type="button" id="dashboardDetailClose" class="dashboard-icon-button" aria-label="ปิดรายละเอียด" title="ปิดรายละเอียด">×</button></div>
      </div>
      <div id="dashboardDetailBody"></div>
    </dialog>`;
  const disclosure = document.createElement('details');
  disclosure.className = 'sales-dashboard-disclosure';
  disclosure.innerHTML = '<summary>แดชบอร์ดและยอดขายตามช่วงเวลา</summary>';
  disclosure.append(section);
  tabs.parentElement.before(disclosure);

  function period(date) {
    const mode = $('dashboardPeriod').value;
    if (mode === 'year') return date.slice(0, 4);
    if (mode === 'month') return date.slice(0, 7);
    const monday = new Date(date + 'T00:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  }

  function table(headings, rows) {
    if (!rows.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    return `<div class="scroll"><table><thead><tr>${headings.map(title => `<th scope="col">${E(title)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${E(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function receiptAction(chart, key) {
    return `data-receipt-chart="${E(chart)}" data-receipt-key="${E(key)}"`;
  }

  function bars(groups, labelOf, chart) {
    if (!groups.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const max = groups.reduce((highest, group) => Math.max(highest, Math.abs(group.amount)), 1);
    return `<ol class="analysis-chart dashboard-chart">${groups.map((group, index) => `
      <li><button type="button" class="dashboard-receipt-bar" ${receiptAction(chart, group.key)}>
        <strong>${E(labelOf(group, index))}</strong><span>${money(group.amount)} บาท</span>
        <span class="analysis-track" aria-hidden="true"><span style="width:${100 * Math.abs(group.amount) / max}%"></span></span>
      </button></li>`).join('')}</ol>`;
  }

  function pie(groups) {
    const positives = groups.filter(group => group.amount > 0);
    if (!positives.length) return bars(groups, group => group.key, 'categories');
    const palette = ['#2765ce', '#35a6a1', '#8256ce', '#dd8141', '#527ca0', '#b34d8a'];
    const top = positives.slice(0, palette.length - 1);
    const remainder = positives.slice(top.length);
    if (remainder.length) top.push({key: otherCategory, label: 'หมวดอื่น ๆ', amount: remainder.reduce((sum, group) => sum + group.amount, 0)});
    const total = positives.reduce((sum, group) => sum + group.amount, 0);
    receiptGroups.categories.set(otherCategory, remainder.flatMap(group => receiptGroups.categories.get(group.key)));
    let start = 0;
    const stops = top.map((group, index) => {
      const stop = `${palette[index]} ${start}% ${start + group.amount / total * 100}%`;
      start += group.amount / total * 100;
      return stop;
    });
    return `<div class="dashboard-pie">
      <div class="dashboard-donut" data-receipt-pie style="--slices:${stops.join(',')}" aria-hidden="true"></div>
      <ul>${top.map((group, index) => `<li><button type="button" class="dashboard-receipt-slice"
        data-slice-ratio="${group.amount / total}" ${receiptAction('categories', group.key)}>
        <i aria-hidden="true" style="--slice:${palette[index]}"></i>
        <span>${E(group.label ?? group.key)}</span><strong>${(group.amount / total * 100).toFixed(1)}%</strong>
      </button></li>`).join('')}</ul>
    </div>${groups.some(group => group.amount < 0) ? '<p class="dashboard-caption">สัดส่วนคำนวณจากหมวดที่มียอดบวก ยอดติดลบแสดงในรายละเอียด</p>' : ''}`;
  }

  function trend(values, expanded = false) {
    if (!values.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const recent = (expanded ? [...values] : values.slice(0, 12)).reverse();
    const max = Math.max(1, ...recent.map(([, amount]) => amount));
    const min = Math.min(0, ...recent.map(([, amount]) => amount));
    const scale = max - min;
    return `<p class="dashboard-caption">${recent[0][0]} ถึง ${recent.at(-1)[0]} · บาท</p>
      <div class="dashboard-columns" style="--periods:${recent.length}" aria-label="กราฟแนวโน้มยอดขาย">
      ${recent.map(([key, amount]) => `<div class="dashboard-point">
        <div class="dashboard-plot">
          <button type="button" class="dashboard-column" ${receiptAction('trend', key)} aria-label="${key} ${money(amount)} บาท"
            style="--bottom:${100 * (Math.min(0, amount) - min) / scale}%;--height:${100 * Math.abs(amount) / scale}%">
            <span>${key}<br>${money(amount)} บาท</span>
          </button></div>
        <small>${key.length === 4 ? key : key.slice(5)}</small></div>`).join('')}
      </div>`;
  }

  const filterSummary = document.createElement('span');
  filterSummary.className = 'dashboard-filter-summary';

  function renderFilterSummary() {
    const fields = [
      ['brand', 'ยี่ห้อ / กลุ่ม'], ['category', 'หมวด'], ['seller', 'เซลส์'],
      ['year', 'ปี'], ['month', 'เดือน'], ['product', 'สินค้า'], ['search', 'ค้นหา'],
    ];
    const active = fields.flatMap(([id, label]) => {
      const control = $(id);
      if (!control.value.trim()) return [];
      return [[label, control.selectedOptions?.[0]?.textContent || control.value.trim()]];
    });
    const basis = basisLabel();
    filterSummary.innerHTML = `${active.length ? active.map(([label, selected]) =>
      `<span class="dashboard-filter-chip"><strong>${E(label)}</strong> ${E(selected)}</span>`).join('')
      : '<span class="dashboard-filter-empty">ทุกข้อมูล</span>'}
      <span class="dashboard-filter-chip"><strong>ฐานยอด</strong> ${E(basis)}</span>`;
  }

  let selectedCategoryPeriod;
  let reports;
  let detailKey;
  let receiptExport;
  const otherCategory = 'crm:other-chart-categories';
  const receiptGroups = {};

  function groupReceiptRows(rows, keyOf) {
    const grouped = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return grouped;
  }
  const rankHeaders = label => ['อันดับ', label, 'ยอดสุทธิ (ไม่รวม VAT)', 'ใบเสร็จ', 'รายการ'];
  const rankRows = groups => groups.map((group, index) => [index + 1, group.key, group.amount, group.docs.size, group.lines]);
  const chartLabels = {
    trend: 'แนวโน้มยอดขาย', categories: 'ยอดขายตามหมวดสินค้า', bu: 'ยอดขายตาม BU',
    customers: 'ลูกค้าซื้อสูงสุด 10 อันดับ', sellers: 'เซลส์ขายสูงสุด 10 อันดับ',
  };

  function showDetail(key) {
    receiptItemObserver?.disconnect();
    waitingReceiptItems.clear();
    detailKey = key;
    receiptExport = undefined;
    $('dashboardReceiptsBack').hidden = true;
    const report = reports[key];
    $('dashboardDetailTitle').textContent = chartLabels[key];
    $('dashboardDetailBody').innerHTML = `<div class="dashboard-detail-chart">${report.chart}</div>
      ${table(report.headers, report.rows.map(row => row.map((cell, index) => index === report.amountIndex ? money(cell) : cell)))}`;
    const dialog = $('dashboardDetail');
    if (!dialog.open) {
      dialog.showModal();
      parent.postMessage({type: 'crm-dashboard-detail', open: true}, '*');
      $('dashboardDetailClose').focus({preventScroll: true});
    }
    $('dashboardDetailBody').scrollTop = 0;
  }

  const receiptItemCache = new Map();
  const waitingReceiptItems = new Set();
  let activeReceiptItem;
  let receiptItemObserver;

  function requestNextReceiptItems() {
    if (parent === window || activeReceiptItem || !waitingReceiptItems.size) return;
    const [id] = waitingReceiptItems;
    waitingReceiptItems.delete(id);
    activeReceiptItem = id;
    parent.postMessage({type:'crm-receipt-items-request', id}, '*');
  }

  function renderReceiptItems(items) {
    return `<ul class="dashboard-receipt-items">${items.map(({name, quantity, unit, source}) =>
      `<li>${E(name)} · ${quantity == null ? 'ไม่ระบุจำนวน' : E(num(quantity)) + (unit ? ' ' + E(unit) : '')}${source ? ` <small>(${E(source)})</small>` : ''}</li>`
    ).join('')}</ul>`;
  }

  function renderReceiptLookup(result) {
    if (!result) return 'กำลังค้นหารายการจาก FlowAccount…';
    if (result.error) return 'ดึงรายละเอียดจาก FlowAccount ไม่สำเร็จ ลองเปิดกราฟอีกครั้ง';
    const items = result.items?.length ? renderReceiptItems(result.items) : 'ไม่พบชื่อสินค้าในข้อมูลจาก FlowAccount';
    return items + (result.missing?.length ? `<small>ยังไม่ได้รายละเอียดจาก ${E(result.missing.join(', '))}</small>` : '');
  }

  window.addEventListener('message', event => {
    const result = event.data;
    if (event.source !== parent || result?.type !== 'crm-receipt-items-result' || result.id !== activeReceiptItem) return;
    if (!result.error) receiptItemCache.set(result.id, result);
    $('dashboardDetailBody').querySelector(`[data-receipt-items="${result.id}"]`)?.replaceChildren(
      document.createRange().createContextualFragment(renderReceiptLookup(result)));
    activeReceiptItem = undefined;
    requestNextReceiptItems();
  });

  function showReceipts(chart, key, fromDetail) {
    receiptItemObserver?.disconnect();
    waitingReceiptItems.clear();
    const rows = receiptGroups[chart]?.get(key) ?? [];
    const docs = [...groupReceiptRows(rows, row => row[0]).values()].map(lines => {
      const [receiptId, serial, date] = lines[0];
      const id = String(receiptId);
      const items = lines.filter(row => row[5] !== unallocatedKey).map(row => ({
        name: row[6] || 'ไม่ระบุชื่อสินค้า', quantity: row[9], unit: row[10], source: row[22],
      }));
      const hasName = lines.some(row => row[5] !== unallocatedKey && row[6]?.trim() && !/^[-–—]+$/.test(row[6].trim()));
      return {id, serial, date, net: receiptSummary(lines).total, items, lookup:parent !== window && !hasName && /^\d{1,20}$/.test(id)};
    }).sort((a, b) => b.date.localeCompare(a.date) || b.serial.localeCompare(a.serial));
    const heading = key === otherCategory ? 'หมวดอื่น ๆ' : key;
    const context = chart === 'categories' ? ` · ${selectedCategoryPeriod}` : '';
    const columns = ['เลขที่เอกสาร', 'วันที่ใบเสร็จ', 'ยอดสุทธิที่ใช้ในกราฟ (ไม่รวม VAT)'];
    receiptExport = () => [
      ['ใบเสร็จที่ใช้ในกราฟ', [columns, ...docs.map(doc => [doc.serial || doc.id, doc.date, doc.net])], [24, 18, 42]],
      ['รายละเอียดสินค้า', [['เลขที่เอกสาร', 'วันที่ใบเสร็จ', 'สินค้า', 'จำนวน', 'หน่วย', 'เอกสารต้นทาง'], ...docs.flatMap(doc =>
        (doc.lookup ? receiptItemCache.get(doc.id)?.items ?? doc.items : doc.items).map(item =>
          [doc.serial || doc.id, doc.date, item.name, item.quantity, item.unit, item.source ?? '']))], [24, 18, 56, 14, 14, 24]],
    ];
    $('dashboardDetailTitle').textContent = `ใบเสร็จ · ${heading}${context}`;
    $('dashboardReceiptsBack').hidden = !fromDetail;
    $('dashboardDetailBody').innerHTML = `<p class="dashboard-caption">
      ${num(docs.length)} ใบ · รวม ${money(receiptSummary(rows).total)} บาท
      · ยอดตามตัวกรองของกราฟ รายละเอียดจากใบอ้างอิงจะทยอยโหลดเมื่อเลื่อนดู</p>
      ${docs.length ? `<div class="scroll"><table><thead><tr>${[...columns.slice(0, 2), 'สินค้า / จำนวน', columns[2]].map(text => `<th scope="col">${E(text)}</th>`).join('')}</tr></thead>
        <tbody>${docs.map(({id, serial, date, net, items, lookup}) => {
          const number = E(serial || id);
          const link = /^\d{1,20}$/.test(id)
            ? `<a href="https://advance.flowaccount.com/N355072/business/receipts/${id}" target="_blank" rel="noopener noreferrer" aria-label="เปิด ${number} ใน FlowAccount">${number}</a>`
            : number;
          const products = lookup ? renderReceiptLookup(receiptItemCache.get(id))
            : items.length ? renderReceiptItems(items) : 'ไม่พบรายการสินค้า';
          const lookupAttribute = lookup ? ` data-receipt-items="${id}"` : '';
          return `<tr><td>${link}</td><td>${E(date)}</td><td${lookupAttribute}>${products}</td><td>${money(net)}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p>ไม่มีใบเสร็จตามตัวกรอง</p>'}`;
    if (!detailDialog.open) {
      detailKey = chart;
      detailDialog.showModal();
      parent.postMessage({type: 'crm-dashboard-detail', open: true}, '*');
    }
    receiptItemObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        receiptItemObserver.unobserve(entry.target);
        const id = entry.target.dataset.receiptItems;
        if (id !== activeReceiptItem && !receiptItemCache.has(id)) waitingReceiptItems.add(id);
      }
      requestNextReceiptItems();
    });
    for (const cell of $('dashboardDetailBody').querySelectorAll('[data-receipt-items]')) {
      if (!receiptItemCache.has(cell.dataset.receiptItems)) receiptItemObserver.observe(cell);
    }
    $('dashboardDetailBody').scrollTop = 0;
    $('dashboardDetailClose').focus({preventScroll: true});
  }

  function exportReports(keys) {
    const tabs = keys.map(key => {
      const {headers, rows} = reports[key];
      return [chartLabels[key], [headers, ...rows], headers.map(() => 29)];
    });
    downloadSalesWorkbook(tabs, 'te-crm-dashboard.xlsx');
  }

  function renderBusinessUnits(known, periods, byPeriod, periodLabel) {
    const buTotals = new Map(aggregate(known.filter(businessUnit), businessUnit).map(group => [group.key, group]));
    receiptGroups.bu = groupReceiptRows(known.filter(businessUnit), businessUnit);
    const buChart = bars(businessUnits.map(key => buTotals.get(key) || {key, amount: 0}), group => group.key, 'bu');
    $('dashboardBuChart').innerHTML = buChart;
    const buNotes = [];
    if ($('brand').value) buNotes.push('กราฟใช้ตัวกรองยี่ห้อปัจจุบัน เลือก «ดูสินค้าทั้งหมด» เพื่อเทียบข้ามยี่ห้อ');
    if (!hasBuCatalog) buNotes.push('รอข้อมูลรหัสสินค้าจากแค็ตตาล็อกเพื่อระบุ Tlock เพิ่มเติม');
    $('dashboardBuStatus').textContent = buNotes.join(' · ');
    const buRows = [];
    for (const key of periods) {
      const groups = new Map();
      for (const row of byPeriod.get(key)) {
        const bu = businessUnit(row);
        if (!bu) continue;
        if (!groups.has(bu)) groups.set(bu, []);
        groups.get(bu).push(row);
      }
      for (const bu of businessUnits) {
        if (!groups.has(bu)) continue;
        for (const item of aggregate(groups.get(bu), row => row[6])) {
          buRows.push([key, bu, item.key, item.amount, item.docs.size, item.lines]);
        }
      }
    }
    return {headers: [periodLabel, 'BU', 'สินค้า', 'ยอดสุทธิ (ไม่รวม VAT)', 'ใบเสร็จ', 'รายการ'],
      amountIndex: 3, rows: buRows, chart: buChart};
  }

  function render() {
    if (!disclosure.open) return;
    if (filterSummary.isConnected) renderFilterSummary();
    const known = filtered.filter(row => value(row) != null);
    const dated = filtered.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[2]) && Number.isFinite(Date.parse(row[2])));
    const recovered = receiptSummary(filtered.filter(row => row[22]));
    $('dashboardMissing').textContent = [
      known.length !== filtered.length ? `${num(filtered.length - known.length)} รายการรอตรวจยอด` : '',
      recovered.count ? `ยอดจากสินค้าบนใบกำกับอ้างอิง ${money(recovered.total)} บาท · ${num(recovered.count)} ใบเสร็จ` : '',
    ].filter(Boolean).join(' · ');

    const byPeriod = new Map();
    for (const row of dated) {
      const key = period(row[2]);
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key).push(row);
    }
    receiptGroups.trend = byPeriod;
    const periods = [...byPeriod.keys()].sort().reverse();
    const periodLabel = {week: 'สัปดาห์เริ่มวันที่', month: 'เดือน', year: 'ปี'}[$('dashboardPeriod').value];
    const values = periods.map(key => [key, receiptSummary(byPeriod.get(key)).total]);
    const summary = receiptSummary(filtered);
    const kpis = [
      [$('amountLabel').textContent, summary.total],
      ['ใบเสร็จที่ตรงตัวกรอง', summary.count],
      ['ลูกค้า', new Set(filtered.map(row => row[4]?.trim()).filter(Boolean)).size],
      ['เซลส์ตามเอกสาร', new Set(filtered.map(row => row[3])).size],
    ];
    $('dashboardKpis').innerHTML = kpis.map(([label, total], index) =>
      `<div class="dashboard-kpi"><small>${E(label)}</small><strong>${index ? num(total) : money(total)}</strong></div>`).join('');
    $('dashboardTrend').innerHTML = trend(values);
    const categories = new Map(periods.map(key => [key, aggregate(byPeriod.get(key), row => row[8])]));
    const customerRows = known.filter(row => row[4]?.trim());
    const sellerRows = known.filter(row => row[3]?.trim());
    receiptGroups.customers = groupReceiptRows(customerRows, row => row[4].trim());
    receiptGroups.sellers = groupReceiptRows(sellerRows, row => row[3].trim());
    const customers = aggregate(customerRows, row => row[4].trim());
    const sellers = aggregate(sellerRows, row => row[3].trim());
    reports = {
      ...(!$('dashboardBu').hidden ? {bu: renderBusinessUnits(known, periods, byPeriod, periodLabel)} : {}),
      trend: {headers: [periodLabel, 'ยอดสุทธิ (ไม่รวม VAT)', 'ใบเสร็จ', 'รายการ'], amountIndex: 1,
        rows: values.map(([key, amount]) => [key, amount, new Set(byPeriod.get(key).map(row => row[0])).size, byPeriod.get(key).length]),
        chart: trend(values, true)},
      categories: {headers: [periodLabel, 'หมวดสินค้า', 'ยอดสุทธิ (ไม่รวม VAT)', 'ใบเสร็จ', 'รายการ'], amountIndex: 2,
        rows: periods.flatMap(key => categories.get(key).map(group => [key, group.key, group.amount, group.docs.size, group.lines]))},
      customers: {headers: rankHeaders('ลูกค้า'), rows: rankRows(customers), amountIndex: 2},
      sellers: {headers: rankHeaders('เซลส์'), rows: rankRows(sellers), amountIndex: 2},
    };
    for (const [key, groups] of [['customers', customers], ['sellers', sellers]]) {
      const label = (group, index) => `${index + 1}. ${group.key}`;
      reports[key].chart = bars(groups.slice(0, 10), label, key);
      $(key === 'customers' ? 'dashboardCustomers' : 'dashboardSellers').innerHTML = reports[key].chart;
    }
    $('dashboardCategories').innerHTML = periods.length ? `
      <label class="dashboard-frequency">ช่วงเวลาของกราฟหมวดสินค้า<select id="dashboardCategoryPeriod">
        ${periods.map(key => `<option value="${E(key)}">${E(key)}</option>`).join('')}
      </select></label>
      <div id="dashboardCategoryChart"></div>` : '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const categoryPeriod = $('dashboardCategoryPeriod');
    const draw = () => {
      selectedCategoryPeriod = categoryPeriod?.value;
      const groups = categories.get(selectedCategoryPeriod) || [];
      receiptGroups.categories = groupReceiptRows(byPeriod.get(selectedCategoryPeriod) ?? [], row => row[8]);
      reports.categories.chart = pie(groups);
      if (categoryPeriod) $('dashboardCategoryChart').innerHTML = reports.categories.chart;
    };
    if (categoryPeriod) {
      if (categories.has(selectedCategoryPeriod)) categoryPeriod.value = selectedCategoryPeriod;
      categoryPeriod.onchange = draw;
    }
    draw();
    $('dashboardExport').onclick = () => {
      const summary = ['สรุปยอดขาย', [['ตัวชี้วัด', 'ค่า'], ...kpis, ['ช่วงเวลา', $('dashboardPeriod').selectedOptions[0].textContent],
        ['ตัวกรอง', filterSummary.textContent.trim().replace(/\s+/g, ' ')]], [48, 66]];
      const tabs = Object.entries(reports).map(([key, {headers, rows}]) => [chartLabels[key], [headers, ...rows], headers.map(() => 29)]);
      downloadSalesWorkbook([summary, ...tabs], 'te-crm-dashboard.xlsx', true);
    };
  }

  section.addEventListener('click', event => {
    const chart = event.target.closest('[data-chart]')?.dataset.chart;
    if (chart) return showDetail(chart);
    let action = event.target.closest('[data-receipt-chart]');
    const pie = event.target.closest('[data-receipt-pie]');
    if (pie) {
      const bounds = pie.getBoundingClientRect();
      const x = event.clientX - bounds.left - bounds.width / 2;
      const y = event.clientY - bounds.top - bounds.height / 2;
      if (Math.hypot(x, y) < bounds.width * .28) return;
      const index = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1;
      let end = 0;
      action = [...pie.parentElement.querySelectorAll('[data-slice-ratio]')].find(button => {
        end += Number(button.dataset.sliceRatio);
        return index <= end;
      });
    }
    if (action) showReceipts(action.dataset.receiptChart, action.dataset.receiptKey, detailDialog.open);
  });
  $('dashboardReceiptsBack').onclick = () => showDetail(detailKey);
  $('dashboardDetailExport').onclick = () => receiptExport
    ? downloadSalesWorkbook(receiptExport(), 'crm-chart-receipts.xlsx')
    : exportReports([detailKey]);
  const detailDialog = $('dashboardDetail');
  $('dashboardDetailClose').onclick = () => detailDialog.close();
  detailDialog.addEventListener('close', () => {
    receiptItemObserver?.disconnect();
    waitingReceiptItems.clear();
    parent.postMessage({type: 'crm-dashboard-detail', open: false}, '*');
  });

  disclosure.addEventListener('toggle', render);
  if (parent !== window) {
    const filters = document.querySelector('[aria-label="ตัวกรองรายงาน"]');
    const filterDisclosure = document.createElement('details');
    filterDisclosure.className = 'dashboard-filters';
    filterDisclosure.innerHTML = '<summary><span class="dashboard-filter-toggle">ตัวกรองรายงาน</span></summary>';
    filterDisclosure.firstElementChild.append(filterSummary);
    filters.before(filterDisclosure);
    const reportMain = filters.parentElement;
    const reportHeader = document.querySelector('header');
    function reportHeight() {
      if (!document.body.classList.contains('crm-dashboard-view') || detailDialog.open) return;
      const height = Math.ceil(reportMain.getBoundingClientRect().bottom + window.scrollY);
      parent.postMessage({type: 'crm-dashboard-height', height}, '*');
    }
    const resize = new ResizeObserver(reportHeight);
    resize.observe(reportMain);
    if (reportHeader) resize.observe(reportHeader);
    window.addEventListener('message', event => {
      if (event.source !== parent) return;
      if (event.data?.type === 'crm-dashboard-bu-catalog' && Array.isArray(event.data.mountNames)) {
        mountNames = new Set(event.data.mountNames.filter(name => typeof name === 'string').map(compactName));
        hasBuCatalog = true;
        render();
        return;
      }
      if (event.data?.type !== 'crm-report-view') return;
      const dashboard = event.data.view === 'dashboard';
      $('dashboardBu').hidden = !dashboard;
      disclosure.style.display = dashboard ? '' : 'none';
      disclosure.firstElementChild.hidden = true;
      disclosure.open = dashboard;
      tabs.parentElement.hidden = dashboard;
      document.body.classList.toggle('crm-dashboard-view', dashboard);
      if (dashboard) {
        filterDisclosure.append(filters);
        render();
        reportHeight();
      } else {
        filterDisclosure.after(filters);
      }
      window.scrollTo(0, 0);
    });
  }
  $('dashboardPeriod').onchange = render;
  const updateReport = update;
  update = () => { updateReport(); render(); };
})();
