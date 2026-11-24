import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { buildReviewData, depositPattern, needsReceiptProducts, receiptInvoiceReferences, reviewQuoteNumbers, shippingInvoiceIds, shippingPattern } from './sales-review-data.mjs';

const pageSize = 200;

export async function fetchPaidReviewReceipts(flow, interval = 300) {
  const receipts = new Map();
  let expected;
  for (let page = 1; page <= 1000; page++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await flow(`receipts?currentPage=${page}&pageSize=${pageSize}`);
        break;
      } catch (error) {
        if (!error.retryAfter || error.retryAfter > 120 || attempt === 2) throw error;
        await delay(error.retryAfter * 1000 + 250);
      }
    }

    const data = response?.data;
    const count = Number(data?.totalDocument);
    if (response?.status === false || data?.totalDocument == null || data.totalDocument === '' ||
        !Number.isSafeInteger(count) || count < 0 || !Array.isArray(data.list)) {
      throw new Error('ข้อมูลใบเสร็จรับเงินจาก FlowAccount ไม่ครบ');
    }
    expected ??= count;
    if (count !== expected) throw new Error('รายการใน FlowAccount เปลี่ยนระหว่างดึงข้อมูล กรุณาลองใหม่');
    for (const receipt of data.list) {
      const id = String(receipt.documentId ?? receipt.recordId ?? '');
      if (!id || receipts.has(id) || !Array.isArray(receipt.items)) {
        throw new Error('พบใบเสร็จรับเงินซ้ำหรือข้อมูลรายการไม่ครบ');
      }
      receipts.set(id, { ...receipt, documentId: id });
    }
    if (receipts.size > expected) throw new Error('จำนวนใบเสร็จรับเงินไม่ตรงกับ FlowAccount');
    if (receipts.size === expected) return [...receipts.values()].filter(receipt =>
      String(receipt.status) === '5' && String(receipt.statusString).toLowerCase() === 'paid' &&
      ![receipt.isDelete, receipt.isDeleted, receipt.isCancelled].some(flag =>
        flag === true || flag === 1 || flag === '1' || String(flag).toLowerCase() === 'true'));
    if (!data.list.length) break;
    await delay(interval);
  }
  throw new Error('ดึงใบเสร็จรับเงินไม่ครบตามจำนวนที่ FlowAccount แจ้ง');
}

async function findReportDocuments(flow, path, keys, keyOf, matches) {
  const found = new Map();
  const duplicates = new Set();
  if (!keys.size) return found;
  async function pageAt(page) {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await flow(`${path}?currentPage=${page}&pageSize=${pageSize}`);
        const count = Number(result.data?.totalDocument);
        if (result.status === false || result.data?.totalDocument == null ||
            !Number.isSafeInteger(count) || count < 0 || !Array.isArray(result.data?.list)) {
          throw Error('เอกสารอ้างอิงจาก FlowAccount ไม่ครบ');
        }
        return {count, rows: result.data.list};
      } catch (error) {
        if (!error.retryAfter || error.retryAfter > 75 || attempt >= 1) throw error;
        await delay(error.retryAfter * 1000 + 250);
      }
    }
  }
  const first = await pageAt(1);
  const pages = Math.ceil(first.count / pageSize);
  function add({count, rows}) {
    if (count !== first.count) throw Error('เอกสารอ้างอิงเปลี่ยนระหว่างดึงข้อมูล กรุณาลองใหม่');
    for (const document of rows) {
      const key = keyOf(document);
      if (matches ? !matches(document) : !keys.has(key)) continue;
      if (found.has(key)) duplicates.add(key);
      found.set(key, document);
    }
  }
  add(first);
  for (let page = 2; page <= pages && (matches || found.size < keys.size); page += 6) {
    const batch = Array.from({length: Math.min(6, pages - page + 1)}, async (_, offset) => {
      if (offset) await delay(offset * 750);
      return pageAt(page + offset);
    });
    for (const result of await Promise.all(batch)) add(result);
  }
  for (const key of duplicates) found.delete(key);
  return found;
}

export async function loadSalesReview(flow, interval) {
  const receipts = await fetchPaidReviewReceipts(flow, interval);
  const shippingReceipts = receipts.filter(receipt => receipt.items.some(item => shippingPattern.test(item.name || '')));
  const invoiceIds = new Set(shippingReceipts.flatMap(shippingInvoiceIds));
  const cashInvoiceIds = new Set();
  const installmentReceipts = receipts.filter(receipt => receipt.items.some(item =>
    depositPattern.test(String(item.name ?? '') + ' ' + String(item.description ?? ''))));
  for (const receipt of new Set([...receipts.filter(needsReceiptProducts), ...installmentReceipts])) {
    for (const {type, id} of receiptInvoiceReferences(receipt)) {
      (type === '7' ? invoiceIds : cashInvoiceIds).add(id);
    }
  }
  const invoices = await findReportDocuments(flow, 'tax-invoices', invoiceIds,
    document => String(document.documentId ?? document.recordId));
  const cashInvoices = await findReportDocuments(flow, 'cash-invoices', cashInvoiceIds,
    document => String(document.documentId ?? document.recordId));
  const numbers = new Set(receipts.flatMap(receipt => receipt.items.filter(item =>
    depositPattern.test(String(item.name ?? '') + ' ' + String(item.description ?? '')) || shippingPattern.test(item.name || ''))
    .flatMap(item => reviewQuoteNumbers(item, receipt))));
  for (const invoice of invoices.values()) {
    for (const number of reviewQuoteNumbers({}, invoice)) numbers.add(number);
  }
  const quotes = await findReportDocuments(flow, 'quotations', numbers,
    document => String(document.documentSerial || '').toUpperCase());
  const quoteInvoiceIds = new Set([...quotes.values()].flatMap(quote => (quote.referencedToMe ?? [])
    .filter(link => String(link.referenceId) === String(quote.documentId ?? quote.recordId) && String(link.documentType) === '7')
    .map(link => String(link.documentId))));
  const linkedInvoices = await findReportDocuments(flow, 'tax-invoices', numbers,
    document => String(document.documentId ?? document.recordId),
    document => quoteInvoiceIds.has(String(document.documentId ?? document.recordId)) ||
      reviewQuoteNumbers({}, document).some(number => quotes.has(number)));
  return buildReviewData(receipts, new Date(), quotes, invoices, cashInvoices, [...linkedInvoices.values()]);
}

// Bangkok is UTC+07 throughout the year. 20:00 UTC is 03:00 the next day there.
export function nextDailyReview(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(20, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

export function createReviewSync({ flow, path, enabled }) {
  const output = typeof path === 'string' ? resolve(path) : fileURLToPath(path);
  let status = { state: 'idle' };
  let pending;

  function start() {
    if (!enabled) return { state: 'disabled' };
    if (pending) return status;
    status = { state: 'running', startedAt: new Date().toISOString() };
    pending = (async () => {
      const [data, template] = await Promise.all([
        loadSalesReview(flow),
        readFile(new URL('./sales-review-template.html', import.meta.url), 'utf8'),
      ]);
      const temporary = output + '.' + randomUUID() + '.tmp';
      try {
        const safeData = JSON.stringify(data).replace(/</g, '\\u003c');
        await writeFile(temporary, template.replace('__DATA__', () => safeData), { mode: 0o600, flag: 'wx' });
        await rename(temporary, output);
      } finally {
        await rm(temporary, { force: true });
      }
      status = { ...status, state: 'succeeded', finishedAt: new Date().toISOString() };
    })().catch(error => {
      status = { ...status, state: 'failed', message: error.message || 'ดึงรายงานไม่สำเร็จ' };
    }).finally(() => { pending = undefined; });
    return status;
  }

  function schedule() {
    if (!enabled) return;
    const timer = setTimeout(() => {
      start();
      schedule();
    }, nextDailyReview() - Date.now());
    timer.unref();
  }

  return { start, schedule, status: () => enabled ? status : { state: 'disabled' } };
}
