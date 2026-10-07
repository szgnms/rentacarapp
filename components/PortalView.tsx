'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from './client/api';
import { ErrorBox } from './client/Modal';
import { useToast } from './client/Toast';
import { Field, Options, SumRow } from './ui';
import { DOC_TYPES } from '@/lib/inspection';
import { dt, money, text } from '@/lib/format';
import type { PortalView as View } from '@/lib/domain/portal';

const STATUS: Record<string, string> = {
  pending: 'Opsiyonlu — ödeme bekleniyor', confirmed: 'Onaylandı', waitlist: 'Bekleme listesinde', converted: 'Teslim edildi', cancelled: 'İptal edildi', no_show: 'Gelinmedi',
  draft: 'Teslim işlemi sürüyor', active: 'Kiralama devam ediyor', returned: 'Araç iade edildi', closed: 'Tamamlandı',
};
const REQ: Record<string, string> = { roadside: 'Yol yardım', extension_request: 'Uzatma talebi' };
const REQ_ST: Record<string, string> = { open: 'Alındı', in_progress: 'İşlemde', done: 'Tamamlandı', cancelled: 'İptal' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card portal-sec">
      <div className="card-head"><h2>{title}</h2></div>
      <div className="card-body">{children}</div>
    </section>
  );
}

export function PortalView({ token, initial }: { token: string; initial: View }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const base = `/api/portal/${token}`;

  const send = (action: string, msg: string) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data: Record<string, unknown> = Object.fromEntries(new FormData(form));
    for (const el of Array.from(form.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))) data[el.name] = el.checked;
    setBusy(action);
    setError(null);
    try {
      setV(await api<View>('POST', `${base}/${action}`, data));
      toast(msg);
      form.reset();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const upload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!(fd.get('file') instanceof File) || !(fd.get('file') as File).size) return setError(new Error('Lütfen bir fotoğraf seçin'));
    setBusy('upload');
    setError(null);
    try {
      const res = await fetch(`${base}/upload`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || 'Yükleme başarısız');
      setV(j);
      toast('Belge yüklendi');
      form.reset();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const c = v.customer;
  const uploaded = new Set(v.documents_uploaded.map((d) => d.doc_type));
  return (
    <div className="portal">
      <header className="portal-head">
        <div className="portal-brand">🚗 {v.company.name}</div>
        <div className="muted small">{v.company.phone}</div>
      </header>
      <main className="portal-main">
        <ErrorBox error={error} />
        <section className="card portal-sec portal-hero">
          <div className="card-body">
            <div className="muted small">{v.kind === 'rental' ? 'Kira sözleşmesi' : 'Rezervasyon'} · {v.code}</div>
            <h1 style={{ margin: '4px 0' }}>Merhaba {c.first_name}</h1>
            <div className="portal-status">{STATUS[v.status] ?? v.status}</div>
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Araç</dt><dd>{v.vehicle ? `${v.vehicle.brand} ${v.vehicle.model} · ${v.vehicle.plate}` : `${v.category} grubu (teslimde atanır)`}</dd>
              <dt>Alış</dt><dd>{dt(v.pickup_at)} · {v.pickup_branch?.name ?? '—'}</dd>
              <dt>Dönüş</dt><dd>{dt(v.return_at)} · {v.return_branch?.name ?? '—'}</dd>
              {v.pickup_branch?.address ? <><dt>Adres</dt><dd>{v.pickup_branch.address}</dd></> : null}
              <dt>Tutar</dt><dd>{money(v.total)} <span className="muted small">· depozito {money(v.deposit)}</span></dd>
            </dl>
          </div>
        </section>

        {v.can_precheckin ? (
          <Section title="✅ Online check-in">
            <p className="muted small">Bilgilerinizi şimdi tamamlayın, teslimde beklemeyin. Kimlik ve ehliyet fotoğraflarını aşağıdan yükleyebilirsiniz.</p>
            <form onSubmit={send('checkin', 'Bilgileriniz kaydedildi')} className="form-grid">
              <Field label="E-posta" className="c6"><input type="email" name="email" defaultValue={c.email ?? ''} /></Field>
              <Field label="Doğum tarihi" className="c6"><input type="date" name="birth_date" defaultValue={c.birth_date ?? ''} /></Field>
              <Field label="Ehliyet no" className="c6"><input name="license_no" defaultValue={c.license_no ?? ''} /></Field>
              <Field label="Ehliyet sınıfı" className="c6"><input name="license_class" defaultValue={c.license_class ?? 'B'} /></Field>
              <Field label="Ehliyet veriliş" className="c6"><input type="date" name="license_date" defaultValue={c.license_date ?? ''} /></Field>
              <Field label="Ehliyet geçerlilik" className="c6"><input type="date" name="license_expiry" defaultValue={c.license_expiry ?? ''} /></Field>
              <Field label="Adres" className="c12"><input name="address" defaultValue={c.address ?? ''} /></Field>
              <label className="check c12"><input type="checkbox" name="kvkk_notice" defaultChecked={v.consents.kvkk_notice} /> KVKK aydınlatma metnini okudum, kişisel verilerimin kiralama hizmeti için işlenmesini anladım. *</label>
              <label className="check c12"><input type="checkbox" name="marketing_email" defaultChecked={v.consents.marketing_email} /> Kampanyalardan e-posta ile haberdar olmak istiyorum</label>
              <label className="check c12"><input type="checkbox" name="marketing_sms" defaultChecked={v.consents.marketing_sms} /> SMS ile haberdar olmak istiyorum</label>
              <div className="c12"><button className="primary big-btn" disabled={busy === 'checkin'} style={{ width: '100%' }}>Kaydet</button></div>
            </form>
          </Section>
        ) : null}

        {v.kind === 'reservation' || v.status === 'draft' || v.status === 'active' ? (
          <Section title="🪪 Kimlik & ehliyet">
            <div className="portal-docs">
              {(['license_front', 'license_back', 'id_front', 'passport'] as const).map((k) => (
                <span key={k} className={`badge ${uploaded.has(k) ? 'ok' : ''}`}>{uploaded.has(k) ? '✓ ' : ''}{DOC_TYPES[k]}</span>
              ))}
            </div>
            <form onSubmit={upload} className="form-grid" style={{ marginTop: 10 }}>
              <Field label="Belge" className="c6"><select name="doc_type"><Options list={Object.entries(DOC_TYPES)} /></select></Field>
              <Field label="Fotoğraf" className="c6"><input type="file" name="file" accept="image/*,application/pdf" capture="environment" /></Field>
              <div className="c12"><button disabled={busy === 'upload'} style={{ width: '100%' }}>Yükle</button></div>
            </form>
          </Section>
        ) : null}

        {v.finance ? (
          <Section title="💳 Hesap özeti">
            {v.charges.map((ch) => <SumRow key={ch.id} label={`${text('chargeType', ch.type)}${ch.description ? ` · ${ch.description}` : ''}`} value={money(ch.amount)} />)}
            <SumRow label="Toplam" value={money(v.total)} total />
            <SumRow label="Ödenen" value={money(v.finance.paid)} />
            <SumRow label={v.finance.balance < 0 ? 'Size iade edilecek' : 'Kalan borç'} value={money(Math.abs(v.finance.balance))} />
            {v.finance.deposit_held ? <SumRow label="Tutulan depozito / provizyon" value={money(v.finance.deposit_held)} /> : null}
          </Section>
        ) : null}

        {v.files.length || v.invoices.length ? (
          <Section title="📄 Belgelerim">
            <ul className="plain-list">
              {v.files.map((f) => (
                <li key={f.id}><a href={`${base}/files/${f.id}`} target="_blank" rel="noreferrer">📄 {f.doc === 'settlement' ? 'İade / hesap özeti' : f.doc === 'contract' ? 'Kira sözleşmesi' : f.name}</a> <span className="muted small">{dt(f.created_at.replace(' ', 'T'))}</span></li>
              ))}
              {v.invoices.map((i) => (
                <li key={i.id}>{i.pdf_file_id ? <a href={`${base}/files/${i.pdf_file_id}`} target="_blank" rel="noreferrer">🧾 Fatura {i.invoice_no}</a> : <>🧾 Fatura {i.invoice_no}</>} <span className="muted small">{money(i.total)}</span></li>
              ))}
            </ul>
          </Section>
        ) : null}

        {v.status === 'active' ? (
          <>
            <Section title="🆘 Yol yardım">
              <form onSubmit={send('roadside', 'Talebiniz alındı, sizi arayacağız')} className="form-grid">
                <Field label="Sorun" className="c12"><textarea name="note" required placeholder="Örn: lastik patladı / akü bitti / kaza" /></Field>
                <Field label="Konum" className="c6"><input name="location" placeholder="Adres veya konum" /></Field>
                <Field label="Telefon" className="c6"><input name="phone" defaultValue={c.phone} /></Field>
                <div className="c12"><button className="danger big-btn" disabled={busy === 'roadside'} style={{ width: '100%' }}>Yardım iste</button></div>
              </form>
              <div className="muted small">Acil durumlarda: {v.company.phone}</div>
            </Section>
            <Section title="⏱ Süre uzatma talebi">
              <form onSubmit={send('extension_request', 'Uzatma talebiniz alındı')} className="form-grid">
                <Field label="Yeni dönüş" className="c6"><input type="datetime-local" name="return_at" required /></Field>
                <Field label="Not" className="c6"><input name="note" /></Field>
                <div className="c12"><button className="primary" disabled={busy === 'extension_request'} style={{ width: '100%' }}>Talep gönder</button></div>
              </form>
            </Section>
          </>
        ) : null}

        {v.open_requests.length ? (
          <Section title="Taleplerim">
            <ul className="plain-list">
              {v.open_requests.map((r) => <li key={r.id}>{REQ[r.type] ?? r.type} · {REQ_ST[r.status] ?? r.status} <span className="muted small">{dt(r.created_at.replace(' ', 'T'))}</span></li>)}
            </ul>
          </Section>
        ) : null}

        {(v.status === 'returned' || v.status === 'closed') && !v.nps_done ? (
          <Section title="⭐ Bizi değerlendirin">
            <form onSubmit={send('nps', 'Teşekkür ederiz!')}>
              <p className="small">Bizi bir arkadaşınıza önerme olasılığınız nedir? (0–10)</p>
              <div className="nps-row">
                {Array.from({ length: 11 }, (_, i) => (
                  <label key={i} className="nps-opt"><input type="radio" name="score" value={i} required /><span>{i}</span></label>
                ))}
              </div>
              <Field label="Yorum"><textarea name="comment" /></Field>
              <button className="primary" disabled={busy === 'nps'} style={{ width: '100%', marginTop: 8 }}>Gönder</button>
            </form>
          </Section>
        ) : null}
        {v.nps_done ? <div className="muted small center">Değerlendirmeniz için teşekkürler.</div> : null}
      </main>
    </div>
  );
}
