import { handler } from '../server/flowaccount.mjs';

const base = '/integration/flowaccount/';

export default async function flowaccount(req, res) {
  const requestUrl = new URL(req.url, 'https://localhost');
  const route = requestUrl.pathname.startsWith(base)
    ? requestUrl.pathname.slice(base.length)
    : requestUrl.searchParams.get('flowaccountRoute');
  if (!route || !/^[a-z][a-z-]*(?:\/[a-z][a-z-]*)?$/.test(route)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.writeHead(404);
    return res.end(JSON.stringify({ message: 'ไม่พบเส้นทาง FlowAccount' }));
  }
  requestUrl.searchParams.delete('flowaccountRoute');
  req.url = base + route + requestUrl.search;
  await handler(req, res);
}
