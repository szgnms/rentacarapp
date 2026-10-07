// İstemci ve sunucuda ortak kullanılan biçimlendirme ve etiketler (veritabanı bağımlılığı yok).

const moneyFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => moneyFmt.format(Number(n) || 0);
export const numf = (n: number | null | undefined) => new Intl.NumberFormat('tr-TR').format(Number(n) || 0);

/** "YYYY-MM-DDTHH:MM" veya "YYYY-MM-DD HH:MM:SS" → "GG.AA.YYYY SS:DD" */
export function dt(s: string | null | undefined): string {
  if (!s) return '—';
  const [date, time] = String(s).split(/[T ]/);
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}${time ? ' ' + time.slice(0, 5) : ''}`;
}
export const d = (s: string | null | undefined) => (s ? dt(String(s).slice(0, 10)) : '—');

const pad = (n: number) => String(n).padStart(2, '0');
export const localInput = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
export const todayStr = () => localInput().slice(0, 10);
export function addDaysStr(n: number, hour?: number) {
  const x = new Date();
  x.setDate(x.getDate() + n);
  if (hour !== undefined) x.setHours(hour, 0, 0, 0);
  return localInput(x);
}
export function shiftDate(date: string, n: number) {
  const x = new Date(date + 'T00:00');
  x.setDate(x.getDate() + n);
  return localInput(x).slice(0, 10);
}

export const FUEL = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n}/8`);

export function qs(obj: Record<string, string | number | undefined | null>) {
  return new URLSearchParams(
    Object.entries(obj)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}

export function customerName(c: { type?: string; company_name?: string | null; first_name: string; last_name: string } | null | undefined) {
  if (!c) return '';
  return c.type === 'corporate' && c.company_name ? `${c.company_name} (${c.first_name} ${c.last_name})` : `${c.first_name} ${c.last_name}`;
}

export type Tone = '' | 'ok' | 'warn' | 'danger' | 'info' | 'violet';
type Labeled = Record<string, readonly [string, Tone]>;

export const LABELS = {
  vehicleStatus: {
    available: ['Müsait', 'ok'], rented: ['Kirada', 'info'], maintenance: ['Serviste', 'warn'], damaged: ['Hasarlı', 'danger'],
    in_transfer: ['Transferde', 'violet'], for_sale: ['Satılık', ''], out_of_service: ['Hizmet dışı', 'danger'], sold: ['Satıldı', ''],
  },
  reservationStatus: {
    pending: ['Opsiyonlu / Beklemede', 'warn'], confirmed: ['Onaylı', 'info'], waitlist: ['Bekleme listesi', 'violet'],
    cancelled: ['İptal', 'danger'], no_show: ['Gelmedi', 'danger'], converted: ['Teslim edildi', 'ok'],
  },
  rentalStatus: {
    draft: ['Taslak (teslim sürüyor)', 'warn'], active: ['Aktif', 'info'], returned: ['İade alındı', 'violet'], closed: ['Kapandı', 'ok'],
    cancelled: ['İptal', 'danger'], overdue: ['Gecikmiş', 'danger'],
  },
  maintenanceStatus: { scheduled: ['Planlandı', 'violet'], in_progress: ['Devam ediyor', 'warn'], completed: ['Tamamlandı', 'ok'], cancelled: ['İptal', ''] },
  damageStatus: { open: ['Açık', 'danger'], repaired: ['Onarıldı', 'ok'], closed: ['Kapatıldı', ''] },
  severity: { minor: ['Hafif', ''], moderate: ['Orta', 'warn'], major: ['Ağır', 'danger'] },
  paymentType: { payment: ['Tahsilat', 'ok'], refund: ['İade', 'danger'], deposit_in: ['Depozito alındı', 'violet'], deposit_out: ['Depozito iade', ''] },
} as const satisfies Record<string, Labeled>;

export type LabelGroup = keyof typeof LABELS;

export const TEXT = {
  maintenanceType: { periodic: 'Periyodik bakım', repair: 'Onarım', tire: 'Lastik', inspection: 'Muayene', damage_repair: 'Hasar onarımı', other: 'Diğer' },
  method: {
    cash: 'Nakit', credit_card: 'Kredi kartı (sanal POS)', pos: 'Mobil POS', payment_link: 'Ödeme linki', bank_transfer: 'Havale/EFT',
    preauth: 'Kart provizyonu', deposit: 'Depozitodan',
  },
  chargeType: {
    late_return: 'Geç iade', extra_km: 'Km aşımı', fuel: 'Yakıt', damage: 'Hasar', cleaning: 'Temizlik', traffic_fine: 'Trafik cezası', hgs: 'HGS/OGS',
    missing_equipment: 'Kayıp ekipman', different_branch: 'Farklı şube iadesi', service_fee: 'Hizmet bedeli', other: 'Diğer',
  },
} as const;

export const labelText = (group: LabelGroup, key: string) => (LABELS[group] as Labeled)[key]?.[0] ?? key;
export const text = (group: keyof typeof TEXT, key: string | null | undefined) =>
  key ? ((TEXT[group] as Record<string, string>)[key] ?? key) : '—';

/** [value, label] seçenek listeleri */
export const labelOptions = (group: LabelGroup): [string, string][] => Object.entries(LABELS[group]).map(([k, v]) => [k, v[0]]);
export const textOptions = (group: keyof typeof TEXT): [string, string][] => Object.entries(TEXT[group]);

export const PAY_METHODS: [string, string][] = [
  ['credit_card', 'Kredi kartı (sanal POS)'], ['pos', 'Mobil POS'], ['cash', 'Nakit'], ['bank_transfer', 'Havale/EFT'], ['payment_link', 'Ödeme linki'],
];
export const DEPOSIT_METHODS: [string, string][] = [['preauth', 'Kart provizyonu'], ...PAY_METHODS];
