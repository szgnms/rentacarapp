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

type SettingField = [keyof Settings, string, 'text' | 'number' | 'textarea' | 'password' | readonly (readonly [string, string])[], string];

const SECTIONS: [string, SettingField[]][] = [
  ['Şirket (sözleşme, fatura ve bildirimlerde kullanılır)', [
    ['company_name', 'Şirket unvanı', 'text', 'c4'],
    ['company_phone', 'Telefon', 'text', 'c4'],
    ['company_email', 'E-posta', 'text', 'c4'],
    ['company_tax_office', 'Vergi dairesi', 'text', 'c4'],
    ['company_tax_no', 'Vergi no', 'text', 'c4'],
    ['company_iban', 'IBAN', 'text', 'c4'],
    ['company_address', 'Adres', 'text', 'c12'],
  ]],
  ['Fiyatlandırma & ücretler', [
    ['grace_hours', 'Tolerans süresi (saat)', 'number', 'c3'],
    ['weekly_discount_pct', '7+ gün indirimi (%) — tarife yoksa', 'number', 'c3'],
    ['monthly_discount_pct', '30+ gün indirimi (%) — tarife yoksa', 'number', 'c3'],
    ['vat_rate', 'KDV oranı (%)', 'number', 'c3'],
    ['one_way_fee', 'Tek yön ücreti (₺)', 'number', 'c3'],
    ['different_branch_fee', 'Habersiz farklı şube iadesi (₺)', 'number', 'c3'],
    ['young_driver_age', 'Genç sürücü yaş sınırı', 'number', 'c3'],
    ['young_driver_fee_daily', 'Genç sürücü ücreti (₺/gün)', 'number', 'c3'],
    ['late_fee_mode', 'Geç iade hesabı', [['daily', 'Gün bazlı'], ['hourly', 'Saatlik (% günlük)']], 'c3'],
    ['late_fee_multiplier', 'Geç iade gün çarpanı', 'number', 'c3'],
    ['late_fee_hourly_pct', 'Saatlik geç iade (% günlük fiyat)', 'number', 'c3'],
    ['cleaning_fee', 'Temizlik ücreti (₺)', 'number', 'c3'],
    ['fuel_price_per_liter', 'Yakıt litre fiyatı (₺)', 'number', 'c3'],
    ['fuel_price_per_eighth', 'Yakıt farkı (₺ / 1/8 depo) — yedek', 'number', 'c3'],
    ['fuel_service_fee', 'Yakıt hizmet bedeli (₺)', 'number', 'c3'],
  ]],
  ['Rezervasyon politikası', [
    ['option_hours', 'Opsiyon süresi (saat)', 'number', 'c3'],
    ['free_cancel_hours', 'Ücretsiz iptal (alıştan önce, saat)', 'number', 'c3'],
    ['cancel_fee_pct', 'Geç iptal ücreti (% toplam)', 'number', 'c3'],
    ['no_show_fee_days', 'No-show ücreti (gün)', 'number', 'c3'],
  ]],
  ['Depozito, HGS & cezalar', [
    ['deposit_hold_days', 'İade sonrası depozito tutma (gün)', 'number', 'c3'],
    ['field_payment_limit', 'Saha tahsilat limiti (₺)', 'number', 'c3'],
    ['hgs_service_fee', 'HGS hizmet bedeli (₺)', 'number', 'c3'],
    ['hgs_low_balance', 'Düşük HGS bakiye uyarısı (₺)', 'number', 'c3'],
    ['fine_service_fee', 'Ceza hizmet bedeli (₺)', 'number', 'c3'],
    ['fine_discount_days', 'İndirimli ceza ödeme süresi (gün)', 'number', 'c3'],
    ['fine_limitation_days', 'Ceza zamanaşımı (gün)', 'number', 'c3'],
  ]],
  ['Sürücü kuralları & sözleşme', [
    ['min_driver_age', 'Minimum sürücü yaşı', 'number', 'c3'],
    ['min_license_years', 'Minimum ehliyet yılı', 'number', 'c3'],
    ['contract_terms', 'Sözleşme genel şartları (şablon yoksa)', 'textarea', 'c12'],
    ['equipment_items', 'Ekipman kontrol listesi (her satır "Ad:eksik ücreti")', 'textarea', 'c12'],
  ]],
  ['Entegrasyonlar', [
    ['kabis_mode', 'KABİS modu', [['manual', 'Manuel (EGM referansı girilir)'], ['simulate', 'Simülasyon']], 'c4'],
    ['invoice_prefix', 'e-Arşiv fatura seri öneki', 'text', 'c4'],
    ['public_base_url', 'Müşteri portalı adresi (https://…)', 'text', 'c4'],
    ['notify_auto', 'Otomatik hatırlatmalar', [['1', 'Açık'], ['0', 'Kapalı']], 'c3'],
    ['smtp_host', 'SMTP sunucu', 'text', 'c3'],
    ['smtp_port', 'SMTP port', 'number', 'c2'],
    ['smtp_user', 'SMTP kullanıcı', 'text', 'c2'],
    ['smtp_pass', 'SMTP şifre', 'password', 'c2'],
    ['smtp_from', 'Gönderen adresi', 'text', 'c4'],
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
                {typeof type !== 'string' ? (
                  <select name={key} defaultValue={settings[key]} disabled={!editable}><Options list={type} /></select>
                ) : type === 'textarea' ? (
                  <textarea name={key} defaultValue={settings[key]} disabled={!editable} rows={5} />
                ) : (
                  <input name={key} type={type as string} step="any" defaultValue={type === 'password' ? '' : settings[key]} placeholder={type === 'password' && settings[key] ? '•••••• (değişmez)' : undefined} disabled={!editable} />
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
            <Field label="Kod (özel kural)">
              <select name="code" defaultValue={v(extra?.code)}>
                <Options
                  empty="— Yok —"
                  list={[['unlimited_km', 'Sınırsız km'], ['ldw', 'Hasar muafiyeti (LDW/CDW)'], ['delivery', 'Adrese teslim'], ['additional_driver', 'Ek sürücü'], ['child_seat', 'Çocuk koltuğu'], ['gps', 'Navigasyon']]}
                />
              </select>
            </Field>
            <Field label="Açıklama" className="c12"><input name="description" defaultValue={v(extra?.description)} /></Field>
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

export function UserButton({
  user, label, className, roles, branches,
}: { user?: User; label: ReactNode; className?: string; roles: Record<string, string>; branches: Branch[] }) {
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
            <Field label="Rol"><select name="role" defaultValue={user?.role ?? 'staff'}><Options list={Object.entries(roles)} /></select></Field>
            <Field label="Şube (boş = tüm şubeler)">
              <select name="branch_id" defaultValue={v(user?.branch_id)}><Options list={branches.map((b) => [b.id, b.name] as const)} empty="Tüm şubeler" /></select>
            </Field>
            <Field label="İndirim yetki limiti (%)"><input type="number" name="discount_limit_pct" defaultValue={v(user?.discount_limit_pct ?? 10)} /></Field>
            <Field label="E-posta"><input type="email" name="email" defaultValue={v(user?.email)} /></Field>
            <Field label="Telefon"><input name="phone" defaultValue={v(user?.phone)} /></Field>
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
