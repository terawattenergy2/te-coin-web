const upstream = 'https://te-coin-web.vercel.app';
const reportRoutes = new Map([
  ['seller-groups', ['GET', '/seller-groups']],
  ['confirm-sellers', ['POST', '/seller-groups']],
  ['sale-success', ['GET', '/sale-success']],
  ['audit', ['GET', '/product-audit']],
  ['report', ['GET', '']],
  ['refresh', ['POST', '/refresh']],
  ['deposit', ['GET', '/deposit']],
  ['status', ['GET', '/refresh']],
]);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'https://localhost');
  const route = url.searchParams.get('route');
  const target = reportRoutes.get(route);
  const authorization = req.headers.authorization;
  if (!target || req.method !== target[0]) return res.status(405).json({message: 'เส้นทางนี้ไม่รองรับ'});
  if (!authorization?.startsWith('Bearer ')) return res.status(401).json({message: 'กรุณาเข้าสู่ระบบ'});
  if (req.headers.origin && req.headers.origin !== 'https://' + req.headers.host) {
    return res.status(403).json({message: 'ต้นทางไม่ได้รับอนุญาต'});
  }
  const source = new URL('/integration/flowaccount/sales-review' + target[1], upstream);
  if (route === 'deposit') {
    const id = url.searchParams.get('id');
    if (!/^\d{1,20}$/.test(id ?? '')) return res.status(400).json({message: 'รหัสใบเสร็จไม่ถูกต้อง'});
    source.searchParams.set('id', id);
  }
  try {
    const headers = {Authorization: authorization};
    let body;
    if (route === 'confirm-sellers') {
      headers['Content-Type'] = 'application/json';
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});
      if (body.length > 24000) return res.status(413).json({message: 'ข้อมูลการรวมชื่อมีขนาดเกินกำหนด'});
    }
    const response = await fetch(source, {method: req.method, headers, body,
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(280000)});
    res.statusCode = response.status;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
    const policy = response.headers.get('content-security-policy');
    if (policy) res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Keep the JSON/HTML stream private and allow large reports through the proxy.
    for await (const chunk of response.body) {
      if (!res.write(chunk)) await new Promise(resolve => res.once('drain', resolve));
    }
    res.end();
  } catch {
    if (res.headersSent) return res.destroy();
    return res.status(502).json({message: 'ติดต่อเซิร์ฟเวอร์รายงานไม่สำเร็จ'});
  }
}
