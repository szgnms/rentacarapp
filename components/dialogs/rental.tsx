'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../client/api';
import { ErrorBox, Modal } from '../client/Modal';
import { useToast } from '../client/Toast';
import { FUEL_OPTIONS, Field, Options, SumRow } from '../ui';
import { FUEL, PAY_METHODS, customerName, dt, labelOptions, localInput, money, numf, qs, text, textOptions } from '@/lib/format';
import type { Branch, Customer, Rental, Vehicle } from '@/lib/types';
import type { CheckinCalc } from '@/lib/rules';

function useOpen() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: useCallback(() => setOpen(false), []) };
}

// ---------------- Ödeme ----------------

interface PaymentCtx {
  rental_id?: number;
  reservation_id?: number;
  /** Kalan bakiye (negatifse müşteriye iade edilecek tutar). */
  balance: number;
  deposit_held?: number;
  deposit_amount?: number;
}

export function PaymentButton({ ctx, children, className }: { ctx: PaymentCtx; children: ReactNode; className?: string }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  const suggested = Math.max(0, Math.round(ctx.balance * 100) / 100);
  const types: [string, string][] = ctx.rental_id
    ? [['payment', 'Tahsilat'], ['refund', 'Müşteriye iade'], ['deposit_in', 'Depozito al'], ['deposit_out', 'Depozito iade et']]
    : [['payment', 'Ön ödeme tahsilatı'], ['refund', 'Müşteriye iade']];
  const amountFor = (t: string) => {
    if (t === 'payment') return suggested;
    if (t === 'deposit_in') return Math.max(0, (ctx.deposit_amount ?? 0) - (ctx.deposit_held ?? 0));
    if (t === 'deposit_out') return ctx.deposit_held ?? 0;
    return ctx.balance < 0 ? -ctx.balance : 0;
  };
  const [amount, setAmount] = useState(String(suggested || ''));
  return (
    <>
      <button
        className={className}
        onClick={() => {
          // Bakiye sayfa yenilendikçe değişir; her açılışta güncel değerle başla.
          setAmount(String(suggested || ''));
          dlg.show();
        }}
      >
        {children}
      </button>
      {dlg.open ? (
        <Modal
          title="Ödeme işlemi"
          onClose={dlg.hide}
          onSubmit={async (d) => {
            await api('POST', '/api/payments', { ...d, rental_id: ctx.rental_id, reservation_id: ctx.reservation_id });
            toast('Ödeme kaydedildi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            <Field label="İşlem">
              <select name="type" defaultValue="payment" onChange={(e) => setAmount(String(amountFor(e.target.value) || ''))}>
                <Options list={types} />
              </select>
            </Field>
            <Field label="Yöntem"><select name="method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
            <Field label="Tutar (₺)"><input type="number" step="0.01" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label="Tarih"><input type="datetime-local" name="paid_at" defaultValue={localInput()} /></Field>
            <Field label="Açıklama" className="c12"><input name="description" /></Field>
            <div className="c12 muted small">
              Kalan bakiye: {money(ctx.balance)}
              {ctx.rental_id ? ` · Tutulan depozito: ${money(ctx.deposit_held)}` : ''}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Süre uzatma ----------------

export function ExtendButton({ rental }: { rental: Rental }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button onClick={dlg.show}>Süre uzat</button>
      {dlg.open ? (
        <Modal
          title={`Süre uzatma · ${rental.contract_no}`}
          submitLabel="Uzat"
          onClose={dlg.hide}
          onSubmit={async (d) => {
            await api('POST', `/api/rentals/${rental.id}/extend`, d);
            toast('Kiralama süresi uzatıldı');
            router.refresh();
          }}
        >
          <div className="alert info">Mevcut dönüş: {dt(rental.planned_return_at)} · {rental.days} gün · Günlük {money(rental.daily_rate)}</div>
          <div className="form-grid">
            <Field label="Yeni dönüş tarihi"><input type="datetime-local" name="return_at" defaultValue={rental.planned_return_at} required /></Field>
            <Field label="Günlük fiyat (₺)"><input type="number" step="0.01" name="daily_rate" defaultValue={rental.daily_rate} /></Field>
          </div>
          <div className="muted small">Araç müsaitliği kontrol edilir; gün sayısı, ek hizmetler ve toplam tutar yeniden hesaplanır.</div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Ek ücret ----------------

export function ChargeButton({ rentalId }: { rentalId: number }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button onClick={dlg.show}>Ek ücret</button>
      {dlg.open ? (
        <Modal
          title="Ek ücret ekle"
          onClose={dlg.hide}
          onSubmit={async (d) => {
            await api('POST', `/api/rentals/${rentalId}/charges`, d);
            toast('Ek ücret eklendi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            <Field label="Tip"><select name="type" defaultValue="traffic_fine"><Options list={textOptions('chargeType')} /></select></Field>
            <Field label="Tutar (₺)"><input type="number" step="0.01" name="amount" required /></Field>
            <Field label="Açıklama" className="c12"><input name="description" placeholder="Örn: 12.03 tarihli hız cezası" /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Teslim (rezervasyondan) ----------------

interface CheckoutProps {
  reservation: { id: number; code: string; vehicle_id: number; plate: string; pickup_at: string; return_at: string; total_amount: number; deposit_amount: number; paid: number };
  vehicle: Vehicle;
  customer: Customer;
  issues: string[];
}

export function CheckoutButton({ reservation: r, vehicle: v, customer, issues }: CheckoutProps) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  const [alts, setAlts] = useState<Vehicle[]>([]);
  const [km, setKm] = useState(String(v.current_km));
  const balance = Math.max(0, r.total_amount - r.paid);

  useEffect(() => {
    if (!dlg.open) return;
    api<Vehicle[]>('GET', '/api/vehicles/available?' + qs({ pickup_at: localInput(), return_at: r.return_at, exclude_reservation_id: r.id }))
      .then((list) => setAlts(list.filter((a) => a.id !== v.id && a.status === 'available')))
      .catch(() => setAlts([]));
  }, [dlg.open, r.id, r.return_at, v.id]);

  return (
    <>
      <button className="success" onClick={dlg.show}>🔑 Aracı teslim et</button>
      {dlg.open ? (
        <Modal
          title={`Araç teslimi · ${r.code}`}
          wide
          submitLabel="Teslim et ve sözleşme oluştur"
          submitClass="success"
          onClose={dlg.hide}
          onSubmit={async (d) => {
            const rental = await api<Rental>('POST', `/api/reservations/${r.id}/checkout`, d);
            toast(`Sözleşme ${rental.contract_no} oluşturuldu`);
            router.push(`/rentals/${rental.id}`);
          }}
        >
          {issues.length ? (
            <div className="alert warn">
              Müşteri kaydında eksik/uygunsuz bilgi var; teslimden önce <a href={`/customers/${customer.id}`}>müşteri kartını</a> güncelleyin:
              <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ) : null}
          {v.status !== 'available' ? (
            <div className="alert danger">Rezerve edilen araç şu an müsait değil. Aşağıdan farklı bir araç seçebilirsiniz.</div>
          ) : null}
          <div className="alert info">
            {customerName(customer)} · {r.plate} · {dt(r.pickup_at)} → {dt(r.return_at)} · Toplam {money(r.total_amount)}
          </div>
          <div className="form-grid">
            <Field label="Teslim zamanı" className="c4"><input type="datetime-local" name="pickup_at" defaultValue={localInput()} /></Field>
            <Field label="Araç (değişim / upgrade)" className="c8">
              <select
                name="vehicle_id"
                defaultValue={v.id}
                onChange={(e) => setKm(String([v, ...alts].find((a) => a.id === Number(e.target.value))?.current_km ?? v.current_km))}
              >
                <option value={v.id}>{v.plate} · {v.brand} {v.model}</option>
                {alts.map((a) => <option key={a.id} value={a.id}>{a.plate} · {a.brand} {a.model} ({a.category})</option>)}
              </select>
            </Field>
            <Field label="Çıkış km" className="c4"><input type="number" name="start_km" value={km} onChange={(e) => setKm(e.target.value)} /></Field>
            <Field label="Yakıt seviyesi" className="c4"><select name="start_fuel" defaultValue={8}><Options list={FUEL_OPTIONS} /></select></Field>
            <Field label="Ek sürücü" className="c4"><input name="additional_driver" /></Field>
            <div className="form-section">Tahsilat</div>
            <Field label="Alınan depozito (₺)" className="c3"><input type="number" step="0.01" name="deposit_collected" defaultValue={r.deposit_amount} /></Field>
            <Field label="Depozito yöntemi" className="c3"><select name="deposit_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
            <Field label={`Tahsilat (₺) · kalan ${money(balance)}`} className="c3"><input type="number" step="0.01" name="payment_amount" defaultValue={balance || ''} /></Field>
            <Field label="Tahsilat yöntemi" className="c3"><select name="payment_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
            <Field label="Teslim notları (mevcut hasarlar, aksesuarlar)" className="c12"><textarea name="checkout_notes" /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- İade (check-in) ----------------

type DynRow = Record<string, string> & { key: string };
const AUTO_CHARGES = ['late_return', 'extra_km', 'fuel', 'damage'];

export function CheckinButton({ rental: r, vehicle, branches }: { rental: Rental; vehicle: Vehicle; branches: Branch[] }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  const formRef = useRef<HTMLDivElement>(null);
  const [damages, setDamages] = useState<DynRow[]>([]);
  const [charges, setCharges] = useState<DynRow[]>([]);
  const [preview, setPreview] = useState<CheckinCalc | null>(null);
  const [previewErr, setPreviewErr] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  const bump = () => setTick((t) => t + 1);

  const collect = useCallback((): Record<string, unknown> => {
    const form = formRef.current?.closest('form');
    if (!form) return {};
    const data: Record<string, unknown> = {};
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      data[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    const strip = ({ key: _k, ...rest }: DynRow) => rest;
    return { ...data, damages: damages.map(strip), extra_charges: charges.map(strip) };
  }, [damages, charges]);

  useEffect(() => {
    if (!dlg.open) return;
    const data = collect();
    if (!data.end_km) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api<CheckinCalc>('POST', `/api/rentals/${r.id}/checkin-preview`, data)
        .then((p) => {
          setPreview(p);
          setPreviewErr(null);
        })
        .catch((e) => {
          setPreview(null);
          setPreviewErr(e);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [tick, damages, charges, dlg.open, collect, r.id]);

  const updateRow = (set: typeof setDamages, key: string, k: string, val: string) =>
    set((rows) => rows.map((row) => (row.key === key ? { ...row, [k]: val } : row)));
  const branchOpts = branches.filter((b) => b.active || b.id === r.return_branch_id).map((b) => [b.id, b.name] as const);

  return (
    <>
      <button className="success" onClick={dlg.show}>↩︎ İade al</button>
      {dlg.open ? (
        <Modal
          title={`İade al · ${r.contract_no}`}
          wide
          submitLabel="İadeyi tamamla"
          submitClass="success"
          onClose={dlg.hide}
          onSubmit={async () => {
            await api('POST', `/api/rentals/${r.id}/checkin`, collect());
            toast('İade tamamlandı');
            router.refresh();
          }}
        >
          <div ref={formRef} onInput={bump} onChange={bump}>
            <div className="alert info">
              {vehicle.plate} · Çıkış: {numf(r.start_km)} km, yakıt {FUEL(r.start_fuel)} · Planlanan dönüş: {dt(r.planned_return_at)}
              {vehicle.km_limit_per_day ? ` · Km limiti ${vehicle.km_limit_per_day}/gün` : ''}
            </div>
            <div className="form-grid">
              <Field label="İade zamanı" className="c3"><input type="datetime-local" name="actual_return_at" defaultValue={localInput()} /></Field>
              <Field label="Dönüş km *" className="c3"><input type="number" name="end_km" min={r.start_km} required /></Field>
              <Field label="Yakıt seviyesi" className="c3"><select name="end_fuel" defaultValue={r.start_fuel}><Options list={FUEL_OPTIONS} /></select></Field>
              <Field label="İade şubesi" className="c3"><select name="return_branch_id" defaultValue={r.return_branch_id ?? ''}><Options list={branchOpts} empty="—" /></select></Field>
              <div className="c12 check-row">
                <label className="check"><input type="checkbox" name="waive_late" /> Geç iade ücretini alma</label>
                <label className="check"><input type="checkbox" name="waive_km" /> Km aşımını alma</label>
                <label className="check"><input type="checkbox" name="waive_fuel" /> Yakıt farkını alma</label>
              </div>

              <div className="form-section">
                Hasarlar{' '}
                <button type="button" className="sm" onClick={() => setDamages((x) => [...x, { key: crypto.randomUUID(), description: '', location: '', severity: 'minor', customer_charge: '' }])}>
                  + Hasar ekle
                </button>
              </div>
              <div className="c12">
                {damages.map((row) => (
                  <div className="dyn-row" key={row.key}>
                    <Field label="Hasar açıklaması"><input data-skip value={row.description} onChange={(e) => updateRow(setDamages, row.key, 'description', e.target.value)} /></Field>
                    <Field label="Konum"><input data-skip value={row.location} placeholder="Ön tampon" onChange={(e) => updateRow(setDamages, row.key, 'location', e.target.value)} /></Field>
                    <Field label="Önem">
                      <select data-skip value={row.severity} onChange={(e) => updateRow(setDamages, row.key, 'severity', e.target.value)}>
                        <Options list={labelOptions('severity')} />
                      </select>
                    </Field>
                    <Field label="Müşteriye (₺)"><input data-skip type="number" step="0.01" value={row.customer_charge} onChange={(e) => updateRow(setDamages, row.key, 'customer_charge', e.target.value)} /></Field>
                    <button type="button" className="sm" onClick={() => setDamages((x) => x.filter((y) => y.key !== row.key))} aria-label="Kaldır">×</button>
                  </div>
                ))}
              </div>

              <div className="form-section">
                Diğer ek ücretler{' '}
                <button type="button" className="sm" onClick={() => setCharges((x) => [...x, { key: crypto.randomUUID(), type: 'cleaning', description: '', amount: '' }])}>
                  + Ücret ekle
                </button>
              </div>
              <div className="c12">
                {charges.map((row) => (
                  <div className="dyn-row" key={row.key} style={{ gridTemplateColumns: '1fr 2fr 1fr auto' }}>
                    <Field label="Tip">
                      <select data-skip value={row.type} onChange={(e) => updateRow(setCharges, row.key, 'type', e.target.value)}>
                        <Options list={textOptions('chargeType').filter(([k]) => !AUTO_CHARGES.includes(k))} />
                      </select>
                    </Field>
                    <Field label="Açıklama"><input data-skip value={row.description} onChange={(e) => updateRow(setCharges, row.key, 'description', e.target.value)} /></Field>
                    <Field label="Tutar (₺)"><input data-skip type="number" step="0.01" value={row.amount} onChange={(e) => updateRow(setCharges, row.key, 'amount', e.target.value)} /></Field>
                    <button type="button" className="sm" onClick={() => setCharges((x) => x.filter((y) => y.key !== row.key))} aria-label="Kaldır">×</button>
                  </div>
                ))}
              </div>

              <div className="form-section">Hesap</div>
              <div className="c12" id="preview">
                {preview ? (
                  <div className="grid grid-2">
                    <div>
                      <SumRow label="Kullanılan km" value={`${numf(preview.km_driven)} km`} />
                      <SumRow
                        label="Gerçekleşen süre"
                        value={<>{preview.actual_days} gün {preview.late_days ? <span className="badge danger">+{preview.late_days} gün gecikme</span> : null}</>}
                      />
                      {preview.charges.length ? (
                        preview.charges.map((c, i) => (
                          <SumRow key={i} label={<>{text('chargeType', c.type)} <span className="muted small">{c.description}</span></>} value={money(c.amount)} />
                        ))
                      ) : (
                        <SumRow className="muted" label="Ek ücret yok" value="" />
                      )}
                    </div>
                    <div>
                      <SumRow label="Yeni toplam" value={money(preview.new_total)} />
                      <SumRow label="Ödenen" value={money(preview.paid)} />
                      <SumRow total label="Kalan bakiye" value={<span className={preview.balance > 0 ? 'danger-text' : ''}>{money(preview.balance)}</span>} />
                      <SumRow label="Tutulan depozito" value={money(preview.deposit_held)} />
                    </div>
                  </div>
                ) : previewErr ? (
                  <ErrorBox error={previewErr} />
                ) : (
                  <div className="muted">Dönüş km&apos;sini girin, ücretler otomatik hesaplanır.</div>
                )}
              </div>

              <div className="form-section">Tahsilat & depozito</div>
              <Field label="Tahsilat (₺)" className="c3"><input type="number" step="0.01" name="payment_amount" /></Field>
              <Field label="Yöntem" className="c3"><select name="payment_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
              <Field label="Depozito" className="c6">
                <select name="deposit_action" defaultValue="offset">
                  <Options list={[['return', 'Tamamını iade et'], ['offset', 'Bakiyeye mahsup et, kalanı iade et'], ['none', 'Şimdilik tut']]} />
                </select>
              </Field>
              <label className="check c12"><input type="checkbox" name="send_to_maintenance" /> Aracı iade sonrası bakıma/onarıma al</label>
              <Field label="İade notları" className="c12"><textarea name="checkin_notes" /></Field>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
