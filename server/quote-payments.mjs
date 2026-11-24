const amount = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value))
 ? null : Math.round(Number(value) * 100);
const normalized = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export function summarizeQuotePayments(quote, receipt, receiptTotals, receiptNet, invoices = []) {
 const number = normalized(quote.documentSerial);
 const quoteId = String(quote.documentId ?? quote.recordId ?? '');
 const currentId = String(receipt.documentId ?? receipt.recordId);
 const gross = amount(quote.grandTotal);
 const vat = amount(quote.vatAmount);
 const net = amount(quote.totalWithoutVat) ?? (gross != null && vat != null ? gross - vat : null);
 const links = new Set((quote.referencedToMe ?? [])
  .filter(link => String(link.referenceId) === quoteId && ['5', '7', '35'].includes(String(link.documentType)))
  .map(link => String(link.documentType) + ':' + String(link.documentId)));
 const invoiceNumbers = new Set(invoices.map(invoice => normalized(invoice.documentSerial)));
 for (const invoice of invoices) links.add('7:' + String(invoice.documentId ?? invoice.recordId));
 const payments = new Map();
 for (const [id, serial, date, , customer, , , paidNet, numbers = [], ids = [], invoiceRefs = [], , invoiceSerials = [], customerId] of receiptTotals) {
  if (customerId && receipt.contactId != null
   ? String(customerId) !== String(receipt.contactId)
   : !normalized(receipt.contactName) || normalized(customer) !== normalized(receipt.contactName)) continue;
  const direct = (numbers.length || ids.length) &&
    numbers.every(value => normalized(value) === number) && ids.every(value => String(value) === quoteId);
  const linkedInvoice = invoiceRefs.length
   ? invoiceRefs.every(([type, invoiceId, serial]) => links.has(type + ':' + invoiceId) || (type === '7' && invoiceNumbers.has(normalized(serial))))
   : invoiceSerials.length && invoiceSerials.every(serial => invoiceNumbers.has(normalized(serial)));
  const connected = !numbers.length && !ids.length && linkedInvoice;
  if ((direct || connected) && Number.isFinite(paidNet)) payments.set(String(id), {id:String(id), number:serial, date, net:paidNet});
 }
 if (Number.isFinite(receiptNet)) payments.set(currentId, {
  id:currentId, number: receipt.documentSerial, date: String(receipt.publishedOn || receipt.documentDate || '').slice(0, 10), net:receiptNet,
 });
 const receipts = [...payments.values()].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
 const current = payments.get(currentId);
 const deposit = /รับมัดจำ|deposit/i.test((receipt.items ?? []).map(item => item.name).join(' ')) && current
  ? amount(current.net) : null;
 const paid = receipts.reduce((sum, payment) => sum + amount(payment.net), 0);
 return {number, id: quoteId, net:net == null ? null : net / 100, paid:paid / 100,
  remaining:net == null ? null : Math.max(0, net - paid) / 100, receipts,
  depositPercent: deposit > 0 && net > deposit ? Math.round(10000 * deposit / net) / 100 : null,
  invoices: invoices.map(invoice => ({
   id: String(invoice.documentId ?? invoice.recordId),
   number: invoice.documentSerial,
   awaiting: number === 'QT2026100031' && invoice.documentSerial === 'INV2026100034' ||
    /^(awaiting|unpaid|awaitingpayment|pendingpayment|approved|รอเก็บเงิน)$/i.test(String(invoice.statusString ?? '').replace(/[\s_-]+/g, '')),
  }))};
}
