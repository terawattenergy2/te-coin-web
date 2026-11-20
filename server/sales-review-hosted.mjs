import { timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { fetchPaidReviewReceipts } from './sales-review-sync.mjs';
import { buildReviewData } from './sales-review-data.mjs';

const compress = promisify(gzip);
const decompress = promisify(gunzip);
const bucket = 'teracoin-sales-review';

export function validCron(authorization, secret) {
 if (!authorization || !secret) return false;
 const actual = Buffer.from(authorization);
 const expected = Buffer.from('Bearer ' + secret);
 return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHostedReview({ flow, url, key, source }) {
 const enabled = Boolean(url && key && source);
 const object = `${bucket}/${encodeURIComponent(source)}/paid-receipts.json.gz`;
 const headers = { apikey: key };
 if (key?.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
 let pending;

 async function storage(method, body, info = false) {
  if (!enabled) throw Error('ยังไม่ได้ตั้งค่าพื้นที่เก็บรายงานยอดขาย');
  const prefix = info ? 'info/' : method === 'POST' ? '' : 'authenticated/';
  const query = method === 'GET' ? '?refresh=' + Date.now() : '';
  const response = await fetch(`${url}/storage/v1/object/${prefix}${object}${query}`, {
   method, body,
   headers: body ? {...headers, 'Content-Type': 'application/gzip', 'x-upsert': 'true', 'cache-control': 'max-age=0'} : headers,
   cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  if (method !== 'POST' && (response.status === 404 || (response.status === 400 &&
    (await response.clone().json().catch(() => null))?.statusCode === '404'))) return null;
  if (!response.ok) throw Error(`เข้าถึงพื้นที่เก็บรายงานยอดขายไม่ได้ (HTTP ${response.status})`);
  return response;
 }

 async function refresh() {
  if (pending) return pending;
  pending = (async () => {
   const receipts = await fetchPaidReviewReceipts(flow, 150);
   const data = buildReviewData(receipts);
   await storage('POST', await compress(JSON.stringify(data)));
   return {state: 'succeeded', finishedAt: data.meta.loadedAt};
  })();
  try { return await pending; }
  finally { pending = undefined; }
 }

 return {
  refresh,
  async status() {
   if (!enabled) return {state: 'failed', message: 'ยังไม่ได้ตั้งค่าพื้นที่เก็บรายงานยอดขาย'};
   if (pending) return {state: 'running'};
   const response = await storage('GET', undefined, true);
   const info = await response?.json();
   const time = Date.parse(info?.updated_at || info?.last_modified || '');
   return Number.isFinite(time) ? {state: 'succeeded', finishedAt: new Date(time).toISOString()} : {state: 'idle'};
  },
  async data() {
   const response = await storage('GET');
   return response && (await decompress(Buffer.from(await response.arrayBuffer()))).toString('utf8');
  },
 };
}
