import React, { useEffect, useState } from 'react';
import './FlowAccountDocuments.css';

const types = [
  ['quotations', 'ใบเสนอราคา'],
  ['billing-notes', 'ใบวางบิล'],
  ['tax-invoices', 'ใบกำกับภาษี'],
  ['receipts', 'ใบเสร็จรับเงิน'],
];

const money = new Intl.NumberFormat('th-TH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function FlowAccountDocuments({ demo, api }) {
  const [type, setType] = useState('receipts');
  const [bySalesperson, setBySalesperson] = useState(false);
  return (
    <section className="panel">
      <h2>รายการเอกสารขายของลูกค้า</h2>
      {!bySalesperson && <div className="sales-document-types" role="group" aria-label="ประเภทเอกสารขาย">
        {types.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)}>
            {label}
          </button>
        ))}
      </div>}
      {demo
        ? <p className="notice">เข้าสู่ระบบด้วยบัญชีแอดมินเพื่อดูเอกสารจาก FlowAccount</p>
        : <>
          <div className="sales-document-types" role="group" aria-label="รูปแบบรายงาน">
            <button type="button" aria-pressed={!bySalesperson} onClick={() => setBySalesperson(false)}>รายการเอกสาร</button>
            <button type="button" aria-pressed={bySalesperson} onClick={() => setBySalesperson(true)}>ยอดตามชื่อเซลส์</button>
          </div>
          {bySalesperson
            ? <SalespersonReport type="receipts" api={api} />
            : <DocumentList key={type} type={type} api={api} />}
        </>}
    </section>
  );
}

function DocumentList({ type, api }) {
  const [expanded, setExpanded] = useState(null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState({ page: 1, search: '' });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let current = true;
    let timer;
    const params = new URLSearchParams({ type, page: query.page, search: query.search });

    if (query.refresh) params.set('refresh', '1');

    async function fetchPage(attempt = 0) {
      setLoading(true);
      let wait = 0;
      try {
        const data = await api.flowaccount('sales-documents?' + params);
        if (!current) return;
        setResult(data);
        setError('');
        wait = data.retryAfter || 0;
      } catch (err) {
        if (!current) return;
        setError(err.message);
        wait = err.retryAfter || 0;
      }
      setLoading(false);
      if (wait > 0) {
        setRetryAfter(wait);
        timer = setTimeout(() => {
          setRetryAfter(0);
          if (attempt < 2) fetchPage(attempt + 1);
        }, Math.min(wait * 1000, 2147483647));
      }
    }

    fetchPage();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, query, type]);

  function load(page, search = query.search, refresh = false) {
    setExpanded(null);
    setLoading(true);
    if (!refresh) setResult(null);
    setError('');
    setRetryAfter(0);
    setQuery({ page, search, refresh });
  }

  return (
    <>
      <form className="sales-document-search" onSubmit={event => {
        event.preventDefault();
        load(1, input.trim());
      }}>
        <label>ค้นหาจากชื่อลูกค้าหรือเลขที่เอกสาร
          <input placeholder="เว้นว่างเพื่อดูเอกสารของลูกค้าทั้งหมด" value={input} maxLength={150} onChange={event => setInput(event.target.value)} />
        </label>
        <button type="submit">ค้นหา</button>
        <button type="button" disabled={loading || retryAfter > 0} onClick={() => load(query.page, query.search, true)}>
          {loading && query.refresh ? 'กำลังอัปเดต…' : 'อัปเดตข้อมูล'}
        </button>
        {query.search && <button type="button" onClick={() => {
          setInput('');
          load(1, '');
        }}>แสดงลูกค้าทั้งหมด</button>}
      </form>
      {!result && !error && <p role="status">กำลังโหลดเอกสาร…</p>}
      {error && <div role="alert" className="notice">
        <p>{error}</p>
        {retryAfter > 0
          ? <p>FlowAccount ให้รอ {retryAfter} วินาที โปรดรอสักครู่</p>
          : <button type="button" onClick={() => load(query.page, query.search, query.refresh)}>ลองอีกครั้ง</button>}
      </div>}
      {result && <>
        {result.retryAfter && <p role="status" className="notice">
          แสดงข้อมูลล่าสุดที่โหลดได้เมื่อ {new Date(result.loadedAt).toLocaleString('th-TH', {timeZone: 'Asia/Bangkok'})} · FlowAccount จำกัดคำขอชั่วคราว
        </p>}
        <p className="muted">
          {result.environment === 'test' ? 'Sandbox' : 'Production'} · {query.search ? 'ผลการค้นหา' : 'ลูกค้าทั้งหมด'}
          {result.loadedAt && ` · ดึงข้อมูลล่าสุด ${new Date(result.loadedAt).toLocaleTimeString('th-TH', {timeZone: 'Asia/Bangkok'})}`}
          {result.total != null && ` · ${result.total.toLocaleString('th-TH')} เอกสาร`}
        </p>
        {result.documents.length ? (
          <div className="table-scroll">
            <table>
              <thead><tr>
                <th scope="col">เลขที่เอกสาร</th>
                <th scope="col">ลูกค้า</th>
                <th scope="col">วันที่เอกสาร</th>
                <th scope="col">สถานะ</th>
                <th scope="col">ยอดรวม (บาท)</th>
              </tr></thead>
              <tbody>{result.documents.map(doc => {
                const isOpen = expanded !== null && expanded === doc.id;
                const number = doc.number || doc.id || '—';
                return <React.Fragment key={doc.id ?? doc.number}>
                  <tr>
                    <td>{doc.id ? <button
                      type="button"
                      className="sales-document-link"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'ปิดรายละเอียด' : 'ดูรายละเอียด'} ${number}`}
                      onClick={() => setExpanded(isOpen ? null : doc.id)}
                    >{number}</button> : number}</td>
                    <td>{doc.company || '—'}{doc.customerCode && <div className="muted">{doc.customerCode}</div>}</td>
                    <td>{doc.date?.slice(0, 10) || '—'}</td>
                    <td>{doc.status ?? '—'}</td>
                    <td>{doc.total == null ? '—' : money.format(doc.total)}</td>
                  </tr>
                  {isOpen && <tr><td colSpan={5} className="sales-document-detail">
                    <DocumentDetail api={api} type={type} id={doc.id} number={number} />
                  </td></tr>}
                </React.Fragment>;
              })}</tbody>
            </table>
          </div>
        ) : <p className="empty">ไม่พบเอกสารในหน้านี้</p>}
        <div className="section-title">
          <button type="button" disabled={result.page <= 1} onClick={() => load(result.page - 1)}>หน้าก่อน</button>
          <span>หน้า {result.page}</span>
          <button type="button" disabled={!result.hasNext} onClick={() => load(result.page + 1)}>หน้าถัดไป</button>
        </div>
      </>}
    </>
  );
}

function DocumentDetail({ api, type, id, number }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ type, id });
    api.flowaccount('sales-document?' + params).then(
      data => { if (current) setDetail(data); },
      err => { if (current) setError(err); },
    );
    return () => { current = false; };
  }, [api, type, id, attempt]);

  if (error) return <div className="notice" role="alert">
    <p>{error.message}{error.retryAfter ? ` · โปรดรอประมาณ ${error.retryAfter} วินาที` : ''}</p>
    <button type="button" onClick={() => { setError(null); setAttempt(value => value + 1); }}>ลองอีกครั้ง</button>
  </div>;
  if (!detail) return <p role="status">กำลังโหลดรายละเอียดเอกสาร…</p>;

  return <section aria-label={`รายละเอียด ${number}`}>
    <h3>รายละเอียด {number}</h3>
    <p>เซลส์ / ผู้สร้างเอกสาร <strong>{detail.salesName || 'ไม่ได้ระบุใน FlowAccount'}</strong></p>
    {detail.retryAfter && <p className="notice">กำลังแสดงรายละเอียดที่เคยโหลดไว้</p>}
    {detail.items.length > 0 && <DocumentItems items={detail.items} />}
    {detail.references.map(ref => <section key={ref.number}>
      <h4>สินค้าตามเอกสารอ้างอิง {ref.number}</h4>
      <p>เซลส์ / ผู้สร้างเอกสารอ้างอิง <strong>{ref.salesName || 'ไม่มีข้อมูล'}</strong></p>
      {ref.items.length ? <DocumentItems items={ref.items} /> : <p>ไม่พบรายละเอียดสินค้าในเอกสารอ้างอิงนี้</p>}
    </section>)}
    {!detail.items.length && !detail.references.length && <p>เอกสารนี้ไม่มีรายการสินค้า</p>}
  </section>;
}

function DocumentItems({ items }) {
  return <div className="table-scroll">
    <table>
      <thead><tr>
        <th scope="col">สินค้า / บริการ</th>
        <th scope="col">จำนวน</th>
        <th scope="col">ราคาต่อหน่วย (บาท)</th>
        <th scope="col">ยอดตามเอกสาร (บาท)</th>
      </tr></thead>
      <tbody>{items.map((item, index) => <tr key={index}>
        <td>{item.name}{item.sku && <div className="muted">{item.sku}</div>}</td>
        <td>{item.quantity == null ? '—' : Number(item.quantity).toLocaleString('th-TH', { maximumFractionDigits: 8 })} {item.unit}</td>
        <td>{item.unitPrice == null ? '—' : money.format(item.unitPrice)}</td>
        <td>{item.total == null ? '—' : money.format(item.total)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function SalespersonReport({ api, type }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  function reload() {
    setError('');
    setReport(null);
    setAttempt(value => value + 1);
  }

  useEffect(() => {
    let active = true;
    async function load() {
      const documents = new Map();
      let environment;
      for (let page = 1; active; page += 1) {
        const params = new URLSearchParams({ type, page });
        if (attempt > 0) params.set('refresh', '1');
        const result = await api.flowaccount('sales-documents?' + params);
        if (!active) return;
        environment = result.environment;
        for (const doc of result.documents) {
          if (!Object.prototype.hasOwnProperty.call(doc, 'salesName')) {
            throw new Error('เซิร์ฟเวอร์ FlowAccount ยังไม่รองรับรายงานตามชื่อเซลส์');
          }
          documents.set(String(doc.id ?? doc.number ?? page + ':' + documents.size), doc);
        }
        if (!result.hasNext) break;
      }
      if (!active) return;

      const groups = new Map();
      for (const doc of documents.values()) {
        const name = doc.salesName?.trim().replace(/\s+/g, ' ') || '';
        const key = name.toLocaleLowerCase('th');
        if (!groups.has(key)) groups.set(key, { key, name, docs: [], satang: 0, missingTotals: 0 });
        const group = groups.get(key);
        group.docs.push(doc);
        const amount = Number(doc.total);
        if (doc.total == null || doc.total === '' || !Number.isFinite(amount)) group.missingTotals += 1;
        else group.satang += Math.round(amount * 100);
      }
      setReport({ environment, groups: [...groups.values()].sort((a, b) => b.satang - a.satang) });
    }
    load().catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [api, type, attempt]);

  const match = search.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th');
  const groups = report?.groups.filter(group => (group.name || 'ไม่ระบุชื่อ').toLocaleLowerCase('th').includes(match)) ?? [];
  return <section aria-label="ยอดตามชื่อเซลส์">
    <div className="sales-document-search">
      <label>ค้นหาชื่อเซลส์
        <input type="search" value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }} placeholder="พิมพ์ชื่อหรือบางส่วนของชื่อ" />
      </label>
      <button type="button" disabled={!report && !error} onClick={reload}>
        {!report && !error ? 'กำลังโหลด…' : 'รีเฟรชข้อมูล'}
      </button>
    </div>
    <p className="muted">{report?.environment === 'test' && 'Sandbox · '}รวมยอดสุทธิจากใบเสร็จรับเงินทุกหน้า ตามชื่อเซลส์หรือผู้สร้างที่ระบุใน FlowAccount</p>
    {error && <div className="notice" role="alert">
      <p>{error}</p>
    </div>}
    {!report && !error && <p role="status">กำลังรวมยอดจากเอกสารทุกหน้า…</p>}
    {report && groups.length === 0 && <p>ไม่พบรายการที่ตรงกับชื่อ</p>}
    {groups.map(group => <section key={group.key} className="panel">
      <div className="section-title">
        <div>
          <h3>{group.name || 'ไม่ระบุชื่อ'}</h3>
          <p>{group.docs.length} เอกสาร · <strong>{money.format(group.satang / 100)} บาท</strong></p>
          {group.missingTotals > 0 && <p>ยังไม่มียอดใน {group.missingTotals} เอกสาร</p>}
        </div>
        <button type="button" aria-expanded={selected === group.key} onClick={() => setSelected(selected === group.key ? null : group.key)}>
          {selected === group.key ? 'ซ่อนรายการสินค้า' : 'ดูรายการสินค้า'}
        </button>
      </div>
      {selected === group.key && group.docs.map((doc, index) => <details key={doc.id ?? doc.number ?? index} open={doc.items?.length ? true : undefined}>
        <summary>{doc.number || doc.id || 'เอกสาร'} · {doc.company || '—'} · {doc.total == null ? '—' : money.format(doc.total) + ' บาท'}</summary>
        {doc.items?.length > 0
          ? <DocumentItems items={doc.items} />
          : doc.id ? <OnDemandDocument api={api} type={type} id={doc.id} number={doc.number || doc.id} /> : <p>ไม่มีรายละเอียดสินค้า</p>}
      </details>)}
    </section>)}
  </section>;
}

function OnDemandDocument({ api, type, id, number }) {
  const [opened, setOpened] = useState(false);
  return opened
    ? <DocumentDetail api={api} type={type} id={id} number={number} />
    : <button type="button" onClick={() => setOpened(true)}>โหลดสินค้าในเอกสาร</button>;
}
