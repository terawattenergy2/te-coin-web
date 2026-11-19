/* Shared receipt validation for the browser preview and trusted server fetch. */
function finite(value, name) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw Error(`ไม่พบ ${name} ที่ถูกต้อง`);
  return Number(value);
}
function stableId(value, name) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw Error(`${name} เกินขอบเขตตัวเลข`);
  const s = String(value ?? '').trim();
  if (!s || s === '0' || s.length > 150) throw Error(`ไม่พบ ${name}`);
  return s;
}
function close(a, b) { return Math.abs(a - b) < 0.021; }
function documents(payload) {
  const d = payload?.data ?? payload;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.list)) return d.list;
  if (d && (d.documentId != null || d.recordId != null)) return [d];
  throw Error('รูปแบบข้อมูล FlowAccount ไม่ถูกต้อง');
}
function isTrue(v) { return v === true || v === 'true'; }
function productKey(item) {
  if (item.id != null) return 'id:' + stableId(item.id, 'รหัสสินค้า FlowAccount');
  if (String(item.sku || '').trim()) return 'sku:' + String(item.sku).trim();
  throw Error('สินค้าไม่มีรหัส ต้องตรวจข้อมูลก่อนให้ Coin');
}
function normalizeReceipt(receipt, source, environment, invoices = {}) {
  stableId(source, 'บัญชีผู้ขาย');
  if (!['test', 'v1'].includes(environment)) throw Error('Environment ไม่ถูกต้อง');
  const receiptId = stableId(receipt.documentId ?? receipt.recordId, 'รหัสใบเสร็จ');
  const contactId = stableId(receipt.contactId, 'contactId ของ EPC');
  if (!String(receipt.contactName || '').trim()) throw Error('ไม่มีชื่อบริษัท EPC');
  if (String(receipt.documentType) !== '9' || String(receipt.status) !== '5' || String(receipt.statusString).toLowerCase() !== 'paid') throw Error('ยังไม่ใช่ใบเสร็จที่รับชำระครบ');
  if (isTrue(receipt.isCancelled) || isTrue(receipt.isDeleted)) throw Error('ใบเสร็จถูกยกเลิก');
  const gross = finite(receipt.grandTotal, 'ยอดใบเสร็จ');
  if (gross <= 0 || !close(finite(receipt.payments?.collected, 'ยอดรับชำระ'), gross)) throw Error('ยอดรับชำระยังไม่ครบ หรือมีรายการหักที่ต้องตรวจสอบ');
  if (Number(receipt.payments?.remainingCollected || 0) !== 0) throw Error('มีเงินค้างรับ');
  if (!Array.isArray(receipt.items) || !receipt.items.length) throw Error('ไม่มีรายละเอียดใบเสร็จ');
  let sales;
  const hasReferences = receipt.items.some(i => i.documentId != null);
  if (hasReferences) {
    if (receipt.items.some(i => i.documentId == null)) throw Error('ใบเสร็จมีข้อมูลอ้างอิงปะปน ต้องตรวจสอบ');
    if (!close(receipt.items.reduce((n, i) => n + finite(i.documentPaymentAmount, 'ยอดตัดรับใบกำกับ'), 0), gross)) throw Error('ยอดใบกำกับอ้างอิงไม่ตรงกับเงินที่รับ');
    sales = receipt.items.map(ref => {
      if (String(ref.documentType) !== '7') throw Error('ยังไม่รองรับประเภทเอกสารอ้างอิงนี้');
      const invoiceId = stableId(ref.documentId, 'รหัสใบกำกับ');
      const invoice = invoices[invoiceId];
      if (!invoice || String(invoice.documentId ?? invoice.recordId) !== invoiceId) throw Error('ต้องโหลดรายละเอียดใบกำกับภาษีก่อน');
      if (String(invoice.contactId) !== contactId) throw Error('บริษัทในใบเสร็จและใบกำกับไม่ตรงกัน');
      if (String(invoice.status) === '0' || /cancel|void/i.test(String(invoice.statusString))) throw Error('ใบกำกับถูกยกเลิก');
      if (!close(finite(ref.documentPaymentAmount, 'ยอดรับใบกำกับ'), finite(ref.documentGrandTotal, 'ยอดเต็มใบกำกับ')) || Number(ref.partialAmount || 0) !== 0 || !close(Number(ref.documentGrandTotal), finite(invoice.grandTotal, 'ยอดใบกำกับ'))) throw Error('ใบกำกับยังรับชำระไม่ครบ ให้ตรวจยอดมัดจำ/ชำระบางส่วน');
      return { saleKey: 'invoice:' + invoiceId, document: invoice };
    });
  } else sales = [{ saleKey: 'receipt:' + receiptId, document: receipt }];
  const seen = new Set();
  return sales.map(({ saleKey, document: doc }) => {
    if (seen.has(saleKey)) throw Error('เอกสารอ้างอิงซ้ำในใบเสร็จเดียวกัน');
    seen.add(saleKey);
    if (doc.isVatInclusive !== false && doc.isVatInclusive !== 'false') throw Error('ราคามี VAT รวม ต้องตรวจฐานก่อนคำนวณ');
    if (Number(doc.discountAmount || 0) !== 0 || Number(doc.discountPercentage || 0) !== 0) throw Error('มีส่วนลดท้ายบิล ต้องตรวจวิธีปันส่วน');
    if (!Array.isArray(doc.items) || !doc.items.length || doc.items.length > 100) throw Error('จำนวนรายการสินค้าไม่ถูกต้อง');
    const lines = doc.items.map(item => {
      const quantity = finite(item.quantity, 'จำนวนสินค้า');
      const netTotal = finite(item.total, 'ยอดสินค้าก่อน VAT');
      const unitPrice = finite(item.pricePerUnit, 'ราคาต่อหน่วย');
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000 || netTotal < 0 || unitPrice < 0) throw Error('จำนวนหรือราคาสินค้าไม่รองรับ');
      // FlowAccount inline discount semantics must be confirmed before allocating it.
      if (Number(item.discountAmount || 0) !== 0 || !close(unitPrice * quantity, netTotal)) throw Error('มีส่วนลดรายสินค้าหรือยอดสินค้าไม่ตรง ต้องตรวจสอบ');
      return { productKey: productKey(item), name: String(item.name || ''), quantity, netTotal };
    });
    const netTotal = lines.reduce((s, l) => s + l.netTotal, 0);
    if (!close(netTotal, finite(doc.totalAfterDiscount, 'ยอดสินค้าสุทธิ'))) throw Error('ยอดรวมรายการสินค้าไม่ตรงยอดสินค้าสุทธิ');
    const headerDifference = Math.round((netTotal - finite(doc.totalWithoutVat, 'ฐานก่อน VAT')) * 100) / 100;
    return { source, environment, saleKey, receiptId, documentNumber: String(receipt.documentSerial || receiptId),
      contactId, contactName: String(receipt.contactName).trim(), taxId: String(receipt.contactTaxId || ''),
      branch: String(receipt.contactBranch || ''), paid: true, netTotal, headerDifference, lines };
  });
}
function modelName(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(); }
function matchProduct(line, products) {
  const matches = products.filter(p => p.active !== false && modelName(p.model) && modelName(p.model) === modelName(line.name));
  if (matches.length === 1) return { product: matches[0] };
  return { product: null, error: matches.length ? 'พบรุ่นสินค้าซ้ำในฐานต้นทุน ยังไม่คำนวณ' : 'ยังไม่มีรุ่นนี้ในฐานต้นทุน TeraCoin จึงยังคำนวณ Coin ไม่ได้' };
}
function purchaseLines(receipt, invoices = {}) {
  return (Array.isArray(receipt.items) ? receipt.items : []).flatMap(item => {
    if (item.documentId != null) {
      const invoice = invoices[String(item.documentId)];
      return invoice ? purchaseLines(invoice, {}) : [{ name: item.documentSerial || 'ใบกำกับที่ยังโหลดไม่สำเร็จ', quantity: null, netTotal: null, productKey: '' }];
    }
    let key = ''; try { key = productKey(item); } catch { /* preserve the purchase for display */ }
    return [{ name: String(item.name || ''), quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null,
      netTotal: Number.isFinite(Number(item.total)) ? Number(item.total) : null, productKey: key }];
  });
}
module.exports = { documents, normalizeReceipt, productKey, matchProduct, purchaseLines };
