const $ = id => document.getElementById(id);
const collator = new Intl.Collator('th');
const searchKey = text => text.normalize('NFKC').toLowerCase().trim();
const withoutPhone = name => searchKey(name).replace(/(?<!\d)0\d[\d\s()-]{7,}\d\)?\s*$/u, '').trim();
const withoutTitle = name => name.replace(/^คุณ\s*/, '');
const suggestionKey = name => withoutTitle(withoutPhone(name)).split(/\s+/)[0];

export function createSellerReview(confirm, applyGroups) {
  const names = new Set();
  const selected = new Set();
  const list = $('seller-review-names');
  const search = $('seller-review-search');
  const canonical = $('seller-review-canonical');
  const button = $('seller-review-confirm');
  const status = $('seller-review-status');
  let groups = [];
  let busy = false;
  let generation = 0;

  function render() {
    const aliases = new Map(groups.flatMap(group => group.names.map(name => [name, group.canonical])));
    const visible = [...names].sort(collator.compare).filter(name => searchKey(name).includes(searchKey(search.value)));
    list.replaceChildren(...visible.map(name => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = name;
      input.checked = selected.has(name);
      input.disabled = busy;
      const target = aliases.get(name);
      label.append(input, document.createTextNode(target && target !== name ? `${name} → ${target}` : name));
      return label;
    }));
    const previous = canonical.value;
    const picked = [...selected];
    canonical.replaceChildren(new Option('เลือกชื่อหลัก', ''), ...picked.sort(collator.compare).map(name => new Option(name, name)));
    if (selected.has(previous)) canonical.value = previous;
    canonical.disabled = busy;
    button.disabled = busy || selected.size < 2 || !canonical.value;
    $('seller-review-selected').textContent = selected.size ? picked.join(' · ') : 'ยังไม่ได้เลือกชื่อ';

    const candidates = new Map();
    for (const name of names) {
      const key = suggestionKey(name);
      if (key.length < 2) continue;
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(name);
    }
    const suggestions = [...candidates.values()].filter(cluster =>
      new Set(cluster.map(name => aliases.get(name) || name)).size > 1 &&
      cluster.some(name => searchKey(name).includes(searchKey(search.value))));
    $('seller-review-suggestions').replaceChildren(...suggestions.map(cluster => {
      const suggest = document.createElement('button');
      suggest.type = 'button';
      suggest.disabled = busy;
      suggest.textContent = cluster.join(' · ');
      suggest.onclick = () => {
        selected.clear();
        for (const name of cluster) selected.add(name);
        render();
        canonical.value = [...cluster].sort((a, b) => withoutTitle(withoutPhone(b)).length - withoutTitle(withoutPhone(a)).length
          || Number(/^คุณ/.test(a)) - Number(/^คุณ/.test(b)) || a.length - b.length)[0];
        button.disabled = false;
        canonical.focus();
      };
      return suggest;
    }));
    $('seller-review-confirmed').replaceChildren(...groups.map(({canonical: name, names: members}) => {
      const entry = document.createElement('li');
      entry.textContent = `${name} ← ${members.filter(member => member !== name).join(' · ')}`;
      return entry;
    }));
  }

  list.addEventListener('change', ({target}) => {
    if (target.checked) selected.add(target.value);
    else selected.delete(target.value);
    render();
    [...list.querySelectorAll('input')].find(input => input.value === target.value)?.focus();
  });
  search.addEventListener('input', render);
  canonical.onchange = () => { button.disabled = busy || selected.size < 2 || !canonical.value; };
  $('seller-review-clear').onclick = () => { if (!busy) { selected.clear(); render(); } };
  button.onclick = async () => {
    const name = canonical.value;
    if (!name || selected.size < 2 || busy) return;
    const epoch = generation;
    busy = true;
    render();
    status.textContent = '';
    try {
      const result = await confirm({canonical: name, names: [...selected]});
      if (epoch !== generation) return;
      groups = result.groups;
      selected.clear();
      applyGroups(groups);
      status.textContent = `บันทึกชื่อหลัก ${name} แล้ว`;
    } catch (error) {
      if (epoch === generation) status.textContent = error.message;
    } finally {
      if (epoch === generation) {
        busy = false;
        render();
      }
    }
  };

  return {
    addNames(values) { for (const value of values) if (value?.trim()) names.add(value.trim()); render(); },
    showGroups(values) {
      groups = values;
      for (const group of values) for (const name of group.names) names.add(name);
      if (!$('seller-groups').hidden) render();
    },
    status(text) { if (!busy) status.textContent = text; },
    reset() { generation++; names.clear(); selected.clear(); groups = []; busy = false; search.value = ''; status.textContent = ''; render(); },
  };
}
