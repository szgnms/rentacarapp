'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from './client/api';
import { ErrorBox } from './client/Modal';
import { useToast } from './client/Toast';
import { DamageDiagram, FuelInput, PhotoGrid, SignaturePad } from './inspection';
import { Field, Options, SumRow } from './ui';
import { CLEANLINESS_LABELS, DAMAGE_TYPES } from '@/lib/inspection';
import { FUEL, PAY_METHODS, customerName, dt, localInput, money, numf, text, textOptions } from '@/lib/format';
import type { RentalDetail } from '@/lib/domain/agreements';
import type { CheckinCalc } from '@/lib/rules';
import type { Branch } from '@/lib/types';

interface Props {
  initial: RentalDetail;
  equipment: string[];
  branches: Branch[];
  canApprove: boolean;
  holdDays: string;
}

const STEPS = [
  ['photos', '1. Fotoğraf karşılaştırma'],
  ['damage', '2. Hasar tespiti'],
  ['equipment', '3. Ekipman · km · yakıt'],
  ['settle', '4. Hesap özeti'],
  ['sign', '5. Müşteri imzası'],
  ['pay', '6. Tahsilat & depozito'],
] as const;
type Step = (typeof STEPS)[number][0];
type Row = { key: string; type: string; description: string; amount: string };

export function CheckinWizard({ initial, equipment, branches, canApprove, holdDays }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [r, setR] = useState(initial);
  const [step, setStep] = useState<Step>('photos');
  const [error, setError] = useState<unknown>(null);
  const s = r.checkin!;
  const out = r.checkout;

  const reload = useCallback(async () => setR(await api<RentalDetail>('GET', `/api/rentals/${r.id}`)), [r.id]);
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

  // Hesap girdileri
  const [returnAt, setReturnAt] = useState(localInput());
  const [returnBranch, setReturnBranch] = useState(String(r.return_branch_id ?? ''));
  const [markCharges, setMarkCharges] = useState<Record<number, { customer_charge: string; repair_cost: string }>>({});
  const [extra, setExtra] = useState<Row[]>([]);
  const [waive, setWaive] = useState({ waive_late: false, waive_km: false, waive_fuel: false, waive_cleaning: false });
  const [preview, setPreview] = useState<CheckinCalc | null>(null);
  const [previewErr, setPreviewErr] = useState<unknown>(null);

  const body = () => ({
    actual_return_at: returnAt,
    return_branch_id: returnBranch,
    damages: s.marks.map((m) => ({ mark_id: m.id, customer_charge: markCharges[m.id]?.customer_charge ?? '', repair_cost: markCharges[m.id]?.repair_cost ?? '' })),
    extra_charges: extra.map(({ type, description, amount }) => ({ type, description, amount })),
    ...(canApprove ? waive : {}),
  });
  const bodyKey = JSON.stringify(body());

  useEffect(() => {
    if (s.km === null) return setPreview(null);
    const t = setTimeout(() => {
      api<CheckinCalc>('POST', `/api/rentals/${r.id}/checkin-preview`, JSON.parse(bodyKey))
        .then((p) => (setPreview(p), setPreviewErr(null)))
        .catch((e) => (setPreview(null), setPreviewErr(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [bodyKey, r.id, s.km, s.fuel, s.cleanliness, s.checklist.length, s.marks.length]);

  const [km, setKm] = useState(String(s.km ?? ''));
  const [fuel, setFuel] = useState(s.fuel ?? r.start_fuel);
  const [clean, setClean] = useState(s.cleanliness ?? 'normal');
  const outPresent = new Set((out?.checklist ?? []).filter((c) => c.present).map((c) => c.item));
  const nowPresent = new Set(s.checklist.filter((c) => c.present).map((c) => c.item));

  const done: Record<Step, boolean> = {
    photos: s.missing_angles.length === 0,
    damage: true,
    equipment: s.km !== null && s.checklist.length > 0,
    settle: !!preview,
    sign: r.sig_valid.checkin.customer,
    pay: false,
  };
  const idx = STEPS.findIndex(([k]) => k === step);

  return (
    <div>
      <div className="wizard-steps">
        {STEPS.map(([k, label]) => (
          <button key={k} type="button" className={`${k === step ? 'active' : ''} ${done[k] ? 'ok' : ''}`} onClick={() => setStep(k)}>{label}</button>
        ))}
      </div>
      <ErrorBox error={error} />

      {step === 'photos' ? (
        <div className="card">
          <div className="card-head">
            <h2>Çıkış ↔ dönüş fotoğrafları</h2>
            <span className="muted small">{s.missing_angles.length ? `${s.missing_angles.length} zorunlu kare eksik` : 'Tüm kareler tamam'}</span>
          </div>
          <div className="card-body">
            <div className="muted small mb">Aynı açılardan çekin; karşılaştırmak için fotoğrafa dokunun.</div>
            <PhotoGrid sessionId={s.id} photos={s.photos} compare={out?.photos ?? []} onChange={reload} />
          </div>
        </div>
      ) : null}

      {step === 'damage' ? (
        <div className="card">
          <div className="card-head"><h2>Yeni hasar tespiti</h2></div>
          <div className="card-body">
            <DamageDiagram
              sessionId={s.id}
              marks={s.marks}
              ghostMarks={[
                ...(out?.marks ?? []).map((m) => ({ x: m.x, y: m.y, label: `Çıkışta mevcut: ${DAMAGE_TYPES[m.type as keyof typeof DAMAGE_TYPES] ?? m.type}` })),
                ...r.previous_damages.filter((x) => x.mark_x !== null).map((x) => ({ x: x.mark_x!, y: x.mark_y!, label: x.description })),
              ]}
              onChange={reload}
            />
            {s.marks.length ? (
              <div className="table-wrap" style={{ marginTop: 14 }}>
                <table>
                  <thead><tr><th>#</th><th>Hasar</th><th className="num">Onarım maliyeti (₺)</th><th className="num">Müşteriye yansıyan (₺)</th></tr></thead>
                  <tbody>
                    {s.marks.map((m, i) => (
                      <tr key={m.id}>
                        <td>{i + 1}</td>
                        <td>{DAMAGE_TYPES[m.type as keyof typeof DAMAGE_TYPES] ?? m.type} <span className="muted small">{m.note}</span></td>
                        <td className="num"><input type="number" step="0.01" style={{ width: 120 }} value={markCharges[m.id]?.repair_cost ?? ''} onChange={(e) => setMarkCharges((x) => ({ ...x, [m.id]: { customer_charge: x[m.id]?.customer_charge ?? '', repair_cost: e.target.value } }))} /></td>
                        <td className="num"><input type="number" step="0.01" style={{ width: 120 }} value={markCharges[m.id]?.customer_charge ?? ''} onChange={(e) => setMarkCharges((x) => ({ ...x, [m.id]: { repair_cost: x[m.id]?.repair_cost ?? '', customer_charge: e.target.value } }))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="muted small" style={{ marginTop: 6 }}>Her yeni hasar için hasar dosyası açılır (fotoğraf, ekspertiz, sigorta takibi).</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {step === 'equipment' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Ekipman kontrolü</h2></div>
            <div className="card-body check-grid">
              {equipment.map((item) => {
                const had = outPresent.has(item);
                const missing = had && s.checklist.length > 0 && !nowPresent.has(item);
                return (
                  <label key={item} className={missing ? 'missing' : ''}>
                    <input type="checkbox" checked={nowPresent.has(item)} onChange={(e) => run(() => api('PATCH', `/api/inspections/${s.id}`, { checklist: { [item]: e.target.checked } }))} />
                    {item} {!had ? <span className="muted small">(çıkışta yok)</span> : missing ? <span className="danger-text small">kayıp</span> : null}
                  </label>
                );
              })}
              {!s.checklist.length ? (
                <button type="button" className="sm" onClick={() => run(() => api('PATCH', `/api/inspections/${s.id}`, { checklist: Object.fromEntries(equipment.map((i) => [i, outPresent.has(i)])) }))}>
                  Çıkıştaki gibi tam
                </button>
              ) : null}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Km · yakıt · temizlik</h2></div>
            <div className="card-body form-grid">
              <div className="c12 muted small">Çıkış: {numf(r.start_km)} km · yakıt {FUEL(r.start_fuel)}{r.vehicle.km_limit_per_day ? ` · limit ${r.vehicle.km_limit_per_day} km/gün` : ''}</div>
              <Field label="Dönüş km" className="c12"><input type="number" inputMode="numeric" value={km} min={r.start_km} onChange={(e) => setKm(e.target.value)} /></Field>
              <div className="c12"><div className="muted small mb">Yakıt seviyesi</div><FuelInput value={fuel} onChange={setFuel} /></div>
              <Field label="Temizlik / koku" className="c12">
                <select value={clean} onChange={(e) => setClean(e.target.value)}><Options list={Object.entries(CLEANLINESS_LABELS)} /></select>
              </Field>
              <div className="c12">
                <button type="button" className="primary" onClick={() => run(() => api('PATCH', `/api/inspections/${s.id}`, { km, fuel, cleanliness: clean }), 'Kaydedildi')}>Kaydet</button>
                {s.km !== null ? <span className="muted small" style={{ marginLeft: 10 }}>Kayıtlı: {numf(s.km)} km ({numf(s.km - r.start_km)} km yapıldı)</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {step === 'settle' ? (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>İade bilgileri ve ek ücretler</h2></div>
            <div className="card-body form-grid">
              <Field label="İade zamanı" className="c6"><input type="datetime-local" value={returnAt} onChange={(e) => setReturnAt(e.target.value)} /></Field>
              <Field label="İade şubesi" className="c6">
                <select value={returnBranch} onChange={(e) => setReturnBranch(e.target.value)}>
                  <Options list={branches.filter((b) => b.active).map((b) => [b.id, b.name] as const)} empty="—" />
                </select>
              </Field>
              <div className="c12 muted small">Planlanan dönüş: {dt(r.planned_return_at)} · {r.return_branch_name}</div>
              {canApprove ? (
                <div className="c12 check-row">
                  {(['waive_late', 'waive_km', 'waive_fuel', 'waive_cleaning'] as const).map((k) => (
                    <label key={k} className="check">
                      <input type="checkbox" checked={waive[k]} onChange={(e) => setWaive((w) => ({ ...w, [k]: e.target.checked }))} />
                      {{ waive_late: 'Geç iadeyi affet', waive_km: 'Km aşımını affet', waive_fuel: 'Yakıtı affet', waive_cleaning: 'Temizliği affet' }[k]}
                    </label>
                  ))}
                </div>
              ) : <div className="c12 muted small">Ücret affı yönetici onayı gerektirir; iade sonrası sözleşmeden af talebi oluşturabilirsiniz.</div>}
              <div className="form-section">Diğer ek ücretler (trafik cezası, HGS, hasar dışı) <button type="button" className="sm" onClick={() => setExtra((x) => [...x, { key: crypto.randomUUID(), type: 'other', description: '', amount: '' }])}>+ Ekle</button></div>
              <div className="c12">
                {extra.map((row) => (
                  <div className="dyn-row" key={row.key} style={{ gridTemplateColumns: '1fr 2fr 1fr auto' }}>
                    <select value={row.type} onChange={(e) => setExtra((x) => x.map((y) => (y.key === row.key ? { ...y, type: e.target.value } : y)))}>
                      <Options list={textOptions('chargeType').filter(([k]) => !['late_return', 'extra_km', 'fuel', 'damage', 'missing_equipment', 'cleaning'].includes(k))} />
                    </select>
                    <input placeholder="Açıklama" value={row.description} onChange={(e) => setExtra((x) => x.map((y) => (y.key === row.key ? { ...y, description: e.target.value } : y)))} />
                    <input type="number" step="0.01" placeholder="₺" value={row.amount} onChange={(e) => setExtra((x) => x.map((y) => (y.key === row.key ? { ...y, amount: e.target.value } : y)))} />
                    <button type="button" className="sm" onClick={() => setExtra((x) => x.filter((y) => y.key !== row.key))}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Hesap özeti</h2></div>
            <div className="card-body" id="preview">
              {preview ? (
                <>
                  <SumRow label="Yapılan km" value={`${numf(preview.km_driven)} km`} />
                  <SumRow label="Gerçekleşen süre" value={<>{preview.actual_days} gün{preview.late_hours ? <span className="badge danger" style={{ marginLeft: 6 }}>{preview.late_hours} saat gecikme</span> : null}</>} />
                  {preview.charges.length ? preview.charges.map((c, i) => <SumRow key={i} label={<>{text('chargeType', c.type)} <span className="muted small">{c.description}</span></>} value={money(c.amount)} />) : <SumRow className="muted" label="Ek ücret yok" value="" />}
                  <SumRow total label="Yeni toplam" value={money(preview.new_total)} />
                  <SumRow label="Ödenen" value={money(preview.paid)} />
                  <SumRow label="Kalan bakiye" value={<span className={preview.balance > 0 ? 'danger-text' : ''}>{money(preview.balance)}</span>} />
                  <SumRow label="Tutulan depozito / provizyon" value={money(preview.deposit_held)} />
                </>
              ) : previewErr ? <ErrorBox error={previewErr} /> : <div className="muted">Önce dönüş km'sini kaydedin.</div>}
            </div>
          </div>
        </div>
      ) : null}

      {step === 'sign' ? (
        <div className="grid grid-2">
          <SignaturePad
            title="Müşteri — iade tutanağı ve hesap özeti"
            signerName={customerName(r.customer)}
            signed={r.sig_valid.checkin.customer}
            disabled={s.missing_angles.length ? `Zorunlu ${s.missing_angles.length} fotoğraf eksik` : s.km === null ? 'Önce km/yakıt kaydedin' : null}
            onSave={async (img, name, strokes, ms) => {
              await api('POST', `/api/rentals/${r.id}/sign`, { purpose: 'checkin', signer_type: 'customer', signer_name: name, image: img, stroke_count: strokes, duration_ms: ms });
              await reload();
              toast('İmza kaydedildi');
            }}
          />
          <div className="card">
            <div className="card-body">
              <p className="small">Müşteri hesap özetini tablette inceleyip imzalar. Müşteri imzadan kaçınırsa nedeni ödeme adımında yazılmalıdır; fotoğraflar ve tutanak delil olarak arşivlenir.</p>
              {preview ? <SumRow total label="İmzalanacak toplam" value={money(preview.new_total)} /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {step === 'pay' ? (
        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            setError(null);
            try {
              await api('POST', `/api/rentals/${r.id}/checkin`, { ...body(), ...f, create_wash_task: f.create_wash_task === 'on' });
              toast('İade tamamlandı · fatura ve tutanak üretildi');
              router.push(`/rentals/${r.id}`);
              router.refresh();
            } catch (err) {
              setError(err);
            }
          }}
        >
          <div className="card-head"><h2>Tahsilat ve depozito kapanışı</h2>{preview ? <span>Kalan: <strong>{money(preview.balance)}</strong> · Depozito: <strong>{money(preview.deposit_held)}</strong></span> : null}</div>
          <div className="card-body form-grid">
            <Field label="Depozito / provizyon" className="c6">
              <select name="deposit_action" defaultValue="offset">
                <Options list={[
                  ['offset', 'Bakiyeye mahsup et, kalanı iade et / provizyonu kapat'],
                  ['hold', 'Bekleyen HGS/ceza için kısmen tut, kalanı mahsup/iade'],
                  ['return', 'Tamamını iade et'],
                  ['none', 'Şimdilik tut'],
                ]} />
              </select>
            </Field>
            <Field label="Tutulacak tutar (₺)" className="c3"><input type="number" step="0.01" name="hold_amount" placeholder="Örn. 1000" /></Field>
            <Field label="Tutma süresi (gün)" className="c3"><input type="number" name="hold_days" defaultValue={holdDays} /></Field>
            <Field label="Tahsilat (₺)" className="c3"><input type="number" step="0.01" name="payment_amount" /></Field>
            <Field label="Yöntem" className="c3"><select name="payment_method" defaultValue="pos"><Options list={PAY_METHODS} /></select></Field>
            <Field label="Referans" className="c6"><input name="payment_reference" /></Field>
            <Field label="Araç durumu" className="c6">
              <select name="vehicle_status" defaultValue="">
                <Options list={[['available', 'Müsait'], ['maintenance', 'Servise gönder'], ['damaged', 'Hasarlı (kullanım dışı)']]} empty="Otomatik (ağır hasar → hasarlı)" />
              </select>
            </Field>
            <label className="check c6"><input type="checkbox" name="create_wash_task" defaultChecked /> Yıkama iş emri oluştur</label>
            {!r.sig_valid.checkin.customer ? <Field label="Müşteri imzadan kaçındıysa nedeni" className="c12"><input name="signature_refused_reason" /></Field> : null}
            <Field label="İade notları" className="c12"><textarea name="checkin_notes" /></Field>
          </div>
          <div className="modal-foot">
            <Link className="btn" href={`/rentals/${r.id}`}>Sözleşmeye dön</Link>
            <button type="submit" className="success big-btn" disabled={!done.photos || !done.equipment}>↩︎ İadeyi tamamla</button>
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
