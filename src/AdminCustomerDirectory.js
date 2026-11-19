import { useEffect, useState } from 'react';

const initialQuery = { page: 1, search: '', fresh: false };

export default function AdminCustomerDirectory({ api, disabled, onSelect }) {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    api.adminCustomers(query.page, query.search, query.fresh, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ data }); },
      error => { if (!controller.signal.aborted) setResult({ error: error.message }); },
    );
    return () => controller.abort();
  }, [api, query]);

  function load(page, search, fresh = false) {
    setResult(null);
    setQuery({ page, search, fresh });
  }

  const data = result?.data;
  return (
    <div>
      <h3>รายชื่อลูกค้า FlowAccount Production</h3>
      <form onSubmit={event => { event.preventDefault(); load(1, input.trim()); }}>
        <label>ค้นด้วยชื่อบริษัท เลขผู้เสียภาษี หรือรหัสลูกค้า
          <input type="search" value={input} maxLength={100} onChange={event => setInput(event.target.value)} />
        </label>
        <div className="list-row">
          <button type="submit" disabled={!result || disabled}>ค้นหารายชื่อ</button>
          <button type="button" disabled={!result || disabled} onClick={() => load(1, input.trim(), true)}>ดึงรายชื่อล่าสุด</button>
        </div>
      </form>
      {!result && <p role="status">กำลังโหลดรายชื่อลูกค้าจริง…</p>}
      {result?.error && <p className="notice" role="alert">{result.error}</p>}
      {data && (
        <>
          <p className="muted">พบ {data.total.toLocaleString('th-TH')} รายชื่อที่มีเลขผู้เสียภาษีและสาขาสำหรับเปิดบัญชี</p>
          {data.customers.length > 0 && (
            <div className="table-scroll">
              <table>
                <thead><tr><th scope="col">ลูกค้า</th><th scope="col">เลขผู้เสียภาษี</th><th scope="col">สาขา</th><th scope="col">รหัสลูกค้า</th><th scope="col">ดำเนินการ</th></tr></thead>
                <tbody>{data.customers.map(company => (
                  <tr key={company.id}>
                    <td>{company.name}</td><td>{company.tax}</td><td>{company.branch}</td><td>{company.code}</td>
                    <td><button type="button" disabled={disabled} onClick={() => onSelect(company)}>เลือก {company.name}</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.total > data.pageSize && (
            <div className="section-title">
              <button type="button" disabled={data.page <= 1 || disabled} onClick={() => load(data.page - 1, query.search)}>หน้าก่อน</button>
              <span>หน้า {data.page} / {Math.ceil(data.total / data.pageSize)}</span>
              <button type="button" disabled={data.page * data.pageSize >= data.total || disabled} onClick={() => load(data.page + 1, query.search)}>หน้าถัดไป</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
