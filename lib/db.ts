import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './password';
import { migrate } from './migrations';
import type { Settings } from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL UNIQUE,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  category TEXT NOT NULL DEFAULT 'Ekonomi',
  fuel_type TEXT NOT NULL DEFAULT 'Benzin',
  transmission TEXT NOT NULL DEFAULT 'Manuel',
  seats INTEGER DEFAULT 5,
  color TEXT,
  vin TEXT,
  daily_rate REAL NOT NULL DEFAULT 0,
  deposit_amount REAL NOT NULL DEFAULT 0,
  current_km INTEGER NOT NULL DEFAULT 0,
  km_limit_per_day INTEGER NOT NULL DEFAULT 0,
  extra_km_fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','rented','maintenance','out_of_service')),
  branch_id INTEGER REFERENCES branches(id),
  insurance_expiry TEXT,
  kasko_expiry TEXT,
  inspection_expiry TEXT,
  next_service_km INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'individual' CHECK (type IN ('individual','corporate')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company_name TEXT,
  tax_office TEXT,
  tax_no TEXT,
  national_id TEXT,
  passport_no TEXT,
  nationality TEXT DEFAULT 'TR',
  birth_date TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  license_no TEXT,
  license_class TEXT,
  license_date TEXT,
  blacklisted INTEGER NOT NULL DEFAULT 0,
  blacklist_reason TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price_type TEXT NOT NULL DEFAULT 'daily' CHECK (price_type IN ('daily','per_rental')),
  price REAL NOT NULL DEFAULT 0,
  max_price REAL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  pickup_branch_id INTEGER REFERENCES branches(id),
  return_branch_id INTEGER REFERENCES branches(id),
  pickup_at TEXT NOT NULL,
  return_at TEXT NOT NULL,
  days INTEGER NOT NULL,
  daily_rate REAL NOT NULL,
  base_amount REAL NOT NULL,
  long_term_discount REAL NOT NULL DEFAULT 0,
  extras_amount REAL NOT NULL DEFAULT 0,
  one_way_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  deposit_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','no_show','converted')),
  source TEXT DEFAULT 'Ofis',
  cancel_reason TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS reservation_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  extra_id INTEGER NOT NULL REFERENCES extras(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_no TEXT NOT NULL UNIQUE,
  reservation_id INTEGER REFERENCES reservations(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  pickup_branch_id INTEGER REFERENCES branches(id),
  return_branch_id INTEGER REFERENCES branches(id),
  pickup_at TEXT NOT NULL,
  planned_return_at TEXT NOT NULL,
  actual_return_at TEXT,
  start_km INTEGER NOT NULL,
  end_km INTEGER,
  start_fuel INTEGER NOT NULL DEFAULT 8,
  end_fuel INTEGER,
  days INTEGER NOT NULL,
  daily_rate REAL NOT NULL,
  base_amount REAL NOT NULL,
  long_term_discount REAL NOT NULL DEFAULT 0,
  extras_amount REAL NOT NULL DEFAULT 0,
  one_way_fee REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  charges_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  deposit_amount REAL NOT NULL DEFAULT 0,
  additional_driver TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  checkout_notes TEXT,
  checkin_notes TEXT,
  created_by INTEGER REFERENCES users(id),
  closed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rental_extras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  extra_id INTEGER NOT NULL REFERENCES extras(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS rental_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('late_return','extra_km','fuel','damage','cleaning','traffic_fine','hgs','other')),
  description TEXT,
  amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  rental_id INTEGER REFERENCES rentals(id),
  reservation_id INTEGER REFERENCES reservations(id),
  type TEXT NOT NULL CHECK (type IN ('payment','refund','deposit_in','deposit_out')),
  method TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash','credit_card','bank_transfer','deposit')),
  amount REAL NOT NULL CHECK (amount > 0),
  paid_at TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS maintenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  type TEXT NOT NULL DEFAULT 'periodic'
    CHECK (type IN ('periodic','repair','tire','inspection','damage_repair','other')),
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  km INTEGER,
  cost REAL NOT NULL DEFAULT 0,
  vendor TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS damages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  rental_id INTEGER REFERENCES rentals(id),
  reported_at TEXT NOT NULL,
  location TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','moderate','major')),
  repair_cost REAL NOT NULL DEFAULT 0,
  customer_charge REAL NOT NULL DEFAULT 0,
  insurance_claim INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','repaired','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id),
  category TEXT NOT NULL,
  amount REAL NOT NULL CHECK (amount >= 0),
  expense_date TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_res_vehicle ON reservations(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_rent_vehicle ON rentals(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_pay_rental ON payments(rental_id);
CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);
`;


export const DEFAULT_SETTINGS: Settings = {
  company_name: 'Rent A Car',
  company_phone: '',
  company_email: '',
  company_address: '',
  company_tax_no: '',
  company_tax_office: '',
  company_iban: '',
  currency: 'TRY',
  grace_hours: '2',
  weekly_discount_pct: '10',
  monthly_discount_pct: '20',
  one_way_fee: '1500',
  fuel_price_per_eighth: '350',
  fuel_price_per_liter: '45',
  fuel_service_fee: '250',
  cleaning_fee: '750',
  min_driver_age: '21',
  min_license_years: '2',
  young_driver_age: '25',
  young_driver_fee_daily: '200',
  late_fee_mode: 'daily',
  late_fee_multiplier: '1',
  late_fee_hourly_pct: '15',
  vat_rate: '20',
  contract_terms:
    'Kiracı, aracı teslim aldığı durumda ve belirtilen tarihte iade etmeyi kabul eder. ' +
    'Trafik cezaları, HGS/OGS geçiş ücretleri ve kiracı kusurundan doğan hasarlar kiracıya aittir. ' +
    'Araç alkollü ya da ehliyetsiz kişilerce kullanılamaz, üçüncü kişilere kiralanamaz.',
  equipment_items: [
    'Yangın söndürücü:600', 'Üçgen reflektör:300', 'İlk yardım çantası:350', 'Stepne:2500', 'Kriko:800',
    'Paspas takımı:400', 'HGS etiketi:100', 'Ruhsat fotokopisi:0', 'Şarj/AUX kablosu:250',
  ].join('\n'),
  different_branch_fee: '1500',
  free_cancel_hours: '48',
  cancel_fee_pct: '20',
  no_show_fee_days: '1',
  option_hours: '24',
  hgs_service_fee: '50',
  fine_service_fee: '150',
  hgs_low_balance: '200',
  deposit_hold_days: '30',
  field_payment_limit: '25000',
  fine_discount_days: '15',
  fine_limitation_days: '730',
  kabis_mode: 'manual',
  invoice_prefix: 'ARS',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  notify_auto: '1',
  public_base_url: 'http://localhost:3000',
};

type Param = SQLInputValue;

const g = globalThis as unknown as { __rentacarDb?: DatabaseSync };

/**
 * Veritabanı dosyası: DB_FILE, yoksa data/rentacar.db.
 * Vercel gibi salt-okunur dosya sistemli sunucusuz ortamlarda yalnızca /tmp yazılabilir (geçici!).
 */
export function defaultDbFile(): string {
  if (process.env.DB_FILE) return process.env.DB_FILE;
  if (process.env.VERCEL) return path.join('/tmp', 'rentacar', 'rentacar.db');
  return path.join(process.cwd(), 'data', 'rentacar.db');
}

/** Opens (or reopens) the database. */
export function openDb(file = defaultDbFile()): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA);
  migrate(db);
  g.__rentacarDb = db;
  bootstrap(db);
  return db;
}

export function getDb(): DatabaseSync {
  return g.__rentacarDb ?? openDb();
}

// node:sqlite satırları null-prototype nesnelerdir; React (Server → Client) ve JSON için düz nesneye çevrilir.
export function one<T>(sql: string, ...params: Param[]): T | undefined {
  const row = getDb().prepare(sql).get(...params);
  return row ? ({ ...row } as T) : undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r }) as T);
}

export function run(sql: string, ...params: Param[]) {
  return getDb().prepare(sql).run(...params);
}

/** Scalar helper: first column of the first row (or the fallback). */
export function scalar<T = number>(sql: string, ...params: Param[]): T {
  const row = getDb().prepare(sql).get(...params) as Record<string, unknown> | undefined;
  return (row ? Object.values(row)[0] : undefined) as T;
}

let txDepth = 0;
/** Runs fn inside a transaction; rolls back on error. Nested calls join the outer transaction. */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  const db = getDb();
  db.exec('BEGIN');
  txDepth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

type Row = Record<string, Param | undefined>;

export function insertRow(table: string, data: Row): number {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const r = getDb()
    .prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map((k) => data[k] as Param));
  return Number(r.lastInsertRowid);
}

export function updateRow(table: string, id: number, data: Row): void {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  getDb()
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => data[k] as Param), id);
}

export function getSettings(): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of all<{ key: keyof Settings; value: string }>('SELECT key, value FROM settings')) {
    if (r.key in s) s[r.key] = r.value ?? '';
  }
  return s;
}

function bootstrap(db: DatabaseSync) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  if (count('SELECT COUNT(*) AS n FROM users') === 0) {
    db.prepare('INSERT INTO users(username, password_hash, full_name, role) VALUES (?,?,?,?)').run(
      'admin',
      hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
      'Sistem Yöneticisi',
      'admin',
    );
  }
  if (count('SELECT COUNT(*) AS n FROM branches') === 0) {
    db.prepare('INSERT INTO branches(name, city) VALUES (?, ?)').run('Merkez Ofis', 'İstanbul');
  }
  if (count('SELECT COUNT(*) AS n FROM extras') === 0) {
    const ins = db.prepare('INSERT INTO extras(name, price_type, price, max_price) VALUES (?,?,?,?)');
    ins.run('Bebek Koltuğu', 'daily', 150, 1500);
    ins.run('Navigasyon', 'daily', 100, 1000);
    ins.run('Ek Sürücü', 'per_rental', 500, null);
    ins.run('Mini Hasar Sigortası', 'daily', 250, null);
    ins.run('Kar Zinciri', 'per_rental', 300, null);
  }
  // Özel davranışlı ek hizmetler (kodla tanınır)
  const coded: [string, string, string, number][] = [
    ['unlimited_km', 'Sınırsız km', 'daily', 300],
    ['full_coverage', 'Tam kasko paketi (LDW/SCDW)', 'daily', 450],
    ['delivery', 'Ofis dışı teslim / adrese teslim', 'per_rental', 750],
    ['additional_driver', 'Ek sürücü', 'per_rental', 500],
  ];
  for (const [code, name, type, price] of coded) {
    if (!db.prepare('SELECT 1 FROM extras WHERE code = ?').get(code)) {
      const existing = db.prepare('SELECT id FROM extras WHERE name = ? AND code IS NULL').get(name === 'Ek sürücü' ? 'Ek Sürücü' : name) as { id: number } | undefined;
      if (existing) db.prepare('UPDATE extras SET code = ? WHERE id = ?').run(code, existing.id);
      else db.prepare('INSERT INTO extras(name, price_type, price, code) VALUES (?,?,?,?)').run(name, type, price, code);
    }
  }
  if (count('SELECT COUNT(*) AS n FROM channels') === 0) {
    const ins = db.prepare('INSERT INTO channels(code, name, markup_pct, commission_pct) VALUES (?,?,?,?)');
    for (const [code, name, markup, comm] of [
      ['Ofis', 'Ofis / Şube', 0, 0], ['Telefon', 'Çağrı merkezi', 0, 0], ['Web', 'Web sitesi', -5, 0],
      ['Acente', 'Acente (B2B)', 0, 10], ['Kurumsal', 'Kurumsal sözleşme', -10, 0], ['Marketplace', 'Marketplace', 10, 15],
    ] as [string, string, number, number][]) ins.run(code, name, markup, comm);
  }
  if (count('SELECT COUNT(*) AS n FROM contract_templates') === 0) {
    const ins = db.prepare('INSERT INTO contract_templates(name, language, body) VALUES (?,?,?)');
    for (const [lang, name, body] of CONTRACT_TEMPLATES) ins.run(name, lang, body);
  }
  if (count('SELECT COUNT(*) AS n FROM notification_templates') === 0) {
    const ins = db.prepare('INSERT INTO notification_templates(code, channel, subject, body, marketing) VALUES (?,?,?,?,?)');
    for (const t of NOTIFICATION_TEMPLATES) ins.run(t[0], t[1], t[2], t[3], t[4] ?? 0);
  }
}

const CONTRACT_TEMPLATES: [string, string, string][] = [
  ['tr', 'Standart kira sözleşmesi', [
    '1. Kiracı, {{plate}} plakalı aracı {{pickup_at}} tarihinde teslim almış olup {{return_at}} tarihinde {{return_branch}} şubesine iade etmeyi kabul eder.',
    '2. Araç teslim tutanağındaki fotoğraflar, hasar şeması, kilometre ({{start_km}}) ve yakıt ({{start_fuel}}) bilgileri taraflarca kabul edilmiştir.',
    '3. Kira süresince oluşan trafik cezaları, HGS/OGS ve köprü-otoyol geçiş ücretleri hizmet bedeli ile birlikte kiracıya yansıtılır; sözleşme kapandıktan sonra gelen kayıtlar da bu kapsamdadır.',
    '4. Geç iade, km aşımı ({{km_limit}}), eksik yakıt, temizlik, kayıp ekipman ve kiracı kusurundan doğan hasarlar ayrıca ücretlendirilir.',
    '5. Araç alkollü, uyuşturucu etkisi altında veya ehliyetsiz kişilerce kullanılamaz; sözleşmede adı geçmeyen kişilere kullandırılamaz, yurt dışına çıkarılamaz.',
    '6. Depozito ({{deposit}}) kira bitiminde mahsuplaşma sonrası iade edilir; bekleyen HGS/ceza kayıtları için en fazla {{hold_days}} gün kısmen tutulabilir.',
    '7. Kişisel veriler 6698 sayılı KVKK kapsamında aydınlatma metnine uygun olarak işlenir; 1774 sayılı Kanun gereği kiralama bilgileri KABİS üzerinden kolluğa bildirilir.',
  ].join('\n')],
  ['en', 'Standard rental agreement', [
    '1. The renter received vehicle {{plate}} on {{pickup_at}} and agrees to return it to {{return_branch}} on {{return_at}}.',
    '2. Photos, damage diagram, odometer ({{start_km}}) and fuel ({{start_fuel}}) recorded at handover are accepted by both parties.',
    '3. Traffic fines, toll (HGS/OGS) and bridge/motorway charges incurred during the rental are charged to the renter with a service fee, including those received after closing.',
    '4. Late return, excess mileage ({{km_limit}}), missing fuel, cleaning, missing equipment and damages caused by the renter are charged separately.',
    '5. The vehicle may not be driven under the influence or by unlicensed or unlisted drivers and may not leave the country.',
    '6. The deposit ({{deposit}}) is refunded after settlement; up to {{hold_days}} days may be held for pending toll/fine records.',
    '7. Personal data is processed under Turkish Data Protection Law (KVKK) and reported to the police via KABİS as required by Law No. 1774.',
  ].join('\n')],
  ['de', 'Standard-Mietvertrag', [
    '1. Der Mieter hat das Fahrzeug {{plate}} am {{pickup_at}} übernommen und gibt es am {{return_at}} in {{return_branch}} zurück.',
    '2. Fotos, Schadensskizze, Kilometerstand ({{start_km}}) und Tankfüllung ({{start_fuel}}) bei Übergabe werden von beiden Parteien anerkannt.',
    '3. Verkehrsstrafen und Mautgebühren (HGS/OGS) während der Mietzeit werden zzgl. Bearbeitungsgebühr dem Mieter belastet.',
    '4. Verspätete Rückgabe, Mehrkilometer ({{km_limit}}), fehlender Kraftstoff, Reinigung, fehlende Ausrüstung und vom Mieter verursachte Schäden werden gesondert berechnet.',
    '5. Das Fahrzeug darf nicht unter Alkoholeinfluss, ohne Führerschein oder von nicht eingetragenen Fahrern gefahren werden.',
    '6. Die Kaution ({{deposit}}) wird nach Abrechnung erstattet; bis zu {{hold_days}} Tage können für offene Maut-/Strafposten einbehalten werden.',
  ].join('\n')],
  ['ru', 'Стандартный договор аренды', [
    '1. Арендатор получил автомобиль {{plate}} {{pickup_at}} и обязуется вернуть его {{return_at}} в отделение {{return_branch}}.',
    '2. Фотографии, схема повреждений, пробег ({{start_km}}) и уровень топлива ({{start_fuel}}) при выдаче признаются сторонами.',
    '3. Штрафы и платные дороги (HGS/OGS) за период аренды взимаются с арендатора вместе с сервисным сбором.',
    '4. Поздний возврат, перепробег ({{km_limit}}), недостаток топлива, чистка, утеря оборудования и повреждения оплачиваются отдельно.',
    '5. Запрещено управление в состоянии опьянения, без прав или лицами, не указанными в договоре.',
    '6. Депозит ({{deposit}}) возвращается после расчёта; до {{hold_days}} дней может удерживаться для неоплаченных штрафов/HGS.',
  ].join('\n')],
];

const NOTIFICATION_TEMPLATES: [string, string, string | null, string, number?][] = [
  ['reservation_confirmed', 'email', 'Rezervasyonunuz onaylandı · {{code}}',
    'Sayın {{customer_name}},\n\n{{code}} numaralı rezervasyonunuz onaylanmıştır.\nAraç grubu: {{category}}\nAlış: {{pickup_at}} · {{pickup_branch}}\nDönüş: {{return_at}} · {{return_branch}}\nToplam: {{total}}\n\nOnline check-in ve rezervasyon detayları: {{portal_url}}\n\n{{company_name}}'],
  ['reservation_confirmed', 'sms', null, '{{company_name}}: {{code}} rezervasyonunuz onaylandi. Alis {{pickup_at}} {{pickup_branch}}. Detay: {{portal_url}}'],
  ['pickup_reminder', 'sms', null, '{{company_name}}: Yarin {{pickup_at}} aracinizi {{pickup_branch}} subesinden teslim alacaksiniz. Online check-in: {{portal_url}}'],
  ['contract_sent', 'email', 'Kira sözleşmeniz · {{contract_no}}',
    'Sayın {{customer_name}},\n\n{{plate}} plakalı araç için {{contract_no}} numaralı kira sözleşmeniz ektedir.\nDönüş: {{return_at}} · {{return_branch}}\n\nSözleşme, fatura, HGS/ceza bilgileri ve yol yardım: {{portal_url}}\n\n{{company_name}}'],
  ['contract_sent', 'whatsapp', null, '{{company_name}}: {{contract_no}} sozlesmeniz olusturuldu. Sozleşme ve yol yardim: {{portal_url}}'],
  ['return_reminder', 'sms', null, '{{company_name}}: {{plate}} plakali aracin iadesi {{return_at}} tarihinde {{return_branch}} subesindedir. Uzatma icin: {{portal_url}}'],
  ['late_return', 'sms', null, '{{company_name}}: {{plate}} plakali aracin iade suresi {{return_at}} itibariyla gecmistir. Gec iade ucreti uygulanmaktadir. Lutfen bizi arayin: {{company_phone}}'],
  ['checkin_completed', 'email', 'İade tamamlandı · {{contract_no}}',
    'Sayın {{customer_name}},\n\n{{plate}} plakalı aracın iadesi tamamlandı.\nToplam: {{total}} · Ödenen: {{paid}} · Bakiye: {{balance}}\n\nFatura ve değerlendirme anketi: {{portal_url}}\n\n{{company_name}}'],
  ['invoice_issued', 'email', 'Faturanız · {{invoice_no}}', 'Sayın {{customer_name}},\n\n{{invoice_no}} numaralı e-Arşiv faturanız ({{total}}) ektedir.\n\n{{company_name}}'],
  ['fine_notice', 'email', 'Trafik cezası bildirimi · {{plate}}',
    'Sayın {{customer_name}},\n\n{{contract_no}} sözleşmesi döneminde {{plate}} plakalı araca {{violation_at}} tarihli {{amount}} tutarında trafik cezası tebliğ edilmiştir. Ceza ve hizmet bedeli hesabınıza yansıtılmıştır.\nDetay: {{portal_url}}\n\n{{company_name}}'],
  ['hgs_notice', 'sms', null, '{{company_name}}: {{contract_no}} sozlesmesi icin {{amount}} tutarinda HGS/OGS gecisi hesabiniza yansitildi. Detay: {{portal_url}}'],
  ['nps', 'email', 'Deneyiminizi değerlendirin', 'Sayın {{customer_name}},\n\nBizi tavsiye etme olasılığınızı 0-10 arası puanlar mısınız? {{portal_url}}\n\n{{company_name}}', 1],
];
