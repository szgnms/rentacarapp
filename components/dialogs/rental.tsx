'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../client/api';
import { Modal } from '../client/Modal';
import { useToast } from '../client/Toast';
import { Field, Options, Tag } from '../ui';
import { DEPOSIT_METHODS, PAY_METHODS, dt, localInput, money, numf, textOptions } from '@/lib/format';
import type { Rental, Vehicle } from '@/lib/types';

function useOpen() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: useCallback(() => setOpen(false), []) };
}

// ---------------- Ödeme / iade / depozito ----------------

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
    ? [['payment', 'Tahsilat'], ['refund', 'Müşteriye iade'], ['deposit_in', 'Depozito / provizyon al'], ['deposit_out', 'Depozito iadesi / provizyon kapat']]
    : [['payment', 'Ön ödeme tahsilatı'], ['refund', 'Müşteriye iade']];
  const amountFor = (t: string) => {
    if (t === 'payment') return suggested;
    if (t === 'deposit_in') return Math.max(0, (ctx.deposit_amount ?? 0) - (ctx.deposit_held ?? 0));
    if (t === 'deposit_out') return ctx.deposit_held ?? 0;
    return ctx.balance < 0 ? -ctx.balance : 0;
  };
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('payment');
  return (
    <>
      <button
        className={className}
        onClick={() => {
          setType('payment');
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
            const res = await api<{ approval: { id: number } | null }>('POST', '/api/payments', { ...d, rental_id: ctx.rental_id, reservation_id: ctx.reservation_id });
            toast(res.approval ? 'Depozito iadesi için onay talebi oluşturuldu' : 'Ödeme kaydedildi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            <Field label="İşlem">
              <select name="type" value={type} onChange={(e) => (setType(e.target.value), setAmount(String(amountFor(e.target.value) || '')))}>
                <Options list={types} />
              </select>
            </Field>
            <Field label="Yöntem">
              <select name="method" defaultValue="pos" key={type}>
                <Options list={type === 'deposit_in' || type === 'deposit_out' ? DEPOSIT_METHODS : PAY_METHODS} />
              </select>
            </Field>
            <Field label="Tutar (₺)"><input type="number" step="0.01" name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label="Tarih"><input type="datetime-local" name="paid_at" defaultValue={localInput()} /></Field>
            <Field label="Taksit"><input type="number" name="installments" min={1} max={12} placeholder="Tek çekim" /></Field>
            <Field label="POS / provizyon referansı"><input name="reference" /></Field>
            <Field label="Açıklama" className="c12"><input name="description" /></Field>
            <div className="c12 muted small">
              Kalan bakiye: {money(ctx.balance)}
              {ctx.rental_id ? ` · Tutulan depozito: ${money(ctx.deposit_held)}` : ''} · Kart verisi saklanmaz; yalnızca POS onay referansı kaydedilir.
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
          <div className="muted small">Araç müsaitliği kontrol edilir; gün sayısı, ek hizmetler ve toplam yeniden hesaplanır.</div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Ek ücret ----------------

export function ChargeButton({ rentalId, post }: { rentalId: number; post?: boolean }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button onClick={dlg.show}>{post ? 'Kapanış sonrası ücret' : 'Ek ücret'}</button>
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

/** Ücret kaldırma: onay yetkisi yoksa ücret affı talebi oluşur. */
export function RemoveChargeButton({ rentalId, chargeId, canApprove }: { rentalId: number; chargeId: number; canApprove: boolean }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button type="button" className="sm x" title={canApprove ? 'Ücreti kaldır' : 'Ücret affı talep et'} onClick={dlg.show}>×</button>
      {dlg.open ? (
        <Modal
          title={canApprove ? 'Ücret kaldırılsın mı?' : 'Ücret affı talebi'}
          submitLabel={canApprove ? 'Kaldır' : 'Onaya gönder'}
          onClose={dlg.hide}
          onSubmit={async (d) => {
            const res = await api<{ approval_requested?: boolean }>('DELETE', `/api/rentals/${rentalId}/charges/${chargeId}?reason=${encodeURIComponent(String(d.reason ?? ''))}`);
            toast(res.approval_requested ? 'Ücret affı onaya gönderildi' : 'Ücret kaldırıldı');
            router.refresh();
          }}
        >
          <Field label="Gerekçe"><input name="reason" required /></Field>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- İkame araç ----------------

export function SwapButton({ rental }: { rental: Rental }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (!dlg.open) return;
    api<Vehicle[]>('GET', `/api/vehicles/available?pickup_at=${encodeURIComponent(localInput())}&return_at=${encodeURIComponent(rental.planned_return_at)}`)
      .then((l) => setList(l.filter((v) => v.status === 'available')))
      .catch(() => setList([]));
  }, [dlg.open, rental.planned_return_at]);
  return (
    <>
      <button onClick={dlg.show}>İkame araç</button>
      {dlg.open ? (
        <Modal
          title="İkame araç ver"
          onClose={dlg.hide}
          submitLabel="Aracı değiştir"
          onSubmit={async (d) => {
            await api('POST', `/api/rentals/${rental.id}/swap`, d);
            toast('Sözleşmedeki araç değiştirildi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            <Field label="İkame araç" className="c12">
              <select name="vehicle_id" required>
                <Options list={list.map((v) => [v.id, `${v.plate} · ${v.brand} ${v.model} (${v.category}) · ${numf(v.current_km)} km`] as const)} empty="Araç seçin" />
              </select>
            </Field>
            <Field label="Eski aracın son km'si"><input type="number" name="old_vehicle_km" /></Field>
            <Field label="Eski araç durumu"><select name="old_vehicle_status" defaultValue="maintenance"><Options list={[['maintenance', 'Servise'], ['damaged', 'Hasarlı'], ['available', 'Müsait']]} /></select></Field>
            <Field label="Neden" className="c12"><input name="reason" placeholder="Arıza / kaza / müşteri talebi" /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Grup rezervasyonuna araç atama ----------------

export function AssignButton({ reservationId, current }: { reservationId: number; current: number | null }) {
  const dlg = useOpen();
  const router = useRouter();
  const toast = useToast();
  const [opts, setOpts] = useState<{ category: string; same: Vehicle[]; upgrades: Vehicle[] } | null>(null);
  useEffect(() => {
    if (dlg.open) api<typeof opts>('GET', `/api/reservations/${reservationId}/assignment`).then(setOpts).catch(() => setOpts(null));
  }, [dlg.open, reservationId]);
  return (
    <>
      <button onClick={dlg.show}>{current ? 'Aracı değiştir' : '🚗 Araç ata'}</button>
      {dlg.open ? (
        <Modal
          title="Araç atama"
          onClose={dlg.hide}
          submitLabel="Ata"
          onSubmit={async (d) => {
            await api('POST', `/api/reservations/${reservationId}/assignment`, { vehicle_id: d.vehicle_id || null });
            toast(d.vehicle_id ? 'Araç atandı' : 'Atama kaldırıldı');
            router.refresh();
          }}
        >
          {!opts ? <div className="muted">Yükleniyor…</div> : (
            <>
              {!opts.same.length ? <div className="alert warn">{opts.category} grubunda boş araç yok — upgrade önerileri listelendi.</div> : null}
              <Field label="Araç">
                <select name="vehicle_id" defaultValue={current ?? ''}>
                  <option value="">— Atama yok (grup rezervasyonu) —</option>
                  {opts.same.length ? <optgroup label={`${opts.category} grubu`}>{opts.same.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model} · {numf(v.current_km)} km</option>)}</optgroup> : null}
                  {opts.upgrades.length ? <optgroup label="Upgrade (fiyat değişmez)">{opts.upgrades.map((v) => <option key={v.id} value={v.id}>{v.plate} · {v.brand} {v.model} ({v.category})</option>)}</optgroup> : null}
                </select>
              </Field>
              {opts.upgrades.length && !opts.same.length ? <div style={{ marginTop: 8 }}><Tag tone="violet">Upgrade önerisi</Tag></div> : null}
            </>
          )}
        </Modal>
      ) : null}
    </>
  );
}
