import { useEffect, useState } from 'react';

const format = value => value == null ? 'รอตรวจ' : Number(value).toLocaleString('th-TH', {
  maximumFractionDigits: 2,
});

export default function CustomerPurchaseSummary({ api, tax, branch, code }) {
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.customerPurchases({ tax, branch, code }, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ data }); },
      error => { if (!controller.signal.aborted) setResult({ error: error.message }); },
    );
    return () => controller.abort();
  }, [api, tax, branch, code, revision]);

  return (
    <section aria-labelledby="customer-purchases-heading">
      <h3 id="customer-purchases-heading">ประวัติซื้อจาก FlowAccount</h3>
      {!result && <p role="status">กำลังดึงยอดซื้อและรายการสินค้า…</p>}
      {result?.error && (
        <div>
          <p role="alert">{result.error}</p>
          <button type="button" onClick={() => { setResult(null); setRevision(value => value + 1); }}>
            ลองดึงยอดซื้ออีกครั้ง
          </button>
        </div>
      )}
      {result?.data && <PurchaseTotals data={result.data} />}
    </section>
  );
}

const bangkokTime = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok',
});

function PurchaseTotals({ data }) {
  return (
    <>
      {data.loadedAt && <p className="muted">FlowAccount Production · ดึงข้อมูล {bangkokTime.format(new Date(data.loadedAt))} น.</p>}
      <p>ยอดตามใบกำกับภาษี (รวม VAT) <strong>{format(data.invoiced)} บาท</strong> · {format(data.invoiceCount)} ใบ</p>
      <p>ยอดรับชำระตามใบเสร็จสถานะชำระแล้ว <strong>{format(data.paid)} บาท</strong> · {format(data.paidReceiptCount)} ใบ</p>
      {data.missingDocuments > 0 && (
        <p className="notice">{format(data.missingDocuments)} ใบกำกับภาษีไม่มีรายการสินค้าในผล API แต่ยังรวมยอดตามเอกสาร</p>
      )}
      {data.products.length ? (
        <details>
          <summary>ดูรายการสินค้า ({format(data.products.length)} รายการแยกตามหน่วย)</summary>
          <div className="table-scroll">
            <table>
              <thead><tr><th scope="col">สินค้า</th><th scope="col">จำนวน</th><th scope="col">ยอดตามรายการ (บาท)</th></tr></thead>
              <tbody>
                {data.products.map(item => (
                  <tr key={JSON.stringify([item.name, item.unit])}>
                    <td>{item.name}</td><td>{format(item.quantity)} {item.unit}</td><td>{format(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">ใช้ยอดรายบรรทัดจากใบกำกับภาษี ยอดอาจต่างจากยอดรวมท้ายเอกสารเมื่อมี VAT หรือส่วนลดท้ายบิล</p>
        </details>
      ) : <p>ไม่พบรายละเอียดสินค้าในใบกำกับภาษีที่ตรงกับลูกค้ารายนี้</p>}
    </>
  );
}
