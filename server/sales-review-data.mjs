export const shippingPattern = /ขนส่ง|ค่าจัดส่ง|ค่ารถ|shipping|delivery|freight/i;
export const depositPattern = /มัดจำ|deposit|ชำระล่วงหน้า|เงินล่วงหน้า/i;

export function reviewQuoteNumbers(item, receipt) {
 const pattern = /\bQT[0-9][A-Z0-9-]{3,25}\b/gi;
 const numbers = String(item.description || '').match(pattern) ||
  String(receipt.reference || '').match(pattern) || [];
 return [...new Set(numbers.map(value => value.toUpperCase()))];
}

const rules = [
 [/\bsig\b|ซิก/, 'รอยืนยัน Sigenergy', 'รอยืนยัน · มีคำว่า SIG', 'คำย่อยังระบุยี่ห้อไม่ได้แน่ชัด'],
 [/ja\s*solar|^jam\d/, 'JA Solar', 'แผงโซลาร์', 'ชื่อยี่ห้อ / ตระกูลรุ่น JAM'],
 [/canadian|^cs\d/, 'Canadian Solar', 'แผงโซลาร์', 'ชื่อยี่ห้อ / ตระกูลรุ่น CS'],
 [/and\s*solar|amcp|amck|adcu|aess/, 'AndSolar', 'Optimizer / Rapid Shutdown', 'ชื่อยี่ห้อ / ตระกูลรุ่น ต้องยืนยันรุ่นที่มีแต่คำย่อ'],
 [/ขนส่ง|ค่ารถ|shipping|delivery|freight/, 'ไม่ใช่รายการสินค้า', 'ขนส่ง/บริการ', 'ระบุในชื่อรายการ'],
 [/dc.?cable|สายไฟ|\bmm2\b|\bmm\.2\b|pv.?cable/, 'ไม่ระบุยี่ห้อ', 'สายไฟ/สาย DC', 'จัดตามข้อความ ไม่ได้ยืนยันยี่ห้อ'],
 [/clamp|rail|grounding|lug|clip|hook|feet|bolt|screw|nut|washer|^tl-|mount|splice|connector|mc4/, 'ไม่ระบุยี่ห้อ', 'โครงสร้าง/อุปกรณ์ติดตั้ง', 'จัดตามข้อความ ไม่ได้ยืนยันยี่ห้อ'],
];
const sigen = [
 [/dummy|ตัวอย่าง/, 'ตัวอย่าง / Dummy'],
 [/installation|mount|cable|terminator|coupler|tool|base|connector|kit/, 'อุปกรณ์/ชุดติดตั้ง'],
 [/evdc|evac|charger/, 'EV Charger'],
 [/sensor|meter|\bct\b/, 'Sensor / Meter'],
 [/gateway/, 'Gateway'],
 [/\bbat\b|battery|แบต/, 'Battery'],
 [/hybrid|micro|controller|\bec\b|\bbc\b|\bpv\b|neo.*\d.*[st]p/, 'Inverter / Controller'],
];

const capitalize = name => name[0].toUpperCase() + name.slice(1);
function classify(name) {
 const text = name.normalize('NFC').toLowerCase().replace(/\s+/g, ' ');
 if (depositPattern.test(text)) return ['เงินมัดจำสินค้า', 'มัดจำ/รับเงินล่วงหน้า', 'ดูสินค้าจากเอกสารอ้างอิง'];
 if (/sigenergy|sigen|ซิกเอน|ซิเจน/.test(text)) {
  const category = sigen.find(([pattern]) => pattern.test(text))?.[1] || 'อื่น ๆ';
  return ['Sigenergy', 'Sigenergy · ' + category, 'ชื่อระบุ Sigenergy / Sigen'];
 }
 for (const [index, [pattern, ...result]] of rules.entries()) {
  if (index === 4) {
   const solar = ['jinko','longi','trina','risen','astronergy'].find(brand => text.includes(brand));
   if (solar) return [capitalize(solar), 'แผงโซลาร์', 'ชื่อยี่ห้อ'];
  }
  if (pattern.test(text)) return result;
 }
 const inverter = ['huawei','growatt','sungrow','deye','goodwe','solis','sofar','hoymiles'].find(brand => text.includes(brand));
 if (inverter) return [capitalize(inverter), 'Inverter / ระบบไฟฟ้าอื่น', 'ชื่อยี่ห้อ'];
 return text ? ['ระบุไม่ได้', 'อื่น ๆ / รอจัดหมวด', 'ต้องตรวจชื่อและรุ่น'] :
  ['ระบุไม่ได้', 'ไม่มีชื่อสินค้า', 'ต้องตรวจเอกสาร'];
}

function amount(value) {
 if (value == null || value === '') return null;
 const number = Number(value);
 if (!Number.isFinite(number)) throw Error('ยอดเงินหรือจำนวนสินค้าในใบเสร็จรับเงินไม่ถูกต้อง');
 return number;
}

function integerParts(value) {
 const [, digits, fraction = '', exponent = '0'] = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value).trim().replace(/^\+/, '').replace(/^0+(?=\d)/, '').replace(/^\./, '0.'));
 return [BigInt(digits + fraction), fraction.length - Number(exponent)];
}

function allocate(raw, base) {
 if (base == null || base < 0 || raw.some(value => value == null || value === '' || Number(value) < 0)) return raw.map(() => null);
 if (!raw.some(value => Number(value) > 0)) return raw.map(() => base === 0 ? 0 : null);
 const amounts = raw.map(integerParts);
 const precision = Math.max(...amounts.map(([, scale]) => scale));
 const weights = amounts.map(([integer, scale]) => integer * 10n ** BigInt(precision - scale));
 const sum = weights.reduce((a, b) => a + b, 0n);
 const [baseInteger, baseScale] = integerParts(base);
 const divisor = 10n ** BigInt(Math.max(0, baseScale - 2));
 const cents = (baseInteger * 10n ** BigInt(Math.max(0, 2 - baseScale)) + divisor / 2n) / divisor;
 const parts = weights.map(weight => weight * cents);
 const whole = parts.map(part => part / sum);
 const remaining = Number(cents - whole.reduce((a, b) => a + b, 0n));
 const order = parts.map((part, index) => ({index, remainder: part % sum}))
  .sort((a, b) => a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1);
 for (const {index} of order.slice(0, remaining)) whole[index]++;
 return whole.map(value => Number(value) / 100);
}

export function shippingInvoiceIds(receipt) {
 const links = Array.isArray(receipt.referencedByMe) ? receipt.referencedByMe : [];
 return [...new Set(links.filter(link => String(link.referenceDocumentType) === '7')
  .map(link => String(link.referenceId || '')).filter(id => /^\d+$/.test(id)))];
}

const normalizeName = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const sameContact = (left, right) => left.contactId != null && String(left.contactId) === String(right.contactId);

function productLines(document) {
 return (document.items || []).filter(line => {
  const name = String(line.name || '').trim();
  return name && !depositPattern.test(name) && !shippingPattern.test(name) && classify(name)[0] !== 'ไม่ใช่รายการสินค้า';
 });
}

function shippingProduct(item, receipt, quotes, invoices) {
 const invoiceLinks = shippingInvoiceIds(receipt).map(id => invoices.get(id)).filter(doc =>
  doc && sameContact(receipt, doc) && String(doc.statusString).toLowerCase() !== 'void');
 const numbers = new Set([...reviewQuoteNumbers(item, receipt), ...invoiceLinks.flatMap(doc => reviewQuoteNumbers({}, doc))]);
 const quoteLinks = [...numbers].map(number => quotes.get(number)).filter(doc => doc && sameContact(receipt, doc));
 const documents = [receipt, ...invoiceLinks, ...quoteLinks];
 const fee = normalizeName(item.name);
 const words = [item, ...documents.slice(1).flatMap(doc => (doc.items || []).filter(line => normalizeName(line.name) === fee))]
  .map(line => normalizeName([line.name, line.description].filter(Boolean).join(' ')));
 const models = new Map();
 for (const doc of documents) {
  for (const line of productLines(doc)) {
   const key = normalizeName(line.name);
   if (key.length >= 4 && words.some(text => text.includes(key)) && !models.has(key)) {
    models.set(key, {...line, total: 1, quoteNumber: doc.documentSerial});
   }
  }
 }
 if (models.size) return models.size === 1 ? [...models.values()] : [];

 // A single model on the same receipt is the only possible shipment on that receipt.
 // For referenced documents, require a matching freight line alongside the single model.
 const groups = documents.map((doc, index) => !index || (doc.items || []).some(line => normalizeName(line.name) === fee)
  ? {doc, lines: productLines(doc)} : null).filter(Boolean);
 const direct = groups[0];
 const candidates = direct.lines.length ? [direct] : groups.slice(1);
 const distinct = new Map();
 for (const {doc, lines} of candidates) {
  for (const line of lines) distinct.set(normalizeName(line.name), {...line, total: 1, quoteNumber: doc.documentSerial});
 }
 return distinct.size === 1 ? [...distinct.values()] : [];
}

function sourceProducts(item, receipt, quotes) {
 const [number, ...others] = reviewQuoteNumbers(item, receipt);
 const quote = quotes.get(number);
 if (!quote || others.length || !sameContact(receipt, quote)) return [];
 const products = productLines(quote);
 return products.length && products.every(line => line.total != null && line.total !== '' &&
  Number.isFinite(Number(line.total)) && Number(line.total) >= 0)
  ? products.filter(line => Number(line.total) > 0).map(line => ({...line, quoteNumber: number})) : [];
}

export function buildReviewData(receipts, now = new Date(), quotes = new Map(), invoices = new Map()) {
 const rows = [];
 const catalog = new Map();
 const names = new Set();
 let start = '', end = '', reconciled = 0;
 let depositsAllocated = 0, depositsUnresolved = 0, allocatedDepositCents = 0, shippingAllocated = 0, allocatedShippingCents = 0, shippingUnresolved = 0;
 for (const doc of receipts) {
  const totals = doc.items.map(item => amount(item.total));
  const base = amount(doc.totalWithoutVat);
  const allocated = allocate(doc.items.map(item => item.total), base);
  const rawSum = totals.reduce((total, value) => total + (value ?? 0), 0);
  const status = String(doc.statusString ?? '');
  const excluded = doc.isDelete === true || doc.isDelete === 'true' || ['void','awaiting'].includes(status);
  const date = String(doc.publishedOn || doc.documentDate || '').slice(0, 10);
  const seller = String(doc.salesName || '').trim().replace(/\s+/g, ' ') || 'ไม่ระบุเซลส์';
  if (allocated[0] != null) reconciled++;
  if (date && doc.items.length) {
   if (!start || date < start) start = date;
   if (date > end) end = date;
  }
  const lines = doc.items.flatMap((item, index) => {
   const original = {item, raw: totals[index], net: allocated[index]};
   const deposit = depositPattern.test(String(item.name || ''));
   const shipping = !deposit && shippingPattern.test(String(item.name || ''));
   if (!deposit && !shipping) return [original];
   const products = shipping ? shippingProduct(item, doc, quotes, invoices) : sourceProducts(item, doc, quotes);
   if (!products.length || original.raw == null || original.raw < 0) {
    if (deposit) depositsUnresolved++;
    else shippingUnresolved++;
    return [original];
   }
   const weights = products.map(product => product.total);
   const raw = allocate(weights, original.raw);
   const net = allocate(weights, original.net);
   const cents = value => Math.round(allocate([1], value)[0] * 100);
   if (raw.some(value => value == null) || raw.reduce((sum, value) => sum + cents(value), 0) !== cents(original.raw) ||
       (original.net != null && net.reduce((sum, value) => sum + cents(value), 0) !== cents(original.net))) {
    throw Error('ยอดปันส่วนเงินมัดจำไม่ตรงกับใบเสร็จ');
   }
   if (shipping) {
    shippingAllocated++;
    allocatedShippingCents += cents(original.raw);
   }
   else {
    depositsAllocated++;
    allocatedDepositCents += cents(original.raw);
   }
   return products.map((product, i) => ({
    item: {...product, quantity: 0, unitName: '', description: item.name + ' · ' + (product.quoteNumber || '') + ' · ' + (item.description || '')},
    raw: raw[i], net: net[i], charge: shipping ? String(item.name || '').trim() : 'เงินมัดจำ',
   }));
  });
  for (const {item, raw, net, charge} of lines) {
   const original = String(item.name || '');
   const name = original.trim();
   const key = name.normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/\s+/g, ' ');
   const [brand, category, reason] = classify(name);
   names.add(name);
   if (!catalog.has(key)) catalog.set(key, {key, name, brand, category, reason, variants: new Set(), ids: new Set()});
   const product = catalog.get(key);
   product.variants.add(original);
   product.ids.add(String(item.id || 'ไม่มีรหัส'));
   rows.push([String(doc.documentId), String(doc.documentSerial ?? ''), date, seller, String(doc.contactName || ''),
    key, name, brand, category, amount(item.quantity) || 0, String(item.unitName || ''), raw,
    net, status, excluded, rawSum, base, String(item.description || ''),
    amount(doc.discountAmount) || 0, amount(doc.documentDeductionAmount) || 0,
    String(doc.company?.companyName || doc.company?.companyNameEn || '').trim(), charge || '']);
  }
 }
 const products = [...catalog.values()].map(product => ({
  ...product, variants: [...product.variants].sort(), ids: [...product.ids].sort(),
 }));
 const loaded = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23',
 }).format(now).replace(',', '');
 return {meta: {
  documents: receipts.length, rows: rows.length, rawNames: names.size, products: products.length,
  start: start || '—', end: end || '—', loaded: loaded + ' (เวลาไทย)', loadedAt: now.toISOString(),
  reconciled, unknownFinancialDocs: receipts.length - reconciled,
  depositsAllocated, depositsUnresolved, allocatedDepositCents, shippingAllocated, allocatedShippingCents, shippingUnresolved,
 }, rows, products};
}
