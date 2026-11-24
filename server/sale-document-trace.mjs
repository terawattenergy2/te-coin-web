import {receiptNetBeforeVat, reviewQuoteNumbers} from './sales-review-data.mjs';

export const saleDocumentTypes = new Map([
  ['quotations', '3'], ['billing-notes', '5'], ['tax-invoices', '7'],
  ['receipts', '9'], ['cash-invoices', '35'],
]);

const intermediateTypes = new Set(['5', '7', '35']);
const cancelled = doc => [doc.isDelete, doc.isDeleted, doc.isCancelled]
  .some(flag => ['true', '1'].includes(String(flag).toLowerCase())) ||
  ['void', 'cancelled', 'canceled'].includes(String(doc.statusString).toLowerCase());
const paid = doc => doc.type === '9' && !cancelled(doc) &&
  String(doc.status) === '5' && String(doc.statusString).toLowerCase() === 'paid';
const keyOf = (type, id) => type + ':' + id;

export function traceSaleDocuments(groups, {strictContact = false} = {}) {
  const docs = new Map();
  const byNumber = new Map();
  const parents = new Map();
  const children = new Map();

  for (const [type, list] of groups) {
    for (const doc of list) {
      const id = String(doc.documentId ?? doc.recordId ?? '');
      if (!id) continue;
      const key = keyOf(type, id);
      const number = String(doc.documentSerial ?? '').trim().toUpperCase();
      docs.set(key, {...doc, id, type, key, number});
      if (number) byNumber.set(number, byNumber.has(number) ? null : key);
    }
  }

  function link(from, to) {
    if (from === to || !docs.has(from) || !docs.has(to)) return;
    if (cancelled(docs.get(from))) return;
    if (strictContact) {
      const left = docs.get(from);
      const right = docs.get(to);
      if (left.contactId == null || right.contactId == null || String(left.contactId) !== String(right.contactId)) return;
    }
    if (!parents.has(to)) parents.set(to, new Set());
    if (!children.has(from)) children.set(from, new Set());
    parents.get(to).add(from);
    children.get(from).add(to);
  }

  for (const doc of docs.values()) {
    for (const linkData of [...(doc.referencedByMe ?? []), ...(doc.referencedToMe ?? [])]) {
      const from = keyOf(linkData.referenceDocumentType, linkData.referenceId);
      const to = keyOf(linkData.documentType, linkData.documentId);
      if (from === doc.key || to === doc.key) link(from, to);
    }
    for (const item of [...(doc.items ?? []), ...(doc.documentReference ?? [])]) {
      const itemKey = keyOf(item.documentType ?? item.referenceDocumentType, item.documentId ?? item.referenceId);
      const source = docs.get(itemKey) ?? docs.get(byNumber.get(String(item.documentSerial ?? item.referenceDocumentSerial ?? '').toUpperCase()));
      if (source && source.type !== '9') link(source.key, doc.key);
    }
    const serials = String(doc.reference ?? '').toUpperCase().match(/\b(?:QT|INV|BL|CAI|RI)[A-Z0-9-]{5,25}\b/g) ?? [];
    if (doc.type === '9') {
      for (const item of doc.items ?? []) serials.push(...reviewQuoteNumbers(item, doc));
    }
    for (const serial of serials) {
      const source = docs.get(byNumber.get(serial));
      if (source && source.type !== '9') link(source.key, doc.key);
    }
  }

  function walk(start, edges) {
    const seen = new Set([start]);
    const queue = [start];
    for (const next of queue) {
      for (const key of edges.get(next) ?? []) {
        if (seen.has(key)) continue;
        seen.add(key);
        if (!cancelled(docs.get(key))) queue.push(key);
      }
    }
    seen.delete(start);
    return [...seen].map(key => docs.get(key));
  }

  const newReceipts = new Map();
  const splitReceiptIds = new Set();
  const cents = value => value != null && value !== '' && Number.isFinite(Number(value))
    ? Math.round(Number(value) * 100) : null;
  function addPayment(quote, receipt, netCents, invoices) {
    if (!newReceipts.has(quote.id)) newReceipts.set(quote.id, new Map());
    newReceipts.get(quote.id).set(receipt.id, {
      number: receipt.number,
      date: String(receipt.publishedOn ?? receipt.documentDate ?? '').slice(0, 10),
      invoiceNumbers: invoices.map(doc => doc.number).filter(Boolean),
      netCents,
    });
  }
  for (const receipt of docs.values()) {
    if (!paid(receipt)) continue;
    const upstream = walk(receipt.key, parents);
    const quotes = upstream.filter(doc => doc.type === '3' && !cancelled(doc));
    const invoices = [...(parents.get(receipt.key) ?? [])].map(key => docs.get(key))
      .filter(doc => intermediateTypes.has(doc.type));
    const net = cents(receiptNetBeforeVat(receipt));
    if (net == null) continue;
    if (quotes.length === 1 && invoices.every(doc => walk(doc.key, parents).some(parent => parent.key === quotes[0].key))) {
      addPayment(quotes[0], receipt, net, upstream.filter(doc => intermediateTypes.has(doc.type)));
      continue;
    }
    if (!strictContact || String(receipt.isBatchDocument).toLowerCase() !== 'true' || invoices.length < 2 ||
        invoices.some(invoice => invoice.type !== '7') || receipt.items.length !== invoices.length) continue;
    const sourceIds = new Set(receipt.items.map(item => String(item.documentId ?? item.referenceId ?? '')));
    if (sourceIds.size !== invoices.length || invoices.some(invoice => !sourceIds.has(invoice.id))) continue;
    const parts = invoices.map(invoice => {
      const owners = walk(invoice.key, parents).filter(doc => doc.type === '3');
      const gross = cents(invoice.grandTotal);
      const invoiceNet = gross != null && cents(invoice.vatAmount) != null
        ? gross - cents(invoice.vatAmount) : cents(invoice.totalWithoutVat);
      return {invoice, owners, gross, invoiceNet};
    });
    if (parts.some(part => part.owners.length !== 1 || !(part.gross > 0) || !(part.invoiceNet > 0)) ||
        parts.reduce((sum,part) => sum + part.gross,0) !== cents(receipt.grandTotal) ||
        parts.reduce((sum,part) => sum + part.invoiceNet,0) !== net) continue;
    const perQuote = new Map();
    for (const part of parts) {
      const [quote] = part.owners;
      if (!perQuote.has(quote.id)) perQuote.set(quote.id, {quote, net:0, invoices:[]});
      const group = perQuote.get(quote.id);
      group.net += part.invoiceNet;
      group.invoices.push(part.invoice);
    }
    splitReceiptIds.add(receipt.id);
    for (const part of perQuote.values()) addPayment(part.quote, receipt, part.net, part.invoices);
  }

  function issue(quoteId) {
    const downstream = walk(keyOf('3', quoteId), children);
    const receipts = downstream.filter(doc => doc.type === '9');
    const invoices = downstream.filter(doc => intermediateTypes.has(doc.type));
    const paidReceipts = receipts.filter(paid);
    const labels = list => list.map(doc => doc.number || doc.id).join(', ');
    if (paidReceipts.length) return `พบใบเสร็จชำระครบ ${labels(paidReceipts)} แต่ยังแยกยอดให้ใบเสนอราคานี้ไม่ได้`;
    if (receipts.length) return `ใบเสร็จ ${labels(receipts)} ยังไม่มีสถานะชำระครบ`;
    if (invoices.length) return `พบ ${labels(invoices)} ยังไม่พบใบเสร็จที่อ้างอิง`;
    return 'ยังไม่พบใบแจ้งหนี้หรือใบเสร็จที่อ้างถึงใบเสนอราคานี้';
  }

  function describe(key, edges) {
    return walk(key, edges).map(doc => ({
      id:doc.id, number:doc.number, type:doc.type, status:doc.statusString, paid:paid(doc),
    }));
  }
  return {newReceipts, splitReceiptIds, issue,
    documentsAfterQuote: id => describe(keyOf('3', id), children),
    documentsBeforeReceipt: id => describe(keyOf('9', id), parents),
  };
}
