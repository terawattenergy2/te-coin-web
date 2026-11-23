import {setTimeout as delay} from 'node:timers/promises';
import {saleDocumentTypes, traceSaleDocuments} from './sale-document-trace.mjs';

const outcomes = new Map([
  ['approvedandprocessed', 'won'],
  ['rejected', 'lost'],
  ['void', 'excluded'],
  ['cancelled', 'excluded'],
  ['canceled', 'excluded'],
  ['draft', 'excluded'],
]);

export async function loadSaleSuccess(flow, receiptTotals = [], {trace = false} = {}) {
  const pageSize = 200;
  const quotes = new Map();
  const quoteIdsByInvoice = new Map();
  async function loadPage(endpoint, page) {
    for (let attempt = 0; ; attempt++) {
      try { return await flow(`${endpoint}?currentPage=${page}&pageSize=${pageSize}`); }
      catch (error) {
        if (!error.retryAfter || error.retryAfter > 90 || attempt >= 1) throw error;
        await delay(error.retryAfter * 1000 + 250);
      }
    }
  }

  async function loadDocuments(endpoint) {
    const docs = new Map();
    let page = 1;
    let pages = [await loadPage(endpoint, page)];
    let expected;
    while (pages.length) {
      for (const result of pages) {
        const list = result.data?.list;
        const total = Number(result.data?.totalDocument);
        if (result.status === false || !Array.isArray(list) || result.data?.totalDocument == null ||
            !Number.isSafeInteger(total) || total < 0) {
          throw Error('FlowAccount ส่งรายการเอกสารไม่สำเร็จ (' + endpoint + ')');
        }
        expected ??= total;
        if (total !== expected) throw Error('จำนวนเอกสารเปลี่ยนระหว่างโหลด กรุณาลองใหม่');
        for (const row of list) {
          const id = String(row.documentId ?? row.recordId ?? row.documentSerial ?? '').trim();
          if (!id) throw Error('พบเอกสารที่ไม่มีรหัส');
          docs.set(id, row);
        }
      }
      const remaining = Math.ceil(expected / pageSize) - page;
      pages = await Promise.all(Array.from({length: Math.min(4, remaining)}, async (_, index) => {
        if (index) await delay(index * 300);
        return loadPage(endpoint, page + index + 1);
      }));
      page += pages.length;
    }
    if (docs.size !== expected) throw Error('FlowAccount ส่งรายการเอกสารมาไม่ครบ (' + endpoint + ')');
    return docs;
  }

  const quoteDocs = await loadDocuments('quotations');
  for (const [id, row] of quoteDocs) {
    const number = String(row.documentSerial ?? '').trim();
    const status = String(row.statusString ?? '').trim();
    const outcome = row.isDelete === true ? 'excluded' : outcomes.get(status.toLowerCase()) ?? 'open';
    for (const link of Array.isArray(row.referencedToMe) ? row.referencedToMe : []) {
      const type = String(link.documentType);
      const linkedId = String(link.documentId);
      if (String(link.referenceId) !== id || !['5', '7', '35'].includes(type) || !/^\d+$/.test(linkedId)) continue;
      const key = type + ':' + linkedId;
      if (!quoteIdsByInvoice.has(key)) quoteIdsByInvoice.set(key, new Set());
      quoteIdsByInvoice.get(key).add(id);
    }
    quotes.set(id, {
      number,
      date: String(row.publishedOn ?? row.documentDate ?? '').slice(0, 10),
      seller: String(row.salesName ?? '').trim(),
      customer: String(row.contactName ?? '').trim(),
      status,
      outcome,
    });
  }
  const idsByNumber = new Map();
  for (const [id, quote] of quotes) {
    const number = quote.number.toUpperCase();
    idsByNumber.set(number, idsByNumber.has(number) ? null : id);
  }
  const receiptsByQuote = new Map();
  for (const [receiptId, receiptNumber, , , , , , net, numbers = [], ids = [], invoiceLinks = []] of receiptTotals) {
    if (!Number.isFinite(net)) continue;
    const candidates = new Set([...ids, ...numbers.map(number => idsByNumber.get(number))]
      .filter(id => quotes.has(id)));
    const hasDirectQuote = candidates.size > 0;
    for (const [type, invoiceId] of invoiceLinks) {
      for (const id of quoteIdsByInvoice.get(type + ':' + invoiceId) ?? []) candidates.add(id);
    }
    if (candidates.size !== 1) continue;
    const [id] = candidates;
    if (!hasDirectQuote && invoiceLinks.some(([type, invoiceId]) =>
      !quoteIdsByInvoice.get(type + ':' + invoiceId)?.has(id))) continue;
    if (!receiptsByQuote.has(id)) receiptsByQuote.set(id, new Map());
    const invoiceNumbers = [...new Set(invoiceLinks.filter(([type, invoiceId, serial]) =>
      serial && quoteIdsByInvoice.get(type + ':' + invoiceId)?.has(id)).map(([, , serial]) => serial))];
    receiptsByQuote.get(id).set(receiptId, {
      number: receiptNumber,
      invoiceNumbers,
      netCents: Math.sign(net) * Math.round(Math.abs(net) * 100),
    });
  }
  let traceResult;
  if (trace) {
    const documents = new Map([['3', [...quoteDocs.values()]]]);
    for (const [endpoint, type] of saleDocumentTypes) {
      if (endpoint !== 'quotations') documents.set(type, [...(await loadDocuments(endpoint)).values()]);
    }
    traceResult = traceSaleDocuments(documents);
    const alreadyCounted = new Set([...receiptsByQuote.values()].flatMap(receipts => [...receipts.keys()].map(String)));
    for (const [id, receipts] of traceResult.newReceipts) {
      if (!receiptsByQuote.has(id)) receiptsByQuote.set(id, new Map());
      for (const [receiptId, receipt] of receipts) {
        if (alreadyCounted.has(receiptId)) continue;
        receiptsByQuote.get(id).set(receiptId, receipt);
        alreadyCounted.add(receiptId);
      }
    }
  }

  const rows = [...quotes].filter(([, quote]) => quote.outcome !== 'excluded').map(([id, quote]) => {
    const receipts = [...(receiptsByQuote.get(id)?.values() ?? [])];
    const receiptNetCents = receipts.length ? receipts.reduce((sum, receipt) => sum + receipt.netCents, 0) : null;
    return {...quote, receiptNetCents, receipts,
      receiptIssue: receiptNetCents == null && quote.outcome === 'won' ? traceResult?.issue(id) : undefined};
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  return {rows, loadedAt: new Date().toISOString()};
}
