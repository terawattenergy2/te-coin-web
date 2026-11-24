const amount = value => value == null || String(value).trim() === '' || !Number.isFinite(Number(value))
 ? null : Math.round(Number(value) * 100);
const normalized = value => String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

export function summarizeQuotePayments(quote, receipt, receiptTotals, receiptNet) {
 const number = normalized(quote.documentSerial);
 const quoteId = String(quote.documentId ?? quote.recordId ?? '');
 const currentId = String(receipt.documentId ?? receipt.recordId);
 const gross = amount(quote.grandTotal);
 const vat = amount(quote.vatAmount);
 const net = amount(quote.totalWithoutVat) ?? (gross != null && vat != null ? gross - vat : null);
 const links = new Set((quote.referencedToMe ?? [])
  .filter(link => String(link.referenceId) === quoteId && ['5', '7', '35'].includes(String(link.documentType)))
  .map(link => String(link.documentType) + ':' + String(link.documentId)));
 const payments = new Map();
 for (const [id, serial, date, , customer, , , paidNet, numbers = [], ids = [], invoices = []] of receiptTotals) {
  if (!normalized(receipt.contactName) || normalized(customer) !== normalized(receipt.contactName)) continue;
  const direct = (numbers.length || ids.length) &&
    numbers.every(value => normalized(value) === number) && ids.every(value => String(value) === quoteId);
  const connected = !numbers.length && !ids.length && invoices.length && invoices.every(([type, invoiceId]) => links.has(type + ':' + invoiceId));
  if ((direct || connected) && Number.isFinite(paidNet)) payments.set(String(id), {number:serial, date, net:paidNet});
 }
 if (Number.isFinite(receiptNet)) payments.set(currentId, {
  number: receipt.documentSerial, date: String(receipt.publishedOn || receipt.documentDate || '').slice(0, 10), net:receiptNet,
 });
 const receipts = [...payments.values()].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
 const paid = receipts.reduce((sum, payment) => sum + amount(payment.net), 0);
 return {number, net:net == null ? null : net / 100, paid:paid / 100,
  remaining:net == null ? null : Math.max(0, net - paid) / 100, receipts};
}
