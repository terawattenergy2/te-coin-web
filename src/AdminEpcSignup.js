import { useState } from 'react';
import AdminCustomerDirectory from './AdminCustomerDirectory';
import CustomerPurchaseSummary from './CustomerPurchaseSummary';

export default function AdminEpcSignup({ api, onCreated }) {
  const [tax, setTax] = useState('');
  const [companies, setCompanies] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  function reset() {
    setCompanies([]);
    setSelected(null);
    setMessage('');
    setError(false);
  }

  async function findCompany(event) {
    event.preventDefault();
    await selectCompany(tax);
  }

  async function selectCompany(taxId, contactId) {
    if (busy || !/^\d{13}$/.test(taxId)) return;
    setTax(taxId);
    reset();
    setBusy(true);
    try {
      const result = await api.adminLookupCompany(taxId, contactId);
      setCompanies(result.companies);
      if (result.companies.length === 1) setSelected(result.companies[0]);
      if (!result.companies.length) setMessage('ไม่พบลูกค้าใน FlowAccount ที่มีเลขผู้เสียภาษีนี้');
    } catch (err) {
      setError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    if (busy || !selected) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const email = String(fields.get('email')).trim();
    const password = String(fields.get('password'));
    const phone = String(fields.get('phone')).trim();
    if (!phone || password.length < 8) {
      setError(true);
      setMessage('กรุณากรอกเบอร์ติดต่อและใช้รหัสผ่านอย่างน้อย 8 ตัวอักษร');
      return;
    }
    setBusy(true);
    setError(false);
    setMessage('');
    try {
      const result = await api.signup(email, password, selected.name, {
        epc_tax_id: tax, epc_branch_code: selected.branch, epc_phone: phone,
      });
      const user = result.user || result;
      if (!user?.id || user.identities?.length === 0) {
        throw new Error('ไม่พบการสมัครใหม่ อีเมลนี้อาจมีบัญชี TeraCoin อยู่แล้ว');
      }
      form.reset();
      setSelected(null);
      setCompanies([]);
      setMessage(result.access_token
        ? 'สร้างคำขอ EPC แล้ว ตรวจผู้สมัครในรายการคำขอก่อนอนุมัติ'
        : 'ส่งคำขอเปิดบัญชีแล้ว ให้ลูกค้ายืนยันอีเมล แล้วตรวจคำขอก่อนอนุมัติ');
      await onCreated?.();
    } catch (err) {
      setError(true);
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="epc-admin-signup-title">
      <h2 id="epc-admin-signup-title">ค้นหาลูกค้าและเปิดบัญชี TeraCoin</h2>
      <p className="muted">ใช้สำหรับลูกค้า Tier 2, EPC และ End User หลังตรวจและผูกบัญชีแล้ว ให้ตั้งระดับราคาในรายการผู้ใช้งาน</p>
      <AdminCustomerDirectory api={api} disabled={busy} onSelect={company => selectCompany(company.tax, company.id)} />
      <form onSubmit={findCompany}>
        <label>
          เลขผู้เสียภาษีลูกค้า (13 หลัก)
          <input value={tax} inputMode="numeric" pattern="[0-9]{13}" maxLength={13}
            required disabled={busy} onChange={event => { setTax(event.target.value.replace(/\D/g, '')); reset(); }} />
        </label>
        <div><button disabled={busy || tax.length !== 13}>ค้นหาลูกค้าใน FlowAccount</button></div>
      </form>
      {companies.length > 1 && (
        <label>
          เลือกบริษัทและสาขา
          <select value={selected ? companies.indexOf(selected) : ''} disabled={busy}
            onChange={event => setSelected(companies[Number(event.target.value)])}>
            <option value="" disabled>เลือกบริษัท / สาขา</option>
            {companies.map((company, index) => (
              <option key={index} value={index}>{company.name} · สาขา {company.branch} · รหัส {company.code}</option>
            ))}
          </select>
        </label>
      )}
      {selected && (
        <div key={companies.indexOf(selected)}>
          <p><strong>{selected.name}</strong> · สาขา {selected.branch}{selected.code && ' · รหัส ' + selected.code}</p>
          <CustomerPurchaseSummary api={api} tax={tax} branch={selected.branch} code={selected.code} />
          <form onSubmit={createAccount}>
          <label>อีเมลลูกค้า<input type="email" name="email" autoComplete="off" required disabled={busy} /></label>
          <label>รหัสผ่าน<input type="password" name="password" autoComplete="new-password" minLength={8} required disabled={busy} /></label>
          <label>เบอร์ติดต่อ<input type="tel" name="phone" maxLength={40} required defaultValue={selected.phone} disabled={busy} /></label>
          <p className="muted">การเปิดบัญชีจะสร้างคำขอ EPC ให้ตรวจสอบก่อนอนุมัติสิทธิ์ดูใบเสร็จของบริษัท</p>
          <div><button disabled={busy}>เปิดบัญชีลูกค้า TeraCoin</button></div>
          </form>
        </div>
      )}
      {busy && <p role="status">กำลังดำเนินการ…</p>}
      {message && <p className="notice" role={error ? 'alert' : 'status'}>{message}</p>}
    </section>
  );
}
