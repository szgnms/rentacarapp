'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './client/api';
import { ErrorBox } from './client/Modal';
import { useToast } from './client/Toast';
import { CustomerButton } from './dialogs/forms';
import { FUEL_OPTIONS, Field, Options, SumRow, Tag } from './ui';
import { PAY_METHODS, addDaysStr, customerName, dt, localInput, money, numf, qs } from '@/lib/format';
import type { Branch, Customer, CustomerListItem, Extra, Quote, Rental, Reservation } from '@/lib/types';
import type { AvailableVehicle } from '@/lib/domain/fleet';
import type { ReservationDetail } from '@/lib/domain/bookings';

type Mode = 'reservation' | 'rental';
type SelectedCustomer = Customer & { issues?: string[] };

interface Props {
  branches: Branch[];
  extras: Extra[];
  categories: readonly string[];
  transmissions: readonly string[];
  editing: ReservationDetail | null;
  initialMode: Mode;
  initialVehicleId: number | null;
  initialCustomer: SelectedCustomer | null;
}

/** Hook: değeri gecikmeli döndürür (yazarken her tuşta istek atmamak için). */
function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function BookingForm({ branches, extras, categories, transmissions, editing, initialMode, initialVehicleId, initialCustomer }: Props) {
  const router = useRouter();
  const toast = useToast();
  const defaultBranch = branches.find((b) => b.active)?.id ?? '';
  const [mode, setMode] = useState<Mode>(editing ? 'reservation' : initialMode);
  const [f, setF] = useState({
    pickup_at: editing?.pickup_at ?? (initialMode === 'rental' ? localInput() : addDaysStr(1, 10)),
    return_at: editing?.return_at ?? addDaysStr(initialMode === 'rental' ? 3 : 4, 10),
    pickup_branch_id: String(editing?.pickup_branch_id ?? defaultBranch),
    return_branch_id: String(editing?.return_branch_id ?? defaultBranch),
    category: '',
    transmission: '',
    daily_rate: editing ? String(editing.daily_rate) : '',
    discount: editing?.discount ? String(editing.discount) : '',
    deposit_amount: editing ? String(editing.deposit_amount) : '',
  });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const [selExtras, setSelExtras] = useState<Record<number, number>>(
    Object.fromEntries((editing?.extras ?? []).map((x) => [x.extra_id, x.quantity])),
  );
  const [vehicleId, setVehicleId] = useState<number | null>(editing?.vehicle_id ?? initialVehicleId);
  const [vehicles, setVehicles] = useState<AvailableVehicle[] | null>(null);
  const [vehiclesErr, setVehiclesErr] = useState<unknown>(null);
  const [customer, setCustomer] = useState<SelectedCustomer | null>(initialCustomer);
  const [custQ, setCustQ] = useState('');
  const [custResults, setCustResults] = useState<CustomerListItem[] | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const visibleExtras = extras.filter((x) => x.active || selExtras[x.id]);
  const extrasList = useMemo(() => Object.entries(selExtras).map(([id, q]) => ({ extra_id: Number(id), quantity: q })), [selExtras]);

  // ----- Müsait araçlar -----
  // Debounce girdileri string anahtar: her render'da yeni nesne oluşup döngüye girmesin.
  const search = useDebounced(qs({ pickup_at: f.pickup_at, return_at: f.return_at, category: f.category, transmission: f.transmission, exclude_reservation_id: editing?.id }));
  useEffect(() => {
    let cancelled = false;
    api<AvailableVehicle[]>('GET', '/api/vehicles/available?' + search)
      .then((list) => {
        if (cancelled) return;
        setVehicles(list);
        setVehiclesErr(null);
        setVehicleId((cur) => {
          if (cur && !list.some((v) => v.id === cur)) {
            toast('Seçili araç bu tarihlerde müsait değil', 'error');
            return null;
          }
          return cur;
        });
      })
      .catch((e) => !cancelled && (setVehicles([]), setVehiclesErr(e)));
    return () => {
      cancelled = true;
    };
  }, [search, toast]);

  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null;

  // ----- Fiyat özeti -----
  const quoteKey = useDebounced(vehicleId ? JSON.stringify({ ...f, vehicle_id: vehicleId, extras: extrasList }) : '', 200);
  useEffect(() => {
    if (!quoteKey) return setQuote(null);
    let cancelled = false;
    api<Quote>('POST', '/api/quote', JSON.parse(quoteKey))
      .then((q) => !cancelled && (setQuote(q), setQuoteErr(null)))
      .catch((e) => !cancelled && (setQuote(null), setQuoteErr(e)));
    return () => {
      cancelled = true;
    };
  }, [quoteKey]);

  // ----- Müşteri arama -----
  const custSearch = useDebounced(custQ);
  useEffect(() => {
    if (!custSearch.trim()) return setCustResults(null);
    api<CustomerListItem[]>('GET', '/api/customers?' + qs({ q: custSearch })).then(setCustResults).catch(() => setCustResults([]));
  }, [custSearch]);

  const selectCustomer = async (id: number) => {
    setCustomer(await api<SelectedCustomer>('GET', `/api/customers/${id}`));
    setCustQ('');
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    if (m === 'rental') set('pickup_at', localInput());
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (e.target !== e.currentTarget) return; // portal (yeni müşteri modalı) gönderimleri
    setError(null);
    if (!vehicleId) return setError(new Error('Lütfen bir araç seçin'));
    if (!customer) return setError(new Error('Lütfen bir müşteri seçin'));
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const body = { ...data, ...f, vehicle_id: vehicleId, customer_id: customer.id, extras: extrasList };
    setBusy(true);
    try {
      if (editing) {
        await api('PUT', `/api/reservations/${editing.id}`, body);
        toast('Rezervasyon güncellendi');
        router.push(`/reservations/${editing.id}`);
      } else if (mode === 'rental') {
        const r = await api<Rental>('POST', '/api/rentals', body);
        toast(`Sözleşme ${r.contract_no} oluşturuldu, araç teslim edildi`);
        router.push(`/rentals/${r.id}`);
      } else {
        const r = await api<Reservation>('POST', '/api/reservations', body);
        toast(`Rezervasyon ${r.code} oluşturuldu`);
        router.push(`/reservations/${r.id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const branchOpts = branches.filter((b) => b.active).map((b) => [b.id, b.name] as const);

  return (
    <form onSubmit={submit} className="grid booking-grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' }} noValidate>
      <div className="grid">
        {!editing ? (
          <div className="card">
            <div className="card-body">
              <div className="tabs" style={{ marginBottom: 0 }}>
                <button type="button" className={mode === 'reservation' ? 'active' : ''} onClick={() => switchMode('reservation')}>📅 Rezervasyon (ileri tarihli)</button>
                <button type="button" className={mode === 'rental' ? 'active' : ''} onClick={() => switchMode('rental')}>🔑 Hemen teslim (kapıdan kiralama)</button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="card">
          <div className="card-head"><h2>1. Tarih & şube</h2></div>
          <div className="card-body form-grid">
            <Field label="Alış tarihi" className="c3"><input type="datetime-local" value={f.pickup_at} onChange={(e) => set('pickup_at', e.target.value)} /></Field>
            <Field label="Dönüş tarihi" className="c3"><input type="datetime-local" value={f.return_at} onChange={(e) => set('return_at', e.target.value)} /></Field>
            <Field label="Alış şubesi" className="c3">
              <select value={f.pickup_branch_id} onChange={(e) => set('pickup_branch_id', e.target.value)}><Options list={branchOpts} empty="—" /></select>
            </Field>
            <Field label="Dönüş şubesi" className="c3">
              <select value={f.return_branch_id} onChange={(e) => set('return_branch_id', e.target.value)}><Options list={branchOpts} empty="—" /></select>
            </Field>
            <Field label="Kategori" className="c3">
              <select value={f.category} onChange={(e) => set('category', e.target.value)}><Options list={categories} empty="Tümü" /></select>
            </Field>
            <Field label="Vites" className="c3">
              <select value={f.transmission} onChange={(e) => set('transmission', e.target.value)}><Options list={transmissions} empty="Tümü" /></select>
            </Field>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>2. Araç seçimi</h2>
            <span className="muted small">{vehicles ? `${vehicles.length} müsait araç` : 'Yükleniyor…'}</span>
          </div>
          <div className="card-body">
            <ErrorBox error={vehiclesErr} />
            <div className="vehicle-cards">
              {vehicles?.length === 0 && !vehiclesErr ? <div className="muted">Seçilen kriterlerde müsait araç bulunamadı.</div> : null}
              {vehicles?.map((v) => (
                <div key={v.id} className={`vcard ${v.id === vehicleId ? 'selected' : ''}`} onClick={() => setVehicleId(v.id)} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setVehicleId(v.id)}>
                  <div className="t">{v.brand} {v.model}</div>
                  <div className="muted small">{v.plate} · {v.category} · {v.transmission} · {v.fuel_type}</div>
                  <div className="muted small">{v.branch_name} · {numf(v.current_km)} km</div>
                  <div className="price">{money(v.quote.total_amount)}</div>
                  <div className="muted small">
                    {v.quote.days} gün × {money(v.daily_rate)}
                    {v.quote.long_term_discount ? ` · %${v.quote.long_term_discount_pct} uzun dönem ind.` : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>3. Müşteri</h2>
            <CustomerButton className="sm" onSaved={(c) => selectCustomer(c.id)}>+ Yeni müşteri</CustomerButton>
          </div>
          <div className="card-body">
            {customer ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                  <div>
                    <strong>{customerName(customer)}</strong> {customer.blacklisted ? <Tag tone="danger">Kara liste</Tag> : null}
                    <div className="muted small">
                      {customer.phone} · {customer.national_id || customer.passport_no || 'kimlik yok'} · Ehliyet: {customer.license_no || 'yok'}
                    </div>
                  </div>
                  <button type="button" className="sm" onClick={() => setCustomer(null)}>Değiştir</button>
                </div>
                {customer.issues?.length ? (
                  <div className="alert warn" style={{ marginTop: 10 }}>{customer.issues.map((i) => <div key={i}>• {i}</div>)}</div>
                ) : null}
              </>
            ) : (
              <>
                <input type="search" placeholder="Ad, telefon, T.C. no ile müşteri ara…" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                {custResults ? (
                  <div className="cust-results">
                    {custResults.length ? (
                      custResults.slice(0, 20).map((c) => (
                        <div key={c.id} onClick={() => selectCustomer(c.id)} role="button">
                          <strong>{customerName(c)}</strong> <span className="muted small">{c.phone} {c.national_id}</span>{' '}
                          {c.blacklisted ? <Tag tone="danger">Kara liste</Tag> : null}
                        </div>
                      ))
                    ) : (
                      <div className="muted">Sonuç yok</div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>4. Ek hizmetler & fiyat</h2></div>
          <div className="card-body">
            {visibleExtras.length ? (
              visibleExtras.map((x) => (
                <div className="extra-row" key={x.id}>
                  <label className="check" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={!!selExtras[x.id]}
                      onChange={(e) =>
                        setSelExtras((s) => {
                          const n = { ...s };
                          if (e.target.checked) n[x.id] = n[x.id] || 1;
                          else delete n[x.id];
                          return n;
                        })
                      }
                    />
                    {x.name}{' '}
                    <span className="muted small">
                      {money(x.price)} {x.price_type === 'daily' ? '/ gün' : '/ kiralama'}
                      {x.max_price ? ` (en fazla ${money(x.max_price)})` : ''}
                    </span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    title="Adet"
                    value={selExtras[x.id] ?? 1}
                    disabled={!selExtras[x.id]}
                    onChange={(e) => setSelExtras((s) => ({ ...s, [x.id]: Math.max(1, Number(e.target.value) || 1) }))}
                  />
                </div>
              ))
            ) : (
              <div className="muted">Tanımlı ek hizmet yok.</div>
            )}
            <div className="form-grid" style={{ marginTop: 12 }}>
              <Field label="Özel günlük fiyat (boş = liste fiyatı)" className="c4"><input type="number" step="0.01" value={f.daily_rate} onChange={(e) => set('daily_rate', e.target.value)} /></Field>
              <Field label="İndirim (₺)" className="c4"><input type="number" step="0.01" value={f.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
              <Field label="Depozito (₺, boş = araç depozitosu)" className="c4"><input type="number" step="0.01" value={f.deposit_amount} onChange={(e) => set('deposit_amount', e.target.value)} /></Field>
            </div>
          </div>
        </div>

        {mode === 'reservation' ? (
          <div className="card">
            <div className="card-head"><h2>5. Rezervasyon bilgileri</h2></div>
            <div className="card-body form-grid">
              <Field label="Durum" className="c4"><select name="status" defaultValue={editing?.status ?? 'confirmed'}><Options list={[['confirmed', 'Onaylı'], ['pending', 'Beklemede']]} /></select></Field>
              <Field label="Kaynak" className="c4"><select name="source" defaultValue={editing?.source ?? 'Ofis'}><Options list={['Ofis', 'Telefon', 'Web', 'Acente', 'Kurumsal']} /></select></Field>
              {!editing ? (
                <>
                  <Field label="Ön ödeme (₺)" className="c4"><input type="number" step="0.01" name="prepayment" /></Field>
                  <Field label="Ön ödeme yöntemi" className="c4"><select name="prepayment_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
                </>
              ) : null}
              <Field label="Notlar" className="c12"><textarea name="notes" defaultValue={editing?.notes ?? ''} /></Field>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-head"><h2>5. Teslim (check-out) bilgileri</h2></div>
            <div className="card-body form-grid">
              <Field label="Çıkış km" className="c4"><input type="number" name="start_km" placeholder={vehicle ? `${vehicle.current_km} (güncel)` : "Aracın güncel km'si"} /></Field>
              <Field label="Yakıt seviyesi" className="c4"><select name="start_fuel" defaultValue={8}><Options list={FUEL_OPTIONS} /></select></Field>
              <Field label="Ek sürücü (ad soyad, ehliyet)" className="c4"><input name="additional_driver" /></Field>
              <Field label="Alınan depozito (₺)" className="c3"><input type="number" step="0.01" name="deposit_collected" placeholder={vehicle ? String(vehicle.deposit_amount) : ''} /></Field>
              <Field label="Depozito yöntemi" className="c3"><select name="deposit_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
              <Field label="Tahsilat (₺)" className="c3"><input type="number" step="0.01" name="payment_amount" /></Field>
              <Field label="Tahsilat yöntemi" className="c3"><select name="payment_method" defaultValue="credit_card"><Options list={PAY_METHODS} /></select></Field>
              <Field label="Teslim notları (hasar, aksesuar vb.)" className="c12"><textarea name="checkout_notes" /></Field>
            </div>
          </div>
        )}
      </div>

      <div className="card sticky">
        <div className="card-head"><h2>Özet</h2></div>
        <div className="card-body" id="summary">
          {!vehicle ? (
            <div className="muted">Fiyatı görmek için bir araç seçin.</div>
          ) : quoteErr ? (
            <ErrorBox error={quoteErr} />
          ) : quote ? (
            <>
              <div><strong>{vehicle.brand} {vehicle.model}</strong> <span className="muted">{vehicle.plate}</span></div>
              <div className="muted small" style={{ marginBottom: 10 }}>{dt(f.pickup_at)} → {dt(f.return_at)}</div>
              <SumRow label={`${quote.days} gün × ${money(quote.daily_rate)}`} value={money(quote.base_amount)} />
              {quote.long_term_discount ? <SumRow label={`Uzun dönem indirimi (%${quote.long_term_discount_pct})`} value={`-${money(quote.long_term_discount)}`} /> : null}
              {quote.extras.map((x) => <SumRow key={x.extra_id} label={`${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`} value={money(x.amount)} />)}
              {quote.one_way_fee ? <SumRow label="Tek yön ücreti" value={money(quote.one_way_fee)} /> : null}
              {quote.discount ? <SumRow label="İndirim" value={`-${money(quote.discount)}`} /> : null}
              <SumRow total label="Toplam" value={money(quote.total_amount)} />
              <div className="muted small">Depozito: {money(f.deposit_amount !== '' ? Number(f.deposit_amount) : quote.deposit_amount)} (iade edilir) · KDV dahil</div>
            </>
          ) : (
            <div className="muted">Hesaplanıyor…</div>
          )}
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <ErrorBox error={error} />
          <button type="submit" className="primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {editing ? 'Değişiklikleri kaydet' : mode === 'rental' ? 'Sözleşmeyi oluştur ve teslim et' : 'Rezervasyonu oluştur'}
          </button>
        </div>
      </div>
    </form>
  );
}
