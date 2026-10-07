'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from './client/api';
import { ErrorBox } from './client/Modal';
import { useToast } from './client/Toast';
import { CustomerButton } from './dialogs/forms';
import { DamageDiagram, FuelInput, PhotoGrid, SignaturePad } from './inspection';
import { Field, Options, SumRow, Tag } from './ui';
import { CLEANLINESS_LABELS, DOC_TYPES, LANGUAGES } from '@/lib/inspection';
import { DEPOSIT_METHODS, PAY_METHODS, customerName, d, dt, money, numf } from '@/lib/format';
import type { RentalDetail } from '@/lib/domain/agreements';
import type { StoredFile } from '@/lib/files';

interface Props {
  initial: RentalDetail;
  equipment: string[];
  vehicles: { id: number; label: string; category: string; km: number }[];
  drivers: { id: number; first_name: string; last_name: string; license_no: string | null }[];
  documents: StoredFile[];
  staffName: string;
}

const STEPS = [
  ['customer', '1. Müşteri & belgeler'],
  ['vehicle', '2. Araç'],
  ['photos', '3. Fotoğraflar'],
  ['damage', '4. Hasar şeması'],
  ['equipment', '5. Ekipman · km · yakıt'],
  ['summary', '6. Ücret & sözleşme'],
  ['sign', '7. İmzalar'],
  ['payment', '8. Provizyon & teslim'],
] as const;
type Step = (typeof STEPS)[number][0];

export function CheckoutWizard({ initial, equipment, vehicles, drivers, documents: initialDocs, staffName }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [r, setR] = useState(initial);
  const [docs, setDocs] = useState(initialDocs);
  const [step, setStep] = useState<Step>('customer');
  const [plateOk, setPlateOk] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const s = r.checkout!;

  const reload = useCallback(async () => {
    setR(await api<RentalDetail>('GET', `/api/rentals/${r.id}`));
  }, [r.id]);

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setError(null);
    try {
      await fn();
      await reload();
      if (msg) toast(msg);
    } catch (e) {
      setError(e);
      toast((e as Error).message, 'error');
    }
  };

  const done: Record<Step, boolean> = {
    customer: r.customer_issues.length === 0,
    vehicle: plateOk,
    photos: s.missing_angles.length === 0,
    damage: true,
    equipment: s.km !== null && s.fuel !== null && s.checklist.length > 0,
    summary: true,
    sign: r.sig_valid.checkout.customer && r.sig_valid.checkout.staff,
    payment: false,
  };
  const idx = STEPS.findIndex(([k]) => k === step);
  const signBlock = s.missing_angles.length
    ? `Zorunlu ${s.missing_angles.length} fotoğraf eksik — sözleşme imzaya açılmaz.`
    : s.km === null || s.fuel === null
      ? 'Önce km ve yakıt bilgisini kaydedin.'
      : null;

  const uploadDoc = async (docType: string, file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('entity', 'customer');
    fd.append('entity_id', String(r.customer_id));
    fd.append('kind', 'document');
    fd.append('meta', JSON.stringify({ doc_type: docType, source: 'checkout', rental_id: r.id }));
    const res = await fetch('/api/files', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) return toast(data.error || 'Yüklenemedi', 'error');
    setDocs((x) => [...x, data]);
    toast('Belge yüklendi');
  };

  const scanPlate = async (file: File | undefined) => {
    if (!file) return;
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (s: ImageBitmap) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!BD) return toast('Bu cihaz QR okumayı desteklemiyor; plakayı elle girin', 'error');
    const codes = await new BD({ formats: ['qr_code', 'code_128'] }).detect(await createImageBitmap(file));
    const val = codes[0]?.rawValue ?? '';
    const ok = val.replace(/\s/g, '').toUpperCase().includes(r.plate.replace(/\s/g, '').toUpperCase());
    setPlateOk(ok);
    toast(ok ? 'Araç doğrulandı' : `Okunan kod (${val || 'yok'}) bu araçla eşleşmiyor`, ok ? '' : 'error');
  };

  const [km, setKm] = useState(String(s.km ?? r.vehicle.current_km));
  const [fuel, setFuel] = useState(s.fuel ?? 8);
  const [clean, setClean] = useState(s.cleanliness ?? 'clean');
  const present = new Set(s.checklist.filter((c) => c.present).map((c) => c.item));

  return (
    <div>
      <div className="wizard-steps">
        {STEPS.map(([k, label]) => (
          <button key={k} type="button" className={`${k === step ? 'active' : ''} ${done[k] ? 'ok' : ''}`} onClick={() => setStep(k)}>{label}</button>
        ))}
      </div>
      <ErrorBox error={error} />

      {step === 'customer' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>{customerName(r.customer)}</h2><CustomerButton customer={r.customer} className="sm" onSaved={reload}>Düzenle</CustomerButton></div>
            <div className="card-body">
              {r.customer_issues.length ? (
                <div className="alert danger">Teslimden önce tamamlanmalı:<ul>{r.customer_issues.map((i) => <li key={i}>{i}</li>)}</ul></div>
              ) : <div className="alert ok">Kimlik, yaş ve ehliyet kontrolleri tamam.</div>}
              {r.customer_warnings.map((w) => <div key={w} className="alert warn">{w}</div>)}
              <dl className="kv">
                <dt>T.C. / Pasaport</dt><dd>{r.customer.national_id || r.customer.passport_no || '—'}</dd>
                <dt>Ehliyet</dt><dd>{r.customer.license_no ?? '—'} · {r.customer.license_class ?? ''} · {d(r.customer.license_date)}</dd>
                <dt>Ehliyet geçerlilik</dt><dd>{d(r.customer.license_expiry)}</dd>
                <dt>Doğum tarihi</dt><dd>{d(r.customer.birth_date)}</dd>
                <dt>Telefon</dt><dd>{r.customer.phone}</dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Belgeler</h2></div>
            <div className="card-body">
              <div className="muted small mb">Kimlik ve ehliyetin ön/arka fotoğrafını çekin (KVKK kapsamında şifreli arşivlenir, erişimler loglanır).</div>
              <div className="check-grid">
                {(['id_front', 'id_back', 'license_front', 'license_back', 'passport'] as const).map((t) => {
                  const have = docs.find((x) => JSON.parse(x.meta || '{}').doc_type === t);
                  return (
                    <label key={t} className={have ? '' : 'missing'} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <span>{have ? '✓ ' : ''}{DOC_TYPES[t]}</span>
                      {have ? <a href={`/api/files/${have.id}`} target="_blank" rel="noreferrer" className="small">Görüntüle</a> : null}
                      <span className="btn sm">📷 {have ? 'Yenile' : 'Çek / yükle'}<input type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => uploadDoc(t, e.target.files?.[0])} /></span>
                    </label>
                  );
                })}
              </div>
              <div className="form-section" style={{ marginTop: 14 }}>Ek sürücüler</div>
              {drivers.length ? (
                drivers.map((dr) => (
                  <label key={dr.id} className="check">
                    <input
                      type="checkbox"
                      checked={r.drivers.some((x) => x.id === dr.id)}
                      onChange={(e) => {
                        const ids = new Set(r.drivers.map((x) => x.id));
                        if (e.target.checked) ids.add(dr.id);
                        else ids.delete(dr.id);
                        run(() => api('PATCH', `/api/rentals/${r.id}`, { driver_ids: [...ids] }));
                      }}
                    />
                    {dr.first_name} {dr.last_name} <span className="muted small">{dr.license_no}</span>
                  </label>
                ))
              ) : <div className="muted small">Müşteri kartında kayıtlı ek sürücü yok (müşteri sayfasından eklenebilir).</div>}
              <div className="form-grid" style={{ marginTop: 10 }}>
                <Field label="Sözleşme dili">
                  <select value={r.language} onChange={(e) => run(() => api('PATCH', `/api/rentals/${r.id}`, { language: e.target.value }), 'Dil güncellendi')}>
                    <Options list={Object.entries(LANGUAGES)} />
                  </select>
                </Field>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'vehicle' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>{r.plate} · {r.brand} {r.model}</h2><Tag tone={plateOk ? 'ok' : 'warn'}>{plateOk ? 'Doğrulandı' : 'Doğrulanmadı'}</Tag></div>
            <div className="card-body">
              <dl className="kv mb">
                <dt>Grup</dt><dd>{r.category}{r.vehicle.acriss ? ` · ${r.vehicle.acriss}` : ''}</dd>
                <dt>Güncel km</dt><dd>{numf(r.vehicle.current_km)}</dd>
                <dt>Otopark yeri</dt><dd>{r.vehicle.parking_spot ?? '—'}</dd>
                <dt>HGS etiketi</dt><dd>{r.vehicle.hgs_tag_no ?? '—'}</dd>
              </dl>
              <Field label="Plakayı doğrulayın (anahtar etiketi / QR)">
                <input placeholder={r.plate} onChange={(e) => setPlateOk(e.target.value.replace(/\s/g, '').toUpperCase() === r.plate.replace(/\s/g, '').toUpperCase())} />
              </Field>
              <label className="btn sm" style={{ marginTop: 8 }}>📷 QR / barkod okut<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => scanPlate(e.target.files?.[0])} /></label>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Araç değişimi / upgrade</h2></div>
            <div className="card-body">
              <div className="muted small mb">Rezerve edilen grup yoksa üst gruptan araç verilebilir; fiyat değişmez. Araç değişince çıkış fotoğrafları yeniden çekilir.</div>
              <select
                defaultValue=""
                onChange={(e) => e.target.value && run(() => api('PATCH', `/api/rentals/${r.id}`, { vehicle_id: Number(e.target.value) }), 'Araç değiştirildi')}
              >
                <option value="">Araç seçin…</option>
                {vehicles.filter((v) => v.id !== r.vehicle_id).map((v) => <option key={v.id} value={v.id}>{v.label} · {v.category}{v.category !== r.category ? ' (upgrade)' : ''}</option>)}
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'photos' ? (
        <div className="card">
          <div className="card-head">
            <h2>Rehberli fotoğraf çekimi</h2>
            <span className="muted small">{s.missing_angles.length ? `${s.missing_angles.length} zorunlu kare eksik` : 'Tüm zorunlu kareler tamam'}</span>
          </div>
          <div className="card-body">
            <div className="muted small mb">Her fotoğraf zaman damgası, konum, cihaz ve personel bilgisiyle SHA-256 özetli değiştirilemez arşive kaydedilir.</div>
            <PhotoGrid sessionId={s.id} photos={s.photos} onChange={reload} />
          </div>
        </div>
      ) : null}

      {step === 'damage' ? (
        <div className="card">
          <div className="card-head"><h2>Hasar şeması</h2></div>
          <div className="card-body">
            <DamageDiagram
              sessionId={s.id}
              marks={s.marks}
              ghostMarks={r.previous_damages.filter((x) => x.mark_x !== null).map((x) => ({ x: x.mark_x!, y: x.mark_y!, label: x.description }))}
              onChange={reload}
            />
            {r.previous_damages.length ? (
              <div className="alert info" style={{ marginTop: 12 }}>
                Araçta açık hasar kayıtları: {r.previous_damages.map((x) => x.description).join(', ')}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 'equipment' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Ekipman / aksesuar</h2></div>
            <div className="card-body check-grid">
              {equipment.map((item) => (
                <label key={item}>
                  <input type="checkbox" checked={present.has(item)} onChange={(e) => run(() => api('PATCH', `/api/inspections/${s.id}`, { checklist: { [item]: e.target.checked } }))} />
                  {item}
                </label>
              ))}
              {!s.checklist.length ? (
                <button type="button" className="sm" onClick={() => run(() => api('PATCH', `/api/inspections/${s.id}`, { checklist: Object.fromEntries(equipment.map((i) => [i, true])) }))}>
                  Tümü tam
                </button>
              ) : null}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Km · yakıt · temizlik</h2></div>
            <div className="card-body form-grid">
              <Field label={`Çıkış km (en az ${numf(r.vehicle.current_km)})`} className="c12"><input type="number" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
              <div className="c12"><div className="muted small mb">Yakıt seviyesi</div><FuelInput value={fuel} onChange={setFuel} /></div>
              <Field label="Temizlik durumu" className="c12">
                <select value={clean} onChange={(e) => setClean(e.target.value)}><Options list={Object.entries(CLEANLINESS_LABELS).slice(0, 2)} /></select>
              </Field>
              <div className="c12">
                <button type="button" className="primary" onClick={() => run(() => api('PATCH', `/api/inspections/${s.id}`, { km, fuel, cleanliness: clean }), 'Kaydedildi')}>Kaydet</button>
                {s.km !== null ? <span className="muted small" style={{ marginLeft: 10 }}>Kayıtlı: {numf(s.km)} km · {s.fuel}/8</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'summary' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Ücret özeti</h2></div>
            <div className="card-body">
              <SumRow label={`${r.days} gün × ${money(r.daily_rate)}`} value={money(r.base_amount)} />
              {r.long_term_discount ? <SumRow label="Uzun dönem indirimi" value={`-${money(r.long_term_discount)}`} /> : null}
              {r.channel_markup ? <SumRow label="Kanal fiyat farkı" value={money(r.channel_markup)} /> : null}
              {r.extras.map((x) => <SumRow key={x.extra_id} label={x.name} value={money(x.amount)} />)}
              {r.one_way_fee ? <SumRow label="Tek yön" value={money(r.one_way_fee)} /> : null}
              {r.young_driver_fee ? <SumRow label="Genç sürücü" value={money(r.young_driver_fee)} /> : null}
              {r.coupon_discount ? <SumRow label="Kupon" value={`-${money(r.coupon_discount)}`} /> : null}
              {r.discount ? <SumRow label="İndirim" value={`-${money(r.discount)}`} /> : null}
              <SumRow total label="Toplam (KDV dahil)" value={money(r.total_amount)} />
              <SumRow label="Ön ödeme / ödenen" value={money(r.finance.paid)} />
              <SumRow label="Depozito / provizyon" value={money(r.deposit_amount)} />
              <div className="muted small">Dönüş: {dt(r.planned_return_at)} · {r.return_branch_name ?? ''}</div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Sözleşme önizleme</h2><a className="btn sm" href={`/rentals/${r.id}/contract`} target="_blank" rel="noreferrer">Tam metni aç</a></div>
            <div className="card-body">
              <p className="muted small">Müşteriye sözleşmeyi tablet ekranında gösterin. İmzalanan PDF, fotoğraflar ve hasar şemasıyla birlikte üretilir ve e-posta/SMS/WhatsApp ile gönderilir.</p>
              <Field label="Teslim notları (mevcut durum, aksesuar vb.)">
                <textarea defaultValue={r.checkout_notes ?? ''} onBlur={(e) => run(() => api('PATCH', `/api/rentals/${r.id}`, { checkout_notes: e.target.value }))} />
              </Field>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'sign' ? (
        <div className="grid grid-2">
          <SignaturePad
            title="Müşteri imzası"
            signerName={customerName(r.customer)}
            signed={r.sig_valid.checkout.customer}
            disabled={signBlock}
            onSave={async (img, name, strokes, ms) => {
              await api('POST', `/api/rentals/${r.id}/sign`, { purpose: 'checkout', signer_type: 'customer', signer_name: name, image: img, stroke_count: strokes, duration_ms: ms });
              await reload();
              toast('Müşteri imzası kaydedildi');
            }}
          />
          <SignaturePad
            title="Personel imzası"
            signerName={staffName}
            signed={r.sig_valid.checkout.staff}
            disabled={signBlock}
            onSave={async (img, name, strokes, ms) => {
              await api('POST', `/api/rentals/${r.id}/sign`, { purpose: 'checkout', signer_type: 'staff', signer_name: name, image: img, stroke_count: strokes, duration_ms: ms });
              await reload();
              toast('Personel imzası kaydedildi');
            }}
          />
          <div className="muted small c12" style={{ gridColumn: '1 / -1' }}>
            İmza; belge içeriğinin SHA-256 özeti, zaman, IP ve cihaz bilgisiyle saklanır. İmzadan sonra fotoğraf, km/yakıt veya hasar bilgisi değişirse imzalar geçersiz olur ve yeniden alınmalıdır.
          </div>
        </div>
      ) : null}

      {step === 'payment' ? (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            const body = Object.fromEntries(new FormData(e.currentTarget));
            setError(null);
            try {
              await api('POST', `/api/rentals/${r.id}/activate`, body);
              toast('Teslim tamamlandı · sözleşme PDF üretildi ve gönderildi');
              router.push(`/rentals/${r.id}`);
              router.refresh();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <div className="card-head"><h2>Provizyon / depozito ve tahsilat</h2></div>
          <div className="card-body form-grid">
            <Field label="Depozito / provizyon tutarı (₺)" className="c3"><input type="number" step="0.01" name="deposit_collected" defaultValue={r.deposit_amount} /></Field>
            <Field label="Yöntem" className="c3"><select name="deposit_method" defaultValue="preauth"><Options list={DEPOSIT_METHODS} /></select></Field>
            <Field label="Provizyon / POS referansı" className="c6"><input name="deposit_reference" placeholder="Onay kodu" /></Field>
            <Field label={`Tahsilat (₺) · kalan ${money(Math.max(0, r.finance.balance))}`} className="c3">
              <input type="number" step="0.01" name="payment_amount" defaultValue={Math.max(0, r.finance.balance) || ''} />
            </Field>
            <Field label="Yöntem" className="c3"><select name="payment_method" defaultValue="pos"><Options list={PAY_METHODS} /></select></Field>
            <Field label="Taksit" className="c3"><input type="number" name="installments" min={1} max={12} placeholder="Tek çekim" /></Field>
            <Field label="Referans" className="c3"><input name="payment_reference" /></Field>
            <div className="c12">
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                <li className={done.customer ? 'ok-text' : 'danger-text'}>Müşteri doğrulaması {done.customer ? 'tamam' : 'eksik'}</li>
                <li className={done.photos ? 'ok-text' : 'danger-text'}>Zorunlu fotoğraflar {done.photos ? 'tamam' : `eksik (${s.missing_angles.length})`}</li>
                <li className={done.equipment ? 'ok-text' : 'danger-text'}>Km/yakıt/ekipman {done.equipment ? 'kaydedildi' : 'eksik'}</li>
                <li className={done.sign ? 'ok-text' : 'danger-text'}>Müşteri + personel imzası {done.sign ? 'geçerli' : 'eksik/geçersiz'}</li>
              </ul>
            </div>
          </div>
          <div className="modal-foot">
            <Link className="btn" href={`/rentals/${r.id}`}>Sözleşmeye dön</Link>
            <button type="submit" className="success big-btn" disabled={!done.photos || !done.sign || !done.customer}>🔑 Teslimi tamamla</button>
          </div>
        </form>
      ) : null}

      <div className="wizard-nav">
        <button type="button" disabled={idx === 0} onClick={() => setStep(STEPS[idx - 1][0])}>← Geri</button>
        {idx < STEPS.length - 1 ? <button type="button" className="primary" onClick={() => setStep(STEPS[idx + 1][0])}>İleri →</button> : <span />}
      </div>
    </div>
  );
}
