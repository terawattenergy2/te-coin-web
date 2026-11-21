(() => {
  const companies = ['มาร์เวล', 'เทระวัตต์ (รวมเอโซลาร์)', 'ศิวาโซลาร์', 'เฟรน สโตน'];
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

  const tabs = document.querySelector('.tabs');
  const section = document.createElement('section');
  section.className = 'product-analysis sales-dashboard';
  section.innerHTML = `
    <div class="dashboard-heading"><h2>ภาพรวมยอดขาย</h2>
    <label class="dashboard-frequency">ช่วงเวลา<select id="dashboardPeriod">
      <option value="month">รายเดือน</option><option value="week">รายสัปดาห์ (จันทร์–อาทิตย์)</option>
    </select></label>
    </div>
    <div id="dashboardKpis" class="dashboard-kpis"></div>
    <div class="dashboard-grid">
      <article class="dashboard-panel"><h3>แนวโน้มยอดขาย</h3><div id="dashboardTrend"></div></article>
      <article class="dashboard-panel"><h3>ยอดขายตามหมวดสินค้า</h3><div id="dashboardCategories"></div></article>
    </div>
    <div id="dashboardMissing" class="muted" role="status"></div>

    <div class="dashboard-rankings">
      <div class="dashboard-panel"><h3>ลูกค้าซื้อสูงสุด 10 อันดับ</h3><div id="dashboardCustomers"></div></div>
      <div class="dashboard-panel"><h3>เซลส์ขายสูงสุด 10 อันดับตามบริษัท</h3>
        <label>บริษัท<select id="dashboardCompany"><option value="">ทั้งหมด</option>
          ${companies.map(company => `<option>${E(company)}</option>`).join('')}
        </select></label>
        <div id="dashboardSellers"></div>
      </div>
    </div>
    <article class="dashboard-panel"><h3>ยอดขายของสี่บริษัทตามช่วงเวลา</h3><div id="dashboardCompanies"></div></article>`;
  const disclosure = document.createElement('details');
  disclosure.className = 'sales-dashboard-disclosure';
  disclosure.innerHTML = '<summary>แดชบอร์ดและยอดขายตามช่วงเวลา</summary>';
  disclosure.append(section);
  tabs.parentElement.before(disclosure);

  function period(date) {
    if ($('dashboardPeriod').value === 'month') return date.slice(0, 7);
    const monday = new Date(date + 'T00:00:00Z');
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return monday.toISOString().slice(0, 10);
  }

  function companyOf(row) {
    const issuer = matchText(row[20]).replace(/[\s.•-]/g, '');
    if (/มาร์เวล|marvel/.test(issuer)) return companies[0];
    if (/เทระวัตต์|เทราวัตต์|terawatt|เอโซลาร์|asolar/.test(issuer)) return companies[1];
    if (/ศิวาโซลาร์|sivasolar|siwasolar/.test(issuer)) return companies[2];
    if (/เฟรน(?:ด์)?สโตน|fren(?:d)?stone/.test(issuer)) return companies[3];
    return '';
  }

  function table(headings, rows) {
    if (!rows.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    return `<div class="scroll"><table><thead><tr>${headings.map(title => `<th scope="col">${E(title)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${E(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function bars(groups, labelOf, colorOf = () => 0) {
    if (!groups.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const max = groups.reduce((highest, group) => Math.max(highest, Math.abs(group.amount)), 1);
    return `<ol class="analysis-chart dashboard-chart">${groups.map((group, index) => `
      <li data-company="${colorOf(group)}"><strong>${E(labelOf(group, index))}</strong>
        <span>${money(group.amount)} บาท</span>
        <div class="analysis-track" aria-hidden="true"><span style="width:${100 * Math.abs(group.amount) / max}%"></span></div>
      </li>`).join('')}</ol>`;
  }

  function rank(rows, index) {
    const groups = aggregate(rows.filter(row => row[index]?.trim()), row => row[index].trim()).slice(0, 10);
    return bars(groups, (group, i) => `${i + 1}. ${group.key}`);
  }

  function trend(periods, byPeriod, periodLabel) {
    const values = periods.map(key => [key, byPeriod.get(key).reduce((sum, row) => sum + value(row), 0)]);
    if (!values.length) return '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const recent = values.slice(0, 12).reverse();
    const max = Math.max(1, ...recent.map(([, amount]) => amount));
    const min = Math.min(0, ...recent.map(([, amount]) => amount));
    const scale = max - min;
    return `<p class="dashboard-caption">${recent[0][0]} ถึง ${recent.at(-1)[0]} · บาท</p>
      <div class="dashboard-columns" aria-label="กราฟแนวโน้มยอดขาย">
      ${recent.map(([key, amount]) => `<div class="dashboard-point">
        <div class="dashboard-plot">
          <button type="button" class="dashboard-column" aria-label="${key} ${money(amount)} บาท"
            style="--bottom:${100 * (Math.min(0, amount) - min) / scale}%;--height:${100 * Math.abs(amount) / scale}%">
            <span>${key}<br>${money(amount)} บาท</span>
          </button></div>
        <small>${key.slice(5)}</small></div>`).join('')}
      </div>
      <details><summary>ดูยอดขายทุกช่วงเวลา</summary>
        ${table([periodLabel, 'ยอดขาย (บาท)'], values.map(([key, amount]) => [key, money(amount)]))}
      </details>`;
  }

  let selectedCategoryPeriod;
  function render() {
    if (!disclosure.open) return;
    const known = filtered.filter(row => value(row) != null);
    const dated = known.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row[2]) && Number.isFinite(Date.parse(row[2])));
    const unknownCompanies = known.filter(row => !companyOf(row));
    const notes = [];
    if (known.length !== filtered.length) notes.push(`${num(filtered.length - known.length)} รายการรอตรวจยอด`);
    if (unknownCompanies.length) notes.push(`${num(new Set(unknownCompanies.map(row => row[0])).size)} ใบเสร็จยังระบุบริษัทผู้ออกไม่ได้`);
    const available = new Set(R.map(companyOf));
    const missing = companies.filter(company => !available.has(company));
    if (missing.length) notes.push('ยังไม่มีใบเสร็จในแหล่งข้อมูลสำหรับ ' + missing.join(', '));
    $('dashboardMissing').textContent = notes.join(' · ');

    const byPeriod = new Map();
    for (const row of dated) {
      const key = period(row[2]);
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key).push(row);
    }
    const periods = [...byPeriod.keys()].sort().reverse();
    const periodLabel = $('dashboardPeriod').value === 'week' ? 'สัปดาห์เริ่มวันที่' : 'เดือน';
    const kpis = [
      [$('amountLabel').textContent, $('amount').textContent],
      ['ใบเสร็จที่ตรงตัวกรอง', $('docCount').textContent],
      ['ลูกค้า', num(new Set(known.map(row => row[4]?.trim()).filter(Boolean)).size)],
      ['เซลส์ตามเอกสาร', $('sellerCount').textContent],
    ];
    $('dashboardKpis').innerHTML = kpis.map(([label, total]) =>
      `<div class="dashboard-kpi"><small>${E(label)}</small><strong>${E(total)}</strong></div>`).join('');
    $('dashboardTrend').innerHTML = trend(periods, byPeriod, periodLabel);
    const categories = new Map(periods.map(key => [key, aggregate(byPeriod.get(key), row => row[8])]));
    $('dashboardCategories').innerHTML = periods.length ? `
      <label class="dashboard-frequency">ช่วงเวลาที่แสดงในกราฟ<select id="dashboardCategoryPeriod">
        ${periods.map(key => `<option value="${E(key)}">${E(key)}</option>`).join('')}
      </select></label>
      <div id="dashboardCategoryChart"></div>
      <details><summary>ดูตารางยอดขายทุกช่วงเวลา</summary>
        ${table([periodLabel, 'หมวดสินค้า', 'ยอดขาย (บาท)'], periods.flatMap(key =>
          categories.get(key).map(group => [key, group.key, money(group.amount)])))}
      </details>` : '<p class="muted">ไม่มีข้อมูลตามตัวกรอง</p>';
    const categoryPeriod = $('dashboardCategoryPeriod');
    if (categoryPeriod) {
      if (categories.has(selectedCategoryPeriod)) categoryPeriod.value = selectedCategoryPeriod;
      const draw = () => {
        selectedCategoryPeriod = categoryPeriod.value;
        $('dashboardCategoryChart').innerHTML = bars(categories.get(selectedCategoryPeriod), group => group.key);
      };
      categoryPeriod.onchange = draw;
      draw();
    }
    $('dashboardCustomers').innerHTML = rank(known, 4);
    const company = $('dashboardCompany').value;
    if (company) {
      $('dashboardSellers').innerHTML = rank(known.filter(row => companyOf(row) === company), 3);
    } else {
      $('dashboardSellers').innerHTML = ['รวมรายการตามตัวกรอง', ...companies].map((label, index) =>
        `<details${index === 0 ? ' open' : ''}><summary>${E(label)}</summary>
        ${rank(index ? known.filter(row => companyOf(row) === label) : known, 3)}</details>`).join('');
    }

    const groups = periods.flatMap(key => aggregate(byPeriod.get(key).filter(companyOf), companyOf)
      .map(group => ({ ...group, period: key })));
    $('dashboardCompanies').innerHTML = groups.length
      ? bars(groups, group => `${group.period} · ${group.key}`, group => companies.indexOf(group.key))
      : '<p class="muted">ยังไม่มีข้อมูลบริษัทผู้ออกใบเสร็จสำหรับแสดงกราฟ</p>';
  }

  disclosure.addEventListener('toggle', render);
  if (parent !== window) {
    const filters = document.querySelector('[aria-label="ตัวกรองรายงาน"]');
    const filterDisclosure = document.createElement('details');
    filterDisclosure.className = 'dashboard-filters';
    filterDisclosure.innerHTML = '<summary>ตัวกรองรายงาน</summary>';
    filters.before(filterDisclosure);
    window.addEventListener('message', event => {
      if (event.source !== parent || event.data?.type !== 'crm-report-view') return;
      const dashboard = event.data.view === 'dashboard';
      disclosure.style.display = dashboard ? '' : 'none';
      disclosure.firstElementChild.hidden = true;
      disclosure.open = dashboard;
      tabs.parentElement.hidden = dashboard;
      document.body.classList.toggle('crm-dashboard-view', dashboard);
      if (dashboard) {
        filterDisclosure.append(filters);
        render();
      } else {
        filterDisclosure.after(filters);
      }
      window.scrollTo(0, 0);
    });
  }
  $('dashboardPeriod').onchange = render;
  $('dashboardCompany').onchange = render;
  const updateReport = update;
  update = () => { updateReport(); render(); };
})();
