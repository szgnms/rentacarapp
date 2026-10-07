'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../client/api';
import { Modal } from '../client/Modal';
import { useToast } from '../client/Toast';
import { Field, Options } from '../ui';
import type { Branch, Extra, Settings, User } from '@/lib/types';

function useRefresh(msg: string) {
  const router = useRouter();
  const toast = useToast();
  return () => {
    toast(msg);
    router.refresh();
  };
}

const v = (x: unknown) => (x === null || x === undefined ? '' : String(x));

type SettingField = [keyof Settings, string, 'text' | 'number' | 'textarea', string];

const SECTIONS: [string, SettingField[]][] = [
  ['Şirket', [
    ['company_name', 'Şirket adı', 'text', 'c4'],
    ['company_phone', 'Telefon', 'text', 'c4'],
    ['company_tax_no', 'Vergi no', 'text', 'c4'],
    ['company_address', 'Adres', 'text', 'c12'],
  ]],
  ['Fiyatlandırma', [
    ['grace_hours', 'Tolerans süresi (saat)', 'number', 'c3'],
    ['weekly_discount_pct', '7+ gün indirimi (%)', 'number', 'c3'],
    ['monthly_discount_pct', '30+ gün indirimi (%)', 'number', 'c3'],
    ['one_way_fee', 'Tek yön ücreti (₺)', 'number', 'c3'],
    ['fuel_price_per_eighth', 'Yakıt farkı (₺ / 1/8 depo)', 'number', 'c3'],
    ['late_fee_multiplier', 'Geç iade gün çarpanı', 'number', 'c3'],
    ['vat_rate', 'KDV oranı (%)', 'number', 'c3'],
  ]],
  ['Sürücü kuralları', [
    ['min_driver_age', 'Minimum sürücü yaşı', 'number', 'c3'],
    ['min_license_years', 'Minimum ehliyet yılı', 'number', 'c3'],
    ['contract_terms', 'Sözleşme genel şartları', 'textarea', 'c12'],
  ]],
];

export function SettingsForm({ settings, editable }: { settings: Settings; editable: boolean }) {
  const done = useRefresh('Ayarlar kaydedildi');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.currentTarget)));
      done();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <div className="card-body form-grid">
        {SECTIONS.map(([title, fields]) => (
          <div key={title} className="c12 form-grid" style={{ padding: 0 }}>
            <div className="form-section">{title}</div>
            {fields.map(([key, label, type, cls]) => (
              <Field key={key} label={label} className={cls}>
                {type === 'textarea' ? (
                  <textarea name={key} defaultValue={settings[key]} disabled={!editable} rows={5} />
                ) : (
                  <input name={key} type={type} step="any" defaultValue={settings[key]} disabled={!editable} />
                )}
              </Field>
            ))}
          </div>
        ))}
      </div>
      {editable ? (
        <div className="modal-foot">
          <button className="primary" type="submit" disabled={busy}>Kaydet</button>
        </div>
      ) : null}
    </form>
  );
}

function DialogButton({ label, className, children }: { label: ReactNode; className?: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>{label}</button>
      {open ? children(() => setOpen(false)) : null}
    </>
  );
}

export function BranchButton({ branch, label, className }: { branch?: Branch; label: ReactNode; className?: string }) {
  const done = useRefresh('Şube kaydedildi');
  return (
    <DialogButton label={label} className={className}>
      {(close) => (
        <Modal
          title={branch ? 'Şube düzenle' : 'Yeni şube'}
          onClose={close}
          onSubmit={async (d) => {
            await api(branch ? 'PUT' : 'POST', branch ? `/api/branches/${branch.id}` : '/api/branches', d);
            done();
          }}
        >
          <div className="form-grid">
            <Field label="Şube adı *"><input name="name" defaultValue={v(branch?.name)} required /></Field>
            <Field label="Şehir"><input name="city" defaultValue={v(branch?.city)} /></Field>
            <Field label="Telefon"><input name="phone" defaultValue={v(branch?.phone)} /></Field>
            <label className="check"><input type="checkbox" name="active" defaultChecked={!branch || !!branch.active} /> Aktif</label>
            <Field label="Adres" className="c12"><input name="address" defaultValue={v(branch?.address)} /></Field>
          </div>
        </Modal>
      )}
    </DialogButton>
  );
}

export function ExtraButton({ extra, label, className }: { extra?: Extra; label: ReactNode; className?: string }) {
  const done = useRefresh('Ek hizmet kaydedildi');
  return (
    <DialogButton label={label} className={className}>
      {(close) => (
        <Modal
          title={extra ? 'Ek hizmet düzenle' : 'Yeni ek hizmet'}
          onClose={close}
          onSubmit={async (d) => {
            await api(extra ? 'PUT' : 'POST', extra ? `/api/extras/${extra.id}` : '/api/extras', d);
            done();
          }}
        >
          <div className="form-grid">
            <Field label="Ad *"><input name="name" defaultValue={v(extra?.name)} required /></Field>
            <Field label="Fiyat tipi">
              <select name="price_type" defaultValue={extra?.price_type ?? 'daily'}><Options list={[['daily', 'Günlük'], ['per_rental', 'Kiralama başı']]} /></select>
            </Field>
            <Field label="Fiyat (₺)"><input type="number" step="0.01" name="price" defaultValue={v(extra?.price)} /></Field>
            <Field label="Üst limit (₺, opsiyonel)"><input type="number" step="0.01" name="max_price" defaultValue={v(extra?.max_price)} /></Field>
            <label className="check"><input type="checkbox" name="active" defaultChecked={!extra || !!extra.active} /> Aktif</label>
          </div>
        </Modal>
      )}
    </DialogButton>
  );
}

export function UserButton({ user, label, className }: { user?: User; label: ReactNode; className?: string }) {
  const done = useRefresh('Kullanıcı kaydedildi');
  return (
    <DialogButton label={label} className={className}>
      {(close) => (
        <Modal
          title={user ? `${user.username} düzenle` : 'Yeni kullanıcı'}
          onClose={close}
          onSubmit={async (d) => {
            await api(user ? 'PUT' : 'POST', user ? `/api/users/${user.id}` : '/api/users', d);
            done();
          }}
        >
          <div className="form-grid">
            {!user ? <Field label="Kullanıcı adı *"><input name="username" required /></Field> : null}
            <Field label="Ad soyad *"><input name="full_name" defaultValue={v(user?.full_name)} required /></Field>
            <Field label="Rol"><select name="role" defaultValue={user?.role ?? 'staff'}><Options list={[['staff', 'Personel'], ['admin', 'Yönetici']]} /></select></Field>
            <Field label={user ? 'Yeni şifre (boş = değişmez)' : 'Şifre * (en az 6 karakter)'}><input type="password" name="password" autoComplete="new-password" /></Field>
            <label className="check"><input type="checkbox" name="active" defaultChecked={!user || !!user.active} /> Aktif</label>
          </div>
        </Modal>
      )}
    </DialogButton>
  );
}

export function PasswordButton() {
  const toast = useToast();
  return (
    <DialogButton label="Şifremi değiştir" className="primary">
      {(close) => (
        <Modal
          title="Şifre değiştir"
          onClose={close}
          onSubmit={async (d) => {
            await api('POST', '/api/auth/password', d);
            toast('Şifre değiştirildi');
          }}
        >
          <div className="form-grid">
            <Field label="Mevcut şifre" className="c12"><input type="password" name="current_password" autoComplete="current-password" required /></Field>
            <Field label="Yeni şifre (en az 6 karakter)" className="c12"><input type="password" name="new_password" autoComplete="new-password" required /></Field>
          </div>
        </Modal>
      )}
    </DialogButton>
  );
}
