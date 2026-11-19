describe('FlowAccount response contract on hosted deployments', () => {
  let api;
  const savedFetch = global.fetch;
  const savedUrl = process.env.REACT_APP_SUPABASE_URL;
  const savedKey = process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;

  beforeEach(() => {
    process.env.REACT_APP_SUPABASE_URL = 'https://example.invalid';
    process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY = 'fixture';
    jest.isolateModules(() => { ({ api } = require('./api')); });
  });

  afterEach(() => {
    global.fetch = savedFetch;
    if (savedUrl === undefined) delete process.env.REACT_APP_SUPABASE_URL;
    else process.env.REACT_APP_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY;
    else process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY = savedKey;
  });

  test.each([
    ['customer directory', api => api.adminCustomers(1, '', false)],
    ['report status', api => api.salesReviewRefresh('GET')],
    ['sales documents', api => api.flowaccount('sales-documents')],
    ['EPC receipts', api => api.customerCoin(1)],
  ])('rejects SPA HTML returned for %s', async (_, load) => {
    global.fetch = jest.fn(async () => ({
      ok: true, status: 200, json: async () => { throw new SyntaxError('HTML'); },
    }));
    await expect(load(api)).rejects.toThrow('เว็บนี้ยังเชื่อมเซิร์ฟเวอร์ FlowAccount ไม่ได้');
  });

  test('rejects the website shell as a sales report and accepts the actual report', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<html><div id="root"></div></html>' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<script id="dataset" type="application/json">{}</script>' });
    await expect(api.salesReview()).rejects.toThrow('เว็บนี้ยังเชื่อมเซิร์ฟเวอร์ FlowAccount ไม่ได้');
    await expect(api.salesReview()).resolves.toContain('id="dataset"');
  });

  test('preserves the bridge’s real error details', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 429, json: async () => ({ message: 'ลองใหม่ภายหลัง', retryAfter: 4 }) }));
    await expect(api.adminCustomers(1, '', false)).rejects.toMatchObject({ message: 'ลองใหม่ภายหลัง', retryAfter: 4 });
  });
});
