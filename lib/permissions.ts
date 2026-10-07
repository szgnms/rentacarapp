// Rol ve yetki matrisi (RBAC). İstemci tarafında da kullanılır; veritabanı bağımlılığı yoktur.
import type { Role } from './types';

export const PERMISSIONS = {
  'dashboard.view': 'Gösterge paneli',
  'reservations.write': 'Rezervasyon oluşturma/düzenleme',
  'reservations.cancel': 'Rezervasyon iptali',
  'customers.write': 'Müşteri kaydı',
  'customers.pii': 'Kişisel veri ihracı/anonimleştirme',
  'rentals.operate': 'Teslim/iade, sözleşme işlemleri',
  'rentals.cancel': 'Sözleşme iptali',
  'payments.collect': 'Tahsilat',
  'payments.refund': 'İade/depozito iadesi',
  'payments.delete': 'Ödeme kaydı silme',
  'finance.manage': 'Fatura, cari, yaşlandırma',
  'fleet.write': 'Araç, belge, transfer',
  'maintenance.write': 'Bakım, hasar dosyası',
  'expenses.write': 'Masraf kaydı',
  'pricing.manage': 'Fiyat tabloları, kupon, kanal',
  'tolls.manage': 'HGS/OGS geçişleri',
  'fines.manage': 'Trafik cezaları',
  'kabis.manage': 'KABİS bildirimleri',
  'notifications.manage': 'Bildirim şablonları ve gönderimler',
  'tasks.manage': 'İş emirleri',
  'reports.view': 'Raporlar',
  'approve': 'Onay verme (indirim, depozito iadesi, hasar affı)',
  'records.delete': 'Kayıt silme',
  'settings.manage': 'Sistem ayarları, şablonlar, şubeler',
  'users.manage': 'Kullanıcı ve yetki',
  'audit.view': 'Denetim izi',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Süper Admin',
  branch_manager: 'Bölge/Şube Müdürü',
  reservation: 'Rezervasyon / Çağrı Merkezi',
  field: 'Saha Personeli (Teslim/İade)',
  accounting: 'Muhasebe',
  fleet: 'Filo / Bakım',
  staff: 'Genel Personel',
};

const ALL = Object.keys(PERMISSIONS) as Permission[];

const MATRIX: Record<Role, Permission[]> = {
  admin: ALL,
  branch_manager: ALL.filter((p) => !['settings.manage', 'users.manage'].includes(p)),
  reservation: ['dashboard.view', 'reservations.write', 'reservations.cancel', 'customers.write', 'payments.collect', 'tasks.manage'],
  field: ['dashboard.view', 'rentals.operate', 'payments.collect', 'customers.write', 'tasks.manage', 'maintenance.write'],
  accounting: [
    'dashboard.view', 'payments.collect', 'payments.refund', 'payments.delete', 'finance.manage', 'tolls.manage', 'fines.manage',
    'reports.view', 'customers.write', 'kabis.manage', 'expenses.write', 'customers.pii',
  ],
  fleet: ['dashboard.view', 'fleet.write', 'maintenance.write', 'expenses.write', 'tolls.manage', 'fines.manage', 'tasks.manage', 'reports.view'],
  staff: [
    'dashboard.view', 'reservations.write', 'reservations.cancel', 'customers.write', 'rentals.operate', 'payments.collect',
    'fleet.write', 'maintenance.write', 'expenses.write', 'tasks.manage', 'reports.view', 'kabis.manage',
  ],
};

export function can(user: { role: Role } | null | undefined, perm: Permission): boolean {
  if (!user) return false;
  return (MATRIX[user.role] ?? []).includes(perm);
}

export const permissionsOf = (role: Role) => MATRIX[role] ?? [];

/** Şube kapsamı: yönetici dışındaki şubeye bağlı kullanıcılar yalnızca kendi şubesini görür. */
export const scopedBranch = (user: { role: Role; branch_id?: number | null }) =>
  user.role !== 'admin' && user.branch_id ? user.branch_id : null;
