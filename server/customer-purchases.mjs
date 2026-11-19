const pageSize = 100;

async function customerDocuments(flow, type, contact) {
  const matches = [];
  const seen = new Set();
  let expected;
  for (let page = 1; page <= 200; page++) {
    const query = new URLSearchParams({
      currentPage: String(page), pageSize: String(pageSize), searchString: contact.name,
    });
    const result = await flow(type + '?' + query);
    const list = result.data?.list;
    const count = Number(result.data?.totalDocument);
    if (result.status === false || !Array.isArray(list) || result.data.totalDocument == null ||
        !Number.isSafeInteger(count) || count < 0) {
      throw Error('FlowAccount ส่งรายการเอกสารไม่ครบ');
    }
    expected ??= count;
    if (count !== expected) throw Error('จำนวนเอกสารเปลี่ยนระหว่างดึงข้อมูล กรุณาลองใหม่');
    for (const doc of list) {
      const id = doc.documentId ?? doc.recordId;
      if (id == null || seen.has(String(id))) throw Error('FlowAccount ส่งเอกสารซ้ำหรือไม่พบรหัสเอกสาร');
      seen.add(String(id));
      if (String(doc.contactId) === contact.id) matches.push(doc);
    }
    if (seen.size > expected) throw Error('จำนวนเอกสารไม่ตรงกับ FlowAccount');
    if (seen.size === expected) return matches;
    if (!list.length) break;
  }
  throw Error('ยังดึงประวัติเอกสารไม่ครบตามที่ FlowAccount แจ้ง');
}

const deleted = doc => [doc.isDelete, doc.isDeleted, doc.isCancelled].some(value => value === true || value === 'true');
const status = doc => String(doc.statusString || '').toLowerCase();
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export async function loadCustomerPurchases(flow, contact) {
  const invoices = (await customerDocuments(flow, 'tax-invoices', contact))
    .filter(doc => !deleted(doc) && !['void', 'awaiting', 'cancelled', 'canceled'].includes(status(doc))
      && !['1', '7'].includes(String(doc.status)));
  const receipts = (await customerDocuments(flow, 'receipts', contact))
    .filter(doc => !deleted(doc) && String(doc.status) === '5' && status(doc) === 'paid');

  const products = new Map();
  let missingDocuments = 0;
  for (const doc of invoices) {
    const items = Array.isArray(doc.items) ? doc.items.filter(item => !item.documentId && String(item.name || '').trim()) : [];
    if (!items.length) missingDocuments++;
    for (const item of items) {
      const name = item.name.trim();
      const unit = String(item.unitName || '').trim() || 'ไม่ระบุหน่วย';
      const key = JSON.stringify([name.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase(), unit]);
      if (!products.has(key)) products.set(key, { name, unit, quantity: null, amount: null });
      const product = products.get(key);
      const quantity = number(item.quantity);
      const amount = number(item.total);
      if (quantity !== null) product.quantity = (product.quantity ?? 0) + quantity;
      if (amount !== null) product.amount = (product.amount ?? 0) + amount;
    }
  }
  const sum = (rows, getAmount) => {
    let cents = 0;
    for (const doc of rows) {
      const amount = number(getAmount(doc));
      if (amount === null) return null;
      cents += Math.round(amount * 100);
    }
    return cents / 100;
  };
  return {
    invoiceCount: invoices.length,
    invoiced: sum(invoices, doc => doc.grandTotal),
    paidReceiptCount: receipts.length,
    paid: sum(receipts, doc => doc.payments?.collected ?? doc.grandTotal),
    missingDocuments,
    products: [...products.values()].sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || a.name.localeCompare(b.name, 'th')),
  };
}
