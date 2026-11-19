import React, { useEffect, useState } from 'react';
import './FlowAccountCustomer.css';

const fmt = value => Number(value).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const statuses = { paid: 'รับชำระแล้ว', awaiting: 'รอชำระ', void: 'ยกเลิก' };
const dateTime = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok',
});

export default function FlowAccountCustomer({ api, customer, onRewards }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    api.customerCoin(page, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message || 'ยังโหลดข้อมูลจาก FlowAccount ไม่ได้');
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [api, customer.customer_id, page, revision]);

  const balance = data?.balance ?? customer.banlance_tc;
  return (
    <>
      <section className="hero epc-purchases epc-coin-hero" aria-label="Coin ของบริษัท">
        <div className="epc-hero-content">
          <div className="epc-purchases-header">
            <div>
              <div className="eyebrow">TeraCoin ของบริษัทคุณ</div>
              <h2>{customer.customer_name}</h2>
            </div>
          </div>
          <div className="epc-coin-primary">
            <span className="epc-metric-label">แต้มที่ใช้แลกรางวัลได้</span>
            <div className="epc-coin-value">{fmt(balance ?? 0)} <span>TC</span></div>
          </div>
          <div className="epc-hero-actions">
            <button className="light" onClick={onRewards}>ดูรางวัลและเงินคืน</button>
            <button className="epc-refresh" disabled={busy} onClick={() => { setPage(1); setRevision(value => value + 1); }}>
              {busy ? 'กำลังดึงข้อมูล…' : 'ดึงข้อมูลล่าสุด'}
            </button>
          </div>
          {error && <p className="notice" role="alert">{error}{data?.linked && ' · ยังแสดงข้อมูลที่โหลดสำเร็จครั้งล่าสุด'}</p>}
          {data && !data.linked && <p>ให้ผู้ดูแลเชื่อมบัญชี EPC กับ FlowAccount เพื่อแสดงใบเสร็จของบริษัท</p>}
        </div>
      </section>
      {data?.linked && (
        <section className="panel">
          <div className="section-title">
            <h2>ใบเสร็จจาก FlowAccount</h2>
            <p className="muted">ดึงล่าสุด {dateTime.format(new Date(data.loadedAt))} น.</p>
          </div>
          {data.receipts.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">เลขที่ใบเสร็จ</th><th scope="col">วันที่</th><th scope="col">สถานะ</th><th scope="col">ยอดรวม (บาท)</th><th scope="col">แต้มที่บันทึกแล้ว</th></tr></thead>
                <tbody>{data.receipts.map(receipt => (
                  <tr key={receipt.id}>
                    <td>{receipt.number || receipt.id}</td>
                    <td>{String(receipt.date || '—').slice(0, 10)}</td>
                    <td>{statuses[receipt.status] || receipt.status || '—'}</td>
                    <td>{receipt.total == null ? '—' : fmt(receipt.total)}</td>
                    <td>{receipt.credited == null ? 'ยังไม่มีแต้มที่บันทึก' : fmt(receipt.credited) + ' TC'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>ไม่พบใบเสร็จของบริษัทในหน้านี้</p>}
          <div className="section-title">
            <button disabled={busy || data.page <= 1} onClick={() => setPage(data.page - 1)}>หน้าก่อน</button>
            <span>หน้า {data.page}</span>
            <button disabled={busy || !data.hasNext} onClick={() => setPage(data.page + 1)}>หน้าถัดไป</button>
          </div>
        </section>
      )}
    </>
  );
}
