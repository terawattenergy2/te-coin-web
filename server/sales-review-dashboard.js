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
    <h2>แดชบอร์ดยอดขาย</h2>
    <label class="dashboard-frequency">ช่วงเวลา<select id="dashboardPeriod">
      <option value="month">รายเดือน</option><option value="week">รายสัปดาห์ (จันทร์–อาทิตย์)</option>
    </select></label>
    <p class="muted">ใช้ตัวกรองและฐานยอดด้านบน</p>
    <div id="dashboardMissing" class="muted" role="status"></div>
    <h3>ยอดขายตามหมวดสินค้า</h3><div id="dashboardCategories"></div>
    <div class="dashboard-rankings">
      <div><h3>ลูกค้าซื้อสูงสุด 10 อันดับ</h3><div id="dashboardCustomers"></div></div>
      <div><h3>เซลส์ขายสูงสุด 10 อันดับตามบริษัท</h3>
        <label>บริษัท<select id="dashboardCompany"><option value="">ทั้งหมด</option>
          ${companies.map(company => `<option>${E(company)}</option>`).join('')}
        </select></label>
        <div id="dashboardSellers"></div>
      </div>
    </div>
    <h3>ยอดขายของสี่บริษัทตามช่วงเวลา</h3><div id="dashboardCompanies"></div>`;
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

  function rank(rows, index) {
    return aggregate(rows.filter(row => row[index]?.trim()), row => row[index].trim())
      .slice(0, 10).map((row, i) => [i + 1, row.key, money(row.amount)]);
  }

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
    $('dashboardCategories').innerHTML = table([periodLabel, 'หมวดสินค้า', 'ยอดขาย (บาท)'], periods.flatMap(key =>
      aggregate(byPeriod.get(key), row => row[8]).map(group => [key, group.key, money(group.amount)])));
    $('dashboardCustomers').innerHTML = table(['อันดับ', 'ลูกค้า', 'ยอดซื้อ (บาท)'], rank(known, 4));
    const company = $('dashboardCompany').value;
    if (company) {
      $('dashboardSellers').innerHTML = table(['อันดับ', 'เซลส์', 'ยอดขาย (บาท)'], rank(known.filter(row => companyOf(row) === company), 3));
    } else {
      $('dashboardSellers').innerHTML = ['รวมรายการตามตัวกรอง', ...companies].map((label, index) =>
        `<details${index === 0 ? ' open' : ''}><summary>${E(label)}</summary>
        ${table(['อันดับ', 'เซลส์', 'ยอดขาย (บาท)'], rank(index ? known.filter(row => companyOf(row) === label) : known, 3))}</details>`).join('');
    }

    const groups = periods.flatMap(key => aggregate(byPeriod.get(key).filter(companyOf), companyOf)
      .map(group => ({ ...group, period: key })));
    const scale = Math.max(1, ...groups.map(group => Math.abs(group.amount)));
    $('dashboardCompanies').innerHTML = groups.length
      ? `<ul class="analysis-chart">${groups.map(group => `<li data-company="${companies.indexOf(group.key)}"><strong>${E(group.period)} · ${E(group.key)}</strong>
        <span>${money(group.amount)} บาท</span>
        <div class="analysis-track" aria-hidden="true"><span style="width:${100 * Math.abs(group.amount) / scale}%"></span></div></li>`).join('')}</ul>`
      : '<p class="muted">ยังไม่มีข้อมูลบริษัทผู้ออกใบเสร็จสำหรับแสดงกราฟ</p>';
  }

  disclosure.addEventListener('toggle', render);
  $('dashboardPeriod').onchange = render;
  $('dashboardCompany').onchange = render;
  const updateReport = update;
  update = () => { updateReport(); render(); };
})();
