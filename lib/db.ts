import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './password';
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
  company_address: '',
  company_tax_no: '',
  currency: 'TRY',
  grace_hours: '2',
  weekly_discount_pct: '10',
  monthly_discount_pct: '20',
  one_way_fee: '1500',
  fuel_price_per_eighth: '350',
  min_driver_age: '21',
  min_license_years: '2',
  late_fee_multiplier: '1',
  vat_rate: '20',
  contract_terms:
    'Kiracı, aracı teslim aldığı durumda ve belirtilen tarihte iade etmeyi kabul eder. ' +
    'Trafik cezaları, HGS/OGS geçiş ücretleri ve kiracı kusurundan doğan hasarlar kiracıya aittir. ' +
    'Araç alkollü ya da ehliyetsiz kişilerce kullanılamaz, üçüncü kişilere kiralanamaz.',
};

type Param = SQLInputValue;

const g = globalThis as unknown as { __rentacarDb?: DatabaseSync };

/** Opens (or reopens) the database. Uses DB_FILE or data/rentacar.db. */
export function openDb(file = process.env.DB_FILE || path.join(process.cwd(), 'data', 'rentacar.db')): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA);
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
}
