import { useState } from 'react';

export default function AdminTeamSignup({ api, onCreated }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function create(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const name = String(fields.get('name')).trim();
    const email = String(fields.get('email')).trim();
    const password = String(fields.get('password'));
    if (!name || password.length < 8) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.signup(email, password, name);
      const user = result.user || result;
      if (!user?.id || user.identities?.length === 0) {
        throw new Error('ไม่พบการสมัครใหม่ อีเมลนี้อาจมีบัญชี TeraCoin อยู่แล้ว');
      }
      form.reset();
      setMessage({
        text: 'สร้างบัญชีทีมแล้ว เมื่อเจ้าของบัญชียืนยันอีเมล ให้เลือก admin ในช่องสิทธิ์การใช้งานของบัญชีนี้',
      });
      await onCreated();
    } catch (error) {
      setMessage({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="team-signup-title">
      <h2 id="team-signup-title">เพิ่มผู้ดูแลระบบ</h2>
      <p>ถ้าทีมงานมีบัญชี TeraCoin อยู่แล้ว ให้เลือกสิทธิ์ admin ในรายการผู้ใช้งานด้านล่างได้เลย</p>
      <details>
        <summary>สร้างบัญชีทีมใหม่</summary>
        <form onSubmit={create}>
          <label>ชื่อทีมงาน<input name="name" required maxLength={200} disabled={busy} /></label>
          <label>อีเมลทีมงาน<input name="email" type="email" autoComplete="off" required disabled={busy} /></label>
          <label>รหัสผ่าน<input name="password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} /></label>
          <div><button disabled={busy}>{busy ? 'กำลังสร้างบัญชี…' : 'สร้างบัญชีทีม'}</button></div>
        </form>
      </details>
      {message && <p className="notice" role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </section>
  );
}
