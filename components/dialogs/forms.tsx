'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../client/api';
import { Modal } from '../client/Modal';
import { useToast } from '../client/Toast';
import { Field, Options } from '../ui';
import { labelOptions, textOptions, todayStr } from '@/lib/format';
import type { Branch, Customer, Damage, Expense, Maintenance, Vehicle } from '@/lib/types';

export const CATEGORIES = ['Ekonomi', 'Orta', 'Üst', 'SUV', 'Minivan', 'Lüks', 'Ticari'];
export const FUEL_TYPES = ['Benzin', 'Dizel', 'LPG', 'Hibrit', 'Elektrik'];
export const TRANSMISSIONS = ['Manuel', 'Otomatik'];
export const EXPENSE_CATEGORIES = ['Yakıt', 'Yıkama/Temizlik', 'Vergi (MTV)', 'Sigorta', 'Kasko', 'Muayene', 'Otopark', 'Personel', 'Kira', 'Diğer'];

export type VehicleOption = { id: number; label: string };

/** Buton + modal; kaydedince sayfayı yeniler veya yönlendirir. */
function useDialog() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

function useSaver() {
  const router = useRouter();
  const toast = useToast();
  return async <T,>(method: string, url: string, data: unknown, msg: string, go?: (r: T) => string) => {
    const r = await api<T>(method, url, data);
    toast(msg);
    if (go) router.push(go(r));
    else router.refresh();
    return r;
  };
}

/** Satıra tıklanınca aç; satırdaki buton/bağlantılar ve portal (modal) olayları hariç. */
function rowClick(e: React.MouseEvent<HTMLTableRowElement>, open: () => void) {
  if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest('button,a')) return;
  open();
}

const v = (x: unknown) => (x === null || x === undefined ? '' : String(x));

// ---------------- Araç ----------------

export function VehicleButton({ vehicle, branches, children, className }: { vehicle?: Vehicle; branches: Branch[]; children: ReactNode; className?: string }) {
  const dlg = useDialog();
  const save = useSaver();
  const x: Partial<Vehicle> = vehicle ?? { category: 'Ekonomi', fuel_type: 'Benzin', transmission: 'Manuel', seats: 5, km_limit_per_day: 0, current_km: 0, branch_id: branches[0]?.id };
  const branchOpts = branches.filter((b) => b.active || b.id === x.branch_id).map((b) => [b.id, b.name] as const);
  return (
    <>
      <button className={className} onClick={dlg.show}>{children}</button>
      {dlg.open ? (
        <Modal
          title={vehicle ? `${vehicle.plate} düzenle` : 'Yeni araç'}
          wide
          onClose={dlg.hide}
          onSubmit={(d) =>
            vehicle
              ? save('PUT', `/api/vehicles/${vehicle.id}`, d, 'Araç kaydedildi')
              : save<Vehicle>('POST', '/api/vehicles', d, 'Araç kaydedildi', (r) => `/vehicles/${r.id}`)
          }
        >
          <div className="form-grid">
            <Field label="Plaka *" className="c4"><input name="plate" defaultValue={v(x.plate)} required /></Field>
            <Field label="Marka *" className="c4"><input name="brand" defaultValue={v(x.brand)} required /></Field>
            <Field label="Model *" className="c4"><input name="model" defaultValue={v(x.model)} required /></Field>
            <Field label="Model yılı" className="c3"><input name="year" type="number" defaultValue={v(x.year)} /></Field>
            <Field label="Kategori" className="c3"><select name="category" defaultValue={x.category}><Options list={CATEGORIES} /></select></Field>
            <Field label="Yakıt" className="c3"><select name="fuel_type" defaultValue={x.fuel_type}><Options list={FUEL_TYPES} /></select></Field>
            <Field label="Vites" className="c3"><select name="transmission" defaultValue={x.transmission}><Options list={TRANSMISSIONS} /></select></Field>
            <Field label="Koltuk" className="c3"><input name="seats" type="number" defaultValue={v(x.seats)} /></Field>
            <Field label="Renk" className="c3"><input name="color" defaultValue={v(x.color)} /></Field>
            <Field label="Şasi no" className="c3"><input name="vin" defaultValue={v(x.vin)} /></Field>
            <Field label="Şube" className="c3"><select name="branch_id" defaultValue={v(x.branch_id)}><Options list={branchOpts} empty="Seçiniz" /></select></Field>
            <div className="form-section">Fiyat & kullanım</div>
            <Field label="Günlük fiyat (₺) *" className="c3"><input name="daily_rate" type="number" step="0.01" defaultValue={v(x.daily_rate)} required /></Field>
            <Field label="Depozito (₺)" className="c3"><input name="deposit_amount" type="number" step="0.01" defaultValue={v(x.deposit_amount)} /></Field>
            <Field label="Günlük km limiti (0 = sınırsız)" className="c3"><input name="km_limit_per_day" type="number" defaultValue={v(x.km_limit_per_day)} /></Field>
            <Field label="Km aşım ücreti (₺/km)" className="c3"><input name="extra_km_fee" type="number" step="0.01" defaultValue={v(x.extra_km_fee)} /></Field>
            <Field label="Güncel km" className="c3"><input name="current_km" type="number" defaultValue={v(x.current_km)} /></Field>
            <Field label="Sonraki bakım km" className="c3"><input name="next_service_km" type="number" defaultValue={v(x.next_service_km)} /></Field>
            <div className="form-section">Belgeler</div>
            <Field label="Trafik sigortası bitiş" className="c4"><input name="insurance_expiry" type="date" defaultValue={v(x.insurance_expiry)} /></Field>
            <Field label="Kasko bitiş" className="c4"><input name="kasko_expiry" type="date" defaultValue={v(x.kasko_expiry)} /></Field>
            <Field label="Muayene bitiş" className="c4"><input name="inspection_expiry" type="date" defaultValue={v(x.inspection_expiry)} /></Field>
            <Field label="Notlar" className="c12"><textarea name="notes" defaultValue={v(x.notes)} /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Müşteri ----------------

export function CustomerButton({
  customer, children, className, onSaved,
}: { customer?: Customer; children: ReactNode; className?: string; onSaved?: (c: Customer) => void }) {
  const dlg = useDialog();
  const save = useSaver();
  const toast = useToast();
  const x: Partial<Customer> = customer ?? { type: 'individual', nationality: 'TR', license_class: 'B' };
  const [type, setType] = useState(x.type);
  const submit = async (d: Record<string, unknown>) => {
    if (onSaved) {
      const r = await api<Customer>(customer ? 'PUT' : 'POST', customer ? `/api/customers/${customer.id}` : '/api/customers', d);
      toast('Müşteri kaydedildi');
      onSaved(r);
    } else if (customer) await save('PUT', `/api/customers/${customer.id}`, d, 'Müşteri kaydedildi');
    else await save<Customer>('POST', '/api/customers', d, 'Müşteri kaydedildi', (r) => `/customers/${r.id}`);
  };
  return (
    <>
      <button type="button" className={className} onClick={dlg.show}>{children}</button>
      {dlg.open ? (
        <Modal title={customer ? 'Müşteri düzenle' : 'Yeni müşteri'} wide onClose={dlg.hide} onSubmit={submit}>
          <div className="form-grid">
            <Field label="Müşteri tipi" className="c4">
              <select name="type" value={type} onChange={(e) => setType(e.target.value as Customer['type'])}>
                <Options list={[['individual', 'Bireysel'], ['corporate', 'Kurumsal']]} />
              </select>
            </Field>
            <Field label="Ad *" className="c4"><input name="first_name" defaultValue={v(x.first_name)} required /></Field>
            <Field label="Soyad *" className="c4"><input name="last_name" defaultValue={v(x.last_name)} required /></Field>
            {type === 'corporate' ? (
              <>
                <Field label="Firma unvanı" className="c4"><input name="company_name" defaultValue={v(x.company_name)} /></Field>
                <Field label="Vergi dairesi" className="c4"><input name="tax_office" defaultValue={v(x.tax_office)} /></Field>
                <Field label="Vergi no" className="c4"><input name="tax_no" defaultValue={v(x.tax_no)} /></Field>
              </>
            ) : null}
            <Field label="Telefon *" className="c4"><input name="phone" defaultValue={v(x.phone)} required /></Field>
            <Field label="E-posta" className="c4"><input name="email" type="email" defaultValue={v(x.email)} /></Field>
            <Field label="Doğum tarihi" className="c4"><input name="birth_date" type="date" defaultValue={v(x.birth_date)} /></Field>
            <Field label="T.C. kimlik no" className="c4"><input name="national_id" maxLength={11} defaultValue={v(x.national_id)} /></Field>
            <Field label="Pasaport no" className="c4"><input name="passport_no" defaultValue={v(x.passport_no)} /></Field>
            <Field label="Uyruk" className="c4"><input name="nationality" defaultValue={v(x.nationality)} /></Field>
            <div className="form-section">Ehliyet</div>
            <Field label="Ehliyet no" className="c4"><input name="license_no" defaultValue={v(x.license_no)} /></Field>
            <Field label="Sınıf" className="c4"><input name="license_class" defaultValue={v(x.license_class)} /></Field>
            <Field label="Veriliş tarihi" className="c4"><input name="license_date" type="date" defaultValue={v(x.license_date)} /></Field>
            <Field label="Adres" className="c12"><textarea name="address" defaultValue={v(x.address)} /></Field>
            <div className="form-section">Durum</div>
            <label className="check c4"><input type="checkbox" name="blacklisted" defaultChecked={!!x.blacklisted} /> Kara listede</label>
            <Field label="Kara liste nedeni" className="c8"><input name="blacklist_reason" defaultValue={v(x.blacklist_reason)} /></Field>
            <Field label="Notlar" className="c12"><textarea name="notes" defaultValue={v(x.notes)} /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Bakım ----------------

export function MaintenanceButton({
  record, vehicles, defaults = {}, children, className, asRow,
}: { record?: Maintenance; vehicles: VehicleOption[]; defaults?: Partial<Maintenance>; children: ReactNode; className?: string; asRow?: boolean }) {
  const dlg = useDialog();
  const save = useSaver();
  const x: Partial<Maintenance> = record ?? { type: 'periodic', status: 'scheduled', start_date: todayStr(), ...defaults };
  const trigger = asRow ? (
    <tr className="click" onClick={(e) => rowClick(e, dlg.show)}>{children}</tr>
  ) : (
    <button className={className} onClick={dlg.show}>{children}</button>
  );
  return (
    <>
      {trigger}
      {dlg.open ? (
        <Modal
          title={record ? 'Bakım kaydı' : 'Yeni bakım kaydı'}
          wide
          onClose={dlg.hide}
          onSubmit={(d) => (record ? save('PUT', `/api/maintenance/${record.id}`, d, 'Bakım kaydı kaydedildi') : save('POST', '/api/maintenance', d, 'Bakım kaydı kaydedildi'))}
        >
          <div className="form-grid">
            <Field label="Araç *" className="c6"><select name="vehicle_id" defaultValue={v(x.vehicle_id)} required><Options list={vehicles.map((o) => [o.id, o.label] as const)} empty="Araç seçin" /></select></Field>
            <Field label="Tip" className="c3"><select name="type" defaultValue={x.type}><Options list={textOptions('maintenanceType')} /></select></Field>
            <Field label="Durum" className="c3"><select name="status" defaultValue={x.status}><Options list={labelOptions('maintenanceStatus')} /></select></Field>
            <Field label="Başlangıç" className="c3"><input type="date" name="start_date" defaultValue={v(x.start_date)} /></Field>
            <Field label="Bitiş" className="c3"><input type="date" name="end_date" defaultValue={v(x.end_date)} /></Field>
            <Field label="Km" className="c3"><input type="number" name="km" defaultValue={v(x.km)} /></Field>
            <Field label="Maliyet (₺)" className="c3"><input type="number" step="0.01" name="cost" defaultValue={v(x.cost)} /></Field>
            <Field label="Servis / firma" className="c6"><input name="vendor" defaultValue={v(x.vendor)} /></Field>
            <Field label="Açıklama" className="c6"><input name="description" defaultValue={v(x.description)} /></Field>
            <div className="c12 muted small">
              &quot;Devam ediyor&quot; durumundaki bakım aracı <strong>Bakımda</strong> durumuna alır; planlanan bakımlar tarih aralığında
              rezervasyonu engeller. Tamamlandığında araç yeniden müsait olur.
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Hasar ----------------

export function DamageButton({
  record, vehicles, defaults = {}, children, className, asRow,
}: { record?: Damage; vehicles: VehicleOption[]; defaults?: Partial<Damage>; children: ReactNode; className?: string; asRow?: boolean }) {
  const dlg = useDialog();
  const save = useSaver();
  const x: Partial<Damage> = record ?? { severity: 'minor', status: 'open', reported_at: todayStr(), ...defaults };
  const trigger = asRow ? (
    <tr className="click" onClick={(e) => rowClick(e, dlg.show)}>{children}</tr>
  ) : (
    <button className={className} onClick={dlg.show}>{children}</button>
  );
  return (
    <>
      {trigger}
      {dlg.open ? (
        <Modal
          title={record ? 'Hasar kaydı' : 'Yeni hasar kaydı'}
          wide
          onClose={dlg.hide}
          onSubmit={(d) => (record ? save('PUT', `/api/damages/${record.id}`, d, 'Hasar kaydı kaydedildi') : save('POST', '/api/damages', d, 'Hasar kaydı kaydedildi'))}
        >
          <div className="form-grid">
            <Field label="Araç *" className="c6"><select name="vehicle_id" defaultValue={v(x.vehicle_id)} required><Options list={vehicles.map((o) => [o.id, o.label] as const)} empty="Araç seçin" /></select></Field>
            <Field label="Tarih" className="c3"><input type="date" name="reported_at" defaultValue={v(x.reported_at)} /></Field>
            <Field label="Önem" className="c3"><select name="severity" defaultValue={x.severity}><Options list={labelOptions('severity')} /></select></Field>
            <Field label="Konum" className="c4"><input name="location" defaultValue={v(x.location)} placeholder="Sol arka kapı" /></Field>
            <Field label="Açıklama *" className="c8"><input name="description" defaultValue={v(x.description)} required /></Field>
            <Field label="Onarım maliyeti (₺)" className="c3"><input type="number" step="0.01" name="repair_cost" defaultValue={v(x.repair_cost)} /></Field>
            <Field label="Müşteriye yansıyan (₺)" className="c3"><input type="number" step="0.01" name="customer_charge" defaultValue={v(x.customer_charge)} /></Field>
            <Field label="Durum" className="c3"><select name="status" defaultValue={x.status}><Options list={labelOptions('damageStatus')} /></select></Field>
            <label className="check c3"><input type="checkbox" name="insurance_claim" defaultChecked={!!x.insurance_claim} /> Sigorta/kasko dosyası</label>
            {x.rental_id ? <input type="hidden" name="rental_id" value={x.rental_id} /> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------- Masraf ----------------

export function ExpenseButton({
  record, vehicles, defaults = {}, children, className, asRow,
}: { record?: Expense; vehicles: VehicleOption[]; defaults?: Partial<Expense>; children: ReactNode; className?: string; asRow?: boolean }) {
  const dlg = useDialog();
  const save = useSaver();
  const x: Partial<Expense> = record ?? { category: 'Diğer', expense_date: todayStr(), ...defaults };
  const trigger = asRow ? (
    <tr className="click" onClick={(e) => rowClick(e, dlg.show)}>{children}</tr>
  ) : (
    <button className={className} onClick={dlg.show}>{children}</button>
  );
  return (
    <>
      {trigger}
      {dlg.open ? (
        <Modal
          title={record ? 'Masraf düzenle' : 'Yeni masraf'}
          onClose={dlg.hide}
          onSubmit={(d) => (record ? save('PUT', `/api/expenses/${record.id}`, d, 'Masraf kaydedildi') : save('POST', '/api/expenses', d, 'Masraf kaydedildi'))}
        >
          <div className="form-grid">
            <Field label="Kategori"><select name="category" defaultValue={x.category}><Options list={EXPENSE_CATEGORIES} /></select></Field>
            <Field label="Tarih"><input type="date" name="expense_date" defaultValue={v(x.expense_date)} /></Field>
            <Field label="Tutar (₺) *"><input type="number" step="0.01" name="amount" defaultValue={v(x.amount)} required /></Field>
            <Field label="Araç (opsiyonel)"><select name="vehicle_id" defaultValue={v(x.vehicle_id)}><Options list={vehicles.map((o) => [o.id, o.label] as const)} empty="Genel gider" /></select></Field>
            <Field label="Açıklama" className="c12"><input name="description" defaultValue={v(x.description)} /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
