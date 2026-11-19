import { execFile } from 'node:child_process';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const pageSize = 100;

export async function fetchReviewInvoices(flow, interval = 300) {
  const invoices = new Map();
  let expected;
  for (let page = 1; page <= 1000; page++) {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await flow(`tax-invoices?currentPage=${page}&pageSize=${pageSize}`);
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
      throw new Error('ข้อมูลใบกำกับภาษีจาก FlowAccount ไม่ครบ');
    }
    expected ??= count;
    if (count !== expected) throw new Error('รายการใน FlowAccount เปลี่ยนระหว่างดึงข้อมูล กรุณาลองใหม่');
    for (const invoice of data.list) {
      const id = String(invoice.documentId ?? invoice.recordId ?? '');
      if (!id || invoices.has(id) || !Array.isArray(invoice.items)) {
        throw new Error('พบใบกำกับภาษีซ้ำหรือข้อมูลรายการไม่ครบ');
      }
      invoices.set(id, { ...invoice, documentId: id });
    }
    if (invoices.size > expected) throw new Error('จำนวนใบกำกับภาษีไม่ตรงกับ FlowAccount');
    if (invoices.size === expected) return [...invoices.values()];
    if (!data.list.length) break;
    await delay(interval);
  }
  throw new Error('ดึงใบกำกับภาษีไม่ครบตามจำนวนที่ FlowAccount แจ้ง');
}

function buildData(python, invoices) {
  const builder = fileURLToPath(new URL('./sales-review-build.py', import.meta.url));
  return new Promise((resolveData, reject) => {
    const child = execFile(python, ['-X', 'utf8', builder], {
      timeout: 120000, maxBuffer: 128 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) reject(new Error('สร้างรายงานยอดขายไม่สำเร็จ กรุณาตรวจ Python 3 และข้อมูลใบกำกับภาษี'));
      else resolveData(stdout);
    });
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify(invoices));
  });
}

// Bangkok is UTC+07 throughout the year. 20:00 UTC is 03:00 the next day there.
export function nextDailyReview(now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(20, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

export function createReviewSync({ flow, path, python = 'python3', enabled }) {
  const output = typeof path === 'string' ? resolve(path) : fileURLToPath(path);
  let status = { state: 'idle' };
  let pending;

  function start() {
    if (!enabled) return { state: 'disabled' };
    if (pending) return status;
    status = { state: 'running', startedAt: new Date().toISOString() };
    pending = (async () => {
      const invoices = await fetchReviewInvoices(flow);
      const [data, template] = await Promise.all([
        buildData(python, invoices),
        readFile(new URL('./sales-review-template.html', import.meta.url), 'utf8'),
      ]);
      const temporary = output + '.' + randomUUID() + '.tmp';
      try {
        const safeData = data.replace(/</g, '\\u003c');
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
