(() => {
  const tabs = document.querySelector('.tabs');
  const results = tabs.parentElement;
  const tableContent = [...results.children].filter(node => node !== tabs);
  const analysisButton = document.createElement('button');
  analysisButton.type = 'button';
  analysisButton.textContent = 'วิเคราะห์ตามยี่ห้อ / กลุ่ม';
  analysisButton.setAttribute('aria-pressed', 'false');
  tabs.append(analysisButton);

  const panel = document.createElement('section');
  panel.className = 'product-analysis';
  panel.hidden = true;
  panel.innerHTML = `
    <h2>ส่วนแบ่งยอดขายตามยี่ห้อ / กลุ่มสินค้า</h2>
    <div class="analysis-filters">
      <label>ยี่ห้อ / กลุ่มสินค้า<select id="analysisBrand"></select></label>
      <label>หมวดสินค้า<select id="analysisCategory"></select></label>
      <label>ค้นหาชื่อหรือรุ่นสินค้า<input id="analysisSearch" type="search" placeholder="เช่น BAT 10.0 หรือ Gateway" autocomplete="off"></label>
      <label>สินค้า<select id="analysisProduct"></select></label>
    </div>
    <p id="analysisSearchStatus" class="muted" role="status"></p>
    <p class="muted">ส่วนแบ่งของเซลส์คิดจากยอดรวมของยี่ห้อ หมวด หรือสินค้าที่เลือก ภายใต้ตัวกรองและฐานยอดปัจจุบัน กดชื่อเซลส์เพื่อดูรายละเอียดสินค้า</p>
    <p id="analysisLeader" aria-live="polite"></p>
    <ol id="analysisChart" class="analysis-chart" aria-label="อันดับเซลส์ในยี่ห้อหรือกลุ่มสินค้า"></ol>`;
  results.append(panel);

  const select = $('analysisBrand');
  const category = $('analysisCategory');
  const product = $('analysisProduct');
  const search = $('analysisSearch');
  const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().trim();

  function setChoices(control, choices, allLabel, previous) {
    control.replaceChildren(
      new Option(allLabel, ''),
      ...choices.map(([id, label]) => new Option(label, id)),
    );
    control.disabled = choices.length === 0;
    control.value = choices.some(([id]) => id === previous) ? previous : '';
    return control.value;
  }
  const chart = $('analysisChart');
  const percent = (amount, total) => total > 0
    ? (100 * amount / total).toLocaleString('th-TH', { maximumFractionDigits: 2 }) + '%'
    : '—';

  function groupRows(rows, key) {
    const groups = new Map();
    for (const row of rows) {
      const id = key(row);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(row);
    }
    return groups;
  }

  function renderProducts(rows) {
    const items = aggregate(rows, row => row[5]);
    const missing = new Set(rows.filter(row => value(row) == null).map(row => row[5]));
    const known = new Set(rows.filter(row => value(row) != null).map(row => row[5]));
    return `<div class="scroll analysis-seller-products"><table>
      <thead><tr><th scope="col">สินค้า</th><th scope="col">จำนวนแยกหน่วย</th><th scope="col">ใบกำกับภาษี</th><th scope="col">ยอดขาย (บาท)</th></tr></thead>
      <tbody>${items.map(item => `<tr>
        <td>${E(productMap.get(item.key).name || 'ไม่ระบุชื่อสินค้า')}</td>
        <td>${[...item.units].map(([unit, quantity]) => `${num(quantity)} ${E(unit)}`).join(' / ')}</td>
        <td class="num">${num(item.docs.size)}</td>
        <td class="num">${known.has(item.key) ? money(item.amount) : 'รอตรวจ'}${known.has(item.key) && missing.has(item.key) ? ' · บางรายการรอตรวจ' : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  let selectedBrand;
  let selectedCategory = '';
  let selectedProduct;
  function render() {
    if (panel.hidden) return;

    const brands = groupRows(filtered, row => row[7]);
    const brandNames = [...brands.keys()].sort((a, b) => a.localeCompare(b, 'th'));
    select.replaceChildren(...brandNames.map(name => new Option(name, name)));
    if (brands.has(selectedBrand)) select.value = selectedBrand;
    select.disabled = !brandNames.length;
    selectedBrand = select.value;

    const brandRows = brands.get(selectedBrand) || [];
    const categories = [...new Set(brandRows.map(row => row[8]))].sort(collator.compare);
    selectedCategory = setChoices(category, categories.map(name => [name, name]), 'ทุกหมวด', selectedCategory);
    const categoryRows = selectedCategory ? brandRows.filter(row => row[8] === selectedCategory) : brandRows;
    const terms = normalize(search.value).split(/\s+/).filter(Boolean);
    const products = [...new Set(categoryRows.map(row => row[5]))]
      .map(key => productMap.get(key))
      .filter(entry => terms.every(term => normalize(entry.name).includes(term)))
      .sort((a, b) => collator.compare(a.name, b.name));
    // A blank product name can have an empty key, so option values use the list index.
    const choices = products.map((entry, index) => [String(index), entry.name || 'ไม่ระบุชื่อสินค้า']);
    const previousIndex = products.findIndex(entry => entry.key === selectedProduct);
    const chosenIndex = setChoices(product, choices, 'ทุกรุ่นในหมวดที่เลือก', String(previousIndex));
    const chosen = chosenIndex === '' ? undefined : products[Number(chosenIndex)];
    selectedProduct = chosen?.key;
    $('analysisSearchStatus').textContent = terms.length
      ? products.length ? `พบ ${num(products.length)} รุ่น เลือกสินค้าเพื่อดูยอดของรุ่นนั้น` : 'ไม่พบสินค้าในยี่ห้อและหมวดที่เลือก'
      : '';
    const rows = chosen ? categoryRows.filter(row => row[5] === chosen.key) : categoryRows;
    product.onchange = () => {
      selectedProduct = product.value === '' ? undefined : products[Number(product.value)]?.key;
      render();
    };
    const bySeller = groupRows(rows, row => row[3]);
    const ranked = aggregate(rows.filter(row => value(row) != null), row => row[3]);
    const knownSellers = new Set(ranked.map(seller => seller.key));
    const total = ranked.reduce((sum, seller) => sum + seller.amount, 0);
    const leaders = ranked.filter(seller => Math.abs(seller.amount - ranked[0].amount) < 0.000001);
    $('analysisLeader').textContent = leaders.length
      ? `ยอดรวม${chosen ? "สินค้า" : selectedCategory ? "หมวด" : "กลุ่ม"} ${money(total)} บาท · ยอดสูงสุด ${leaders.map(seller => seller.key).join(' / ')} · ${money(leaders[0].amount)} บาท (${percent(leaders[0].amount, total)})`
      : rows.length ? 'ไม่มีข้อมูลยอดขายที่ใช้จัดอันดับ' : 'ไม่พบยี่ห้อ / กลุ่มสินค้าที่ตรงตัวกรอง';

    const sellers = [...ranked, ...[...bySeller.keys()]
      .filter(key => !knownSellers.has(key)).map(key => ({ key, amount: null }))];
    chart.innerHTML = sellers.map(seller => {
      const width = total > 0 && seller.amount !== null
        ? Math.max(0, Math.min(100, 100 * seller.amount / total)) : 0;
      const summary = seller.amount === null
        ? 'รอตรวจยอดขาย' : `${money(seller.amount)} บาท · ${percent(seller.amount, total)}`;
      return `<li><details name="analysis-seller">
        <summary>
          <strong>${E(seller.key)}</strong><span>${summary}</span>
          <div class="analysis-track" aria-hidden="true"><span style="width:${width}%"></span></div>
        </summary>
        <div class="analysis-seller-detail"></div>
      </details></li>`;
    }).join('');

    chart.querySelectorAll('details').forEach((details, index) => {
      details.addEventListener('toggle', () => {
        if (!details.open) return;
        const content = details.querySelector('.analysis-seller-detail');
        if (!content.firstChild) content.innerHTML = renderProducts(bySeller.get(sellers[index].key));
      });
    });
  }

  select.onchange = () => {
    selectedBrand = select.value;
    selectedCategory = '';
    selectedProduct = undefined;
    search.value = '';
    render();
  };
  category.onchange = () => {
    selectedCategory = category.value;
    selectedProduct = undefined;
    render();
  };
  search.oninput = render;
  analysisButton.onclick = () => {
    panel.hidden = false;
    tableContent.forEach(node => { node.hidden = true; });
    tabs.querySelectorAll('[data-tab]').forEach(button => button.classList.remove('active'));
    analysisButton.classList.add('active');
    analysisButton.setAttribute('aria-pressed', 'true');
    render();
  };
  tabs.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    panel.hidden = true;
    tableContent.forEach(node => { node.hidden = false; });
    analysisButton.classList.remove('active');
    analysisButton.setAttribute('aria-pressed', 'false');
  }));

  const updateReport = update;
  update = () => {
    updateReport();
    if (!panel.hidden) {
      tabs.querySelectorAll('[data-tab]').forEach(button => button.classList.remove('active'));
      render();
    }
  };
})();
