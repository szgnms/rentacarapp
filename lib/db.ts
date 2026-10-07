// Veritabanı katmanı (Postgres).
// - DATABASE_URL tanımlıysa `pg` havuzu (Neon, Vercel Postgres, Supabase, kendi sunucunuz)
// - yoksa gömülü PGlite (aynı Postgres lehçesi; yerel geliştirme ve testler için, DATA_DIR/pglite)
// Tüm sorgular asenkron; `tx` içindeki sorgular AsyncLocalStorage ile aynı bağlantıya bağlanır.
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './core';
import { hashPassword } from './password';
import { MIGRATIONS } from './schema';
import type { Settings } from './types';

export type Param = string | number | boolean | null | undefined;

interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}
interface Executor {
  query<T>(sql: string, params: Param[]): Promise<QueryResult<T>>;
}
interface Driver extends Executor {
  kind: 'pg' | 'pglite';
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (ex: Executor) => Promise<T>): Promise<T>;
  /** Tek seferlik kilitli iş (migration/bootstrap): sunucusuz ortamda eşzamanlı soğuk başlatmalara karşı. */
  locked<T>(fn: (ex: Driver) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Uygulama saat dilimi: tarih/saatler yerel metin olarak saklandığından sunucu ve veritabanı oturumu aynı dilimde çalışır. */
export const APP_TZ = /^[A-Za-z0-9_+\-/]+$/.test(process.env.APP_TZ ?? '') ? process.env.APP_TZ! : 'Europe/Istanbul';
if (!process.env.TZ) process.env.TZ = APP_TZ;

/** Veri klasörü (PGlite veritabanı ve yerel dosya deposu). Vercel'de yalnızca /tmp yazılabilir. */
export function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return path.join('/tmp', 'rentacar');
  return path.join(process.cwd(), 'data');
}

// ---------- Sürücüler ----------

/** `?` yer tutucularını `$1, $2…` biçimine çevirir (tırnak içindekiler hariç). */
const placeholderCache = new Map<string, string>();
export function toPg(sql: string): string {
  let out = placeholderCache.get(sql);
  if (out !== undefined) return out;
  let n = 0;
  let quoted = false;
  out = '';
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  placeholderCache.set(sql, out);
  return out;
}

/** Geçersiz girdi kaynaklı Postgres hataları (ör. tamsayı alana "1.5") istemci hatasıdır. */
function mapPgError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '22P02' || code === '22003' || code === '22007' || code === '22008') throw new HttpError(400, 'Geçersiz değer');
  throw e;
}

const norm = (params: Param[]) =>
  params.map((p) => {
    // SQLite NaN'ı sessizce eşleşmeyen değer sayıyordu; Postgres sorguyu reddeder → geçersiz istek (sayfalarda 404)
    if (typeof p === 'number' && !Number.isFinite(p)) throw new HttpError(400, 'Geçersiz sayısal değer');
    return p === undefined ? null : p;
  });

async function pgDriver(url: string): Promise<Driver> {
  const { default: pg } = await import('pg');
  // COUNT/SUM (int8, numeric) değerleri JS sayısı olarak dönsün
  pg.types.setTypeParser(20, (v: string) => Number(v));
  pg.types.setTypeParser(1700, (v: string) => Number(v));
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 5), idleTimeoutMillis: 10_000 });
  pool.on('connect', (c) => void c.query(`SET TIME ZONE '${APP_TZ}'`));
  type Q = { query: (text: string, values: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }> };
  const wrap = (c: Q): Executor => ({
    async query<T>(sql: string, params: Param[]) {
      const r = await c.query(toPg(sql), norm(params)).catch(mapPgError);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
  });
  const base = wrap(pool as unknown as Q);
  const driver: Driver = {
    kind: 'pg',
    query: base.query,
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const r = await fn(wrap(client as unknown as Q));
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    async locked(fn) {
      // İşlem kapsamlı kilit: PgBouncer (işlem modu) arkasında da güvenli; tüm iş aynı bağlantı ve işlemde yürür.
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(727274)');
        const ex = wrap(client as unknown as Q);
        const scoped: Driver = {
          ...driver,
          query: ex.query,
          exec: async (sql) => void (await client.query(sql)),
          transaction: (f) => f(ex),
          locked: (f) => f(scoped),
        };
        const r = await fn(scoped);
        await client.query('COMMIT');
        return r;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return driver;
}

async function pgliteDriver(dir: string | null): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir ?? undefined, { parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) } });
  await db.exec(`SET TIME ZONE '${APP_TZ}'`);
  // PGlite tek oturumludur: işlem sürerken dışarıdan gelen sorgular sıraya alınır.
  let chain: Promise<unknown> = Promise.resolve();
  const serial = async <T>(fn: () => Promise<T>): Promise<T> => {
    const r = chain.then(fn, fn);
    chain = r.catch(() => {});
    return r;
  };
  const wrap = (c: { query: (s: string, p: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Executor => ({
    async query<T>(sql: string, params: Param[]) {
      const r = await c.query(toPg(sql), norm(params)).catch(mapPgError);
      return { rows: r.rows as T[], rowCount: r.affectedRows ?? r.rows.length };
    },
  });
  const direct = wrap(db);
  const driver: Driver = {
    kind: 'pglite',
    query: (sql, params) => serial(() => direct.query(sql, params)),
    exec: (sql) => serial(async () => void (await db.exec(sql))),
    transaction: (fn) => serial(() => db.transaction((t) => fn(wrap(t)))),
    locked: (fn) => fn(driver),
    close: () => db.close(),
  };
  return driver;
}

// ---------- Bağlantı yönetimi ----------

/** DATABASE_URL (Neon/Supabase/kendi sunucunuz) ya da eski Vercel Postgres entegrasyonunun POSTGRES_URL değişkeni. */
export const databaseUrl = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

const g = globalThis as unknown as { __rentacarDb?: Promise<Driver> };
const txStore = new AsyncLocalStorage<Executor>();

async function connect(target?: string): Promise<Driver> {
  const url = target && target !== ':memory:' && /^postgres(ql)?:/.test(target) ? target : databaseUrl();
  const driver =
    target === ':memory:' ? await pgliteDriver(null) : url ? await pgDriver(url) : await pgliteDriver(path.join(dataDir(), 'pglite'));
  await driver.locked(async (d) => {
    await migrate(d);
    await bootstrap(d);
  });
  return driver;
}

/**
 * Veritabanını açar (veya yeniden açar). ':memory:' → bellek içi PGlite (testler),
 * 'postgres://…' → o sunucu; boş → DATABASE_URL ya da DATA_DIR/pglite.
 */
export async function openDb(target?: string): Promise<void> {
  const prev = g.__rentacarDb;
  g.__rentacarDb = connect(target);
  await g.__rentacarDb;
  if (prev) await prev.then((d) => d.close()).catch(() => {});
}

export async function getDb(): Promise<Driver> {
  return (g.__rentacarDb ??= connect());
}

export async function closeDb() {
  const d = g.__rentacarDb;
  g.__rentacarDb = undefined;
  if (d) await (await d).close();
}

async function executor(): Promise<Executor> {
  return txStore.getStore() ?? (await getDb());
}

export async function all<T>(sql: string, ...params: Param[]): Promise<T[]> {
  return (await (await executor()).query<T>(sql, params)).rows;
}

export async function one<T>(sql: string, ...params: Param[]): Promise<T | undefined> {
  return (await all<T>(sql, ...params))[0];
}

export async function run(sql: string, ...params: Param[]): Promise<{ changes: number }> {
  const r = await (await executor()).query(sql, params);
  return { changes: r.rowCount };
}

/** İlk satırın ilk sütunu. */
export async function scalar<T = number>(sql: string, ...params: Param[]): Promise<T> {
  const row = await one<Record<string, unknown>>(sql, ...params);
  return (row ? Object.values(row)[0] : undefined) as T;
}

/** fn'yi tek işlemde çalıştırır; hata olursa geri alır. İç içe çağrılar dıştaki işleme katılır. */
export async function tx<T>(fn: () => Promise<T> | T): Promise<T> {
  if (txStore.getStore()) return fn();
  const d = await getDb();
  return d.transaction((ex) => txStore.run(ex, async () => fn()));
}

/**
 * Ertelenmiş işler (after/setImmediate) AsyncLocalStorage bağlamını devralır; işlem içinde planlanan bir iş
 * bitmiş işlemin bağlantısını kullanmasın diye işlem bağlamının dışında çalıştırılır.
 */
export function outsideTx<T>(fn: () => T): T {
  return txStore.exit(fn);
}

let spSeq = 0;
/**
 * Postgres'te işlem içindeki bir hata tüm işlemi iptal eder; satır satır hata yakalanan
 * toplu işlemlerde (CSV içe aktarma) her satır bir SAVEPOINT içinde çalıştırılır.
 */
export async function savepoint<T>(fn: () => Promise<T>): Promise<T> {
  if (!txStore.getStore()) return fn();
  const name = `sp_${++spSeq}`;
  await run(`SAVEPOINT ${name}`);
  try {
    const r = await fn();
    await run(`RELEASE SAVEPOINT ${name}`);
    return r;
  } catch (e) {
    await run(`ROLLBACK TO SAVEPOINT ${name}`);
    throw e;
  }
}

type Row = Record<string, Param>;

export async function insertRow(table: string, data: Row): Promise<number> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  const row = await one<{ id?: number }>(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) RETURNING *`,
    ...keys.map((k) => data[k]),
  );
  return Number(row?.id ?? 0);
}

export async function updateRow(table: string, id: number, data: Row): Promise<void> {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return;
  await run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => data[k]), id);
}

export async function getSettings(): Promise<Settings> {
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of await all<{ key: keyof Settings; value: string }>('SELECT key, value FROM settings')) {
    if (r.key in s) s[r.key] = r.value ?? '';
  }
  return s;
}

// ---------- Migration & başlangıç verisi ----------

async function migrate(d: Driver) {
  await d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await d.query<{ version: number }>('SELECT version FROM schema_migrations', [])).rows.map((r) => r.version));
  for (const [version, sql] of MIGRATIONS) {
    if (done.has(version)) continue;
    // Çok ifadeli metin tek seferde (simple query protocol) çalışır; hem pg hem PGlite bunu tek örtük işlemde uygular.
    await d.exec(`${sql.replaceAll('__APP_TZ__', APP_TZ)};\nINSERT INTO schema_migrations(version, applied_at) VALUES (${Number(version)}, '${new Date().toISOString()}');`);
  }
}

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

async function bootstrap(d: Driver) {
  const q = (sql: string, ...p: Param[]) => d.query<Record<string, unknown>>(sql, p);
  const count = async (table: string) => Number((await q(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) await q('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', k, v);
  if ((await count('users')) === 0) {
    await q('INSERT INTO users(username, password_hash, full_name, role) VALUES (?,?,?,?)', 'admin', hashPassword(process.env.ADMIN_PASSWORD || 'admin123'), 'Sistem Yöneticisi', 'admin');
  }
  if ((await count('branches')) === 0) await q('INSERT INTO branches(name, city) VALUES (?, ?)', 'Merkez Ofis', 'İstanbul');
  if ((await count('extras')) === 0) {
    for (const [name, type, price, max] of [
      ['Bebek Koltuğu', 'daily', 150, 1500], ['Navigasyon', 'daily', 100, 1000], ['Ek Sürücü', 'per_rental', 500, null],
      ['Mini Hasar Sigortası', 'daily', 250, null], ['Kar Zinciri', 'per_rental', 300, null],
    ] as [string, string, number, number | null][]) await q('INSERT INTO extras(name, price_type, price, max_price) VALUES (?,?,?,?)', name, type, price, max);
  }
  // Özel davranışlı ek hizmetler (kodla tanınır)
  const coded: [string, string, string, number][] = [
    ['unlimited_km', 'Sınırsız km', 'daily', 300],
    ['full_coverage', 'Tam kasko paketi (LDW/SCDW)', 'daily', 450],
    ['delivery', 'Ofis dışı teslim / adrese teslim', 'per_rental', 750],
    ['additional_driver', 'Ek sürücü', 'per_rental', 500],
  ];
  for (const [code, name, type, price] of coded) {
    if ((await q('SELECT 1 FROM extras WHERE code = ?', code)).rows.length) continue;
    const existing = (await q('SELECT id FROM extras WHERE name = ? AND code IS NULL', name === 'Ek sürücü' ? 'Ek Sürücü' : name)).rows[0];
    if (existing) await q('UPDATE extras SET code = ? WHERE id = ?', code, existing.id as number);
    else await q('INSERT INTO extras(name, price_type, price, code) VALUES (?,?,?,?)', name, type, price, code);
  }
  if ((await count('channels')) === 0) {
    for (const [code, name, markup, comm] of [
      ['Ofis', 'Ofis / Şube', 0, 0], ['Telefon', 'Çağrı merkezi', 0, 0], ['Web', 'Web sitesi', -5, 0],
      ['Acente', 'Acente (B2B)', 0, 10], ['Kurumsal', 'Kurumsal sözleşme', -10, 0], ['Marketplace', 'Marketplace', 10, 15],
    ] as [string, string, number, number][]) await q('INSERT INTO channels(code, name, markup_pct, commission_pct) VALUES (?,?,?,?)', code, name, markup, comm);
  }
  if ((await count('contract_templates')) === 0) {
    for (const [lang, name, body] of CONTRACT_TEMPLATES) await q('INSERT INTO contract_templates(name, language, body) VALUES (?,?,?)', name, lang, body);
  }
  if ((await count('notification_templates')) === 0) {
    for (const t of NOTIFICATION_TEMPLATES) await q('INSERT INTO notification_templates(code, channel, subject, body, marketing) VALUES (?,?,?,?,?)', t[0], t[1], t[2], t[3], t[4] ?? 0);
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
