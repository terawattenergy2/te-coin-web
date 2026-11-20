import { useEffect, useRef, useState } from 'react';

const reportPolicy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`;

export default function SalesReview({ api }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [job, setJob] = useState({ state: 'idle' });
  const [starting, setStarting] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const lastFinished = useRef();
  const startRequest = useRef();
  const refreshing = starting || job.state === 'running';

  useEffect(() => {
    const controller = new AbortController();
    api.salesReview(controller.signal).then(
      html => { if (!controller.signal.aborted) setResult({ html }); },
      error => { if (!controller.signal.aborted) setResult(current => current?.html ? current : { error: error.message }); },
    );
    return () => controller.abort();
  }, [api, revision]);

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    async function check() {
      let nextDelay = 10000;
      try {
        const nextJob = await api.salesReviewRefresh('GET', controller.signal);
        if (controller.signal.aborted) return;
        if (nextJob.state === 'succeeded' && nextJob.finishedAt !== lastFinished.current) {
          if (lastFinished.current !== undefined) setRevision(value => value + 1);
          lastFinished.current = nextJob.finishedAt;
        } else if (lastFinished.current === undefined) {
          lastFinished.current = null;
        }
        setJob(nextJob);
        nextDelay = nextJob.state === 'running' ? 2000 : 20000;
      } catch (error) {
        if (!controller.signal.aborted) {
          setJob(current => current.state === 'running' ? current : { state: 'failed', message: error.message });
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(check, nextDelay);
    }

    check();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [api, starting]);

  useEffect(() => () => startRequest.current?.abort(), []);

  async function refresh() {
    if (startRequest.current) return;
    const controller = new AbortController();
    startRequest.current = controller;
    setRefreshError(null);
    setStarting(true);
    try {
      const nextJob = await api.salesReviewRefresh('POST', controller.signal);
      if (!controller.signal.aborted) {
        setJob(nextJob);
        if (nextJob.state === 'succeeded') setRevision(value => value + 1);
      }
    } catch (error) {
      if (!controller.signal.aborted) setRefreshError(error.message);
    } finally {
      startRequest.current = null;
      if (!controller.signal.aborted) setStarting(false);
    }
  }

  return (
    <>
      <div className="sales-review-refresh">
        <button type="button" disabled={refreshing || job.state === 'disabled'} onClick={refresh}>
          {refreshing ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลล่าสุด'}
        </button>
        <span role="status">
          {refreshing && 'กำลังดึงใบเสร็จรับเงินจาก FlowAccount รายงานชุดล่าสุดยังเปิดดูได้'}
          {!refreshing && (refreshError || job.state === 'failed') &&
            (refreshError || job.message || 'ดึงข้อมูลไม่สำเร็จ')}
          {!refreshing && !refreshError && job.state === 'succeeded' && 'ดึงข้อมูลล่าสุดสำเร็จ'}
          {job.state === 'disabled' && 'การดึงข้อมูลล่าสุดเปิดใช้กับ FlowAccount Production'}
          {job.state === 'idle' && !refreshing && !refreshError && 'กดดึงข้อมูลล่าสุดเพื่อโหลดใบเสร็จรับเงิน'}
        </span>
        <span>อัปเดตอัตโนมัติทุกวันช่วง 03:00–03:59 น. (เวลาไทย)</span>
      </div>
      {!result && <p className="notice" role="status">กำลังโหลดรายงานยอดขาย…</p>}
      {result?.error && (
        <div className="notice">
          <p role="alert">{result.error}</p>
          <button type="button" onClick={() => { setResult(null); setRevision(value => value + 1); }}>
            ลองโหลดรายงานใหม่
          </button>
        </div>
      )}
      {result?.html && (
        <iframe
          title="รายงานยอดขายแยกตามเซลส์และสินค้า"
          sandbox="allow-scripts allow-downloads"
          srcDoc={result.html.replace(/<head>/i, '<head>' + reportPolicy)}
          className="sales-review-frame"
        />
      )}
    </>
  );
}
