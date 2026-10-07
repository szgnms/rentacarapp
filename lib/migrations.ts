// Sürümlü şema geçişleri (PRAGMA user_version). Mevcut veritabanları veri kaybı olmadan yükseltilir.
import type { DatabaseSync } from 'node:sqlite';

type Migration = (db: DatabaseSync) => void;

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

function addColumn(db: DatabaseSync, table: string, def: string) {
  const name = def.trim().split(/\s+/)[0];
  if (!columns(db, table).includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
}

/**
 * Tabloyu yeni tanımla yeniden oluşturur (CHECK/NOT NULL değişiklikleri için).
 * Ortak sütunlar kopyalanır; `map` ile sütun bazında dönüşüm ifadesi verilebilir.
 */
function rebuild(db: DatabaseSync, table: string, createSql: string, map: Record<string, string> = {}) {
  const tmp = `${table}__new`;
  db.exec(createSql.replace(`CREATE TABLE ${table}`, `CREATE TABLE ${tmp}`));
  const oldCols = columns(db, table);
  const common = columns(db, tmp).filter((c) => oldCols.includes(c));
  db.exec(`INSERT INTO ${tmp} (${common.join(', ')}) SELECT ${common.map((c) => map[c] ?? c).join(', ')} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${tmp} RENAME TO ${table}`);
}

const ROLES = `'admin','branch_manager','reservation','field','accounting','fleet','staff'`;

const MIGRATIONS: Migration[] = [
  // ---------------------------------------------------------------- v1: tam operasyon kapsamı
  (db) => {
    // ----- Kullanıcılar: genişletilmiş roller + şube -----
    rebuild(
      db,
      'users',
      `CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN (${ROLES})),
        branch_id INTEGER REFERENCES branches(id),
        email TEXT,
        phone TEXT,
        discount_limit_pct REAL NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );

    // ----- Araçlar: genişletilmiş kart ve durumlar -----
    rebuild(
      db,
      'vehicles',
      `CREATE TABLE vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plate TEXT NOT NULL UNIQUE,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        trim TEXT,
        year INTEGER,
        category TEXT NOT NULL DEFAULT 'Ekonomi',
        acriss TEXT,
        fuel_type TEXT NOT NULL DEFAULT 'Benzin',
        transmission TEXT NOT NULL DEFAULT 'Manuel',
        seats INTEGER DEFAULT 5,
        luggage INTEGER,
        color TEXT,
        vin TEXT,
        engine_no TEXT,
        daily_rate REAL NOT NULL DEFAULT 0,
        deposit_amount REAL NOT NULL DEFAULT 0,
        current_km INTEGER NOT NULL DEFAULT 0,
        km_limit_per_day INTEGER NOT NULL DEFAULT 0,
        extra_km_fee REAL NOT NULL DEFAULT 0,
        fuel_capacity REAL NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'available'
          CHECK (status IN ('available','rented','maintenance','out_of_service','damaged','for_sale','in_transfer','sold')),
        branch_id INTEGER REFERENCES branches(id),
        parking_spot TEXT,
        hgs_tag_no TEXT,
        hgs_balance REAL NOT NULL DEFAULT 0,
        insurance_expiry TEXT,
        kasko_expiry TEXT,
        inspection_expiry TEXT,
        next_service_km INTEGER,
        next_service_date TEXT,
        purchase_date TEXT,
        purchase_price REAL,
        financing TEXT,
        monthly_installment REAL,
        depreciation_years REAL,
        residual_value REAL,
        sold_at TEXT,
        sale_price REAL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );

    // ----- Rezervasyonlar: araç grubu bazlı (araç opsiyonel), bekleme listesi, kanal, kupon -----
    rebuild(
      db,
      'reservations',
      `CREATE TABLE reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        category TEXT,
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
        young_driver_fee REAL NOT NULL DEFAULT 0,
        channel_markup REAL NOT NULL DEFAULT 0,
        coupon_id INTEGER REFERENCES coupons(id),
        coupon_discount REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL,
        deposit_amount REAL NOT NULL DEFAULT 0,
        rate_plan_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','confirmed','cancelled','no_show','converted','waitlist')),
        source TEXT DEFAULT 'Ofis',
        agency_id INTEGER REFERENCES agencies(id),
        agency_commission REAL NOT NULL DEFAULT 0,
        option_expires_at TEXT,
        cancel_reason TEXT,
        cancellation_fee REAL NOT NULL DEFAULT 0,
        approval_id INTEGER,
        portal_token TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );
    db.exec(`UPDATE reservations SET category = (SELECT category FROM vehicles WHERE vehicles.id = reservations.vehicle_id) WHERE category IS NULL`);

    // ----- Sözleşmeler: yaşam döngüsü draft → active → returned → closed -----
    rebuild(
      db,
      'rentals',
      `CREATE TABLE rentals (
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
        young_driver_fee REAL NOT NULL DEFAULT 0,
        channel_markup REAL NOT NULL DEFAULT 0,
        coupon_id INTEGER REFERENCES coupons(id),
        coupon_discount REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        charges_amount REAL NOT NULL DEFAULT 0,
        total_amount REAL NOT NULL,
        deposit_amount REAL NOT NULL DEFAULT 0,
        deposit_hold_amount REAL NOT NULL DEFAULT 0,
        deposit_hold_until TEXT,
        additional_driver TEXT,
        source TEXT,
        agency_id INTEGER REFERENCES agencies(id),
        agency_commission REAL NOT NULL DEFAULT 0,
        language TEXT NOT NULL DEFAULT 'tr',
        template_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','returned','closed','cancelled')),
        signed_at TEXT,
        closed_at TEXT,
        portal_token TEXT,
        checkout_notes TEXT,
        checkin_notes TEXT,
        created_by INTEGER REFERENCES users(id),
        closed_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
      { status: `CASE status WHEN 'completed' THEN 'closed' ELSE status END` },
    );
    db.exec(`UPDATE rentals SET signed_at = pickup_at WHERE signed_at IS NULL AND status <> 'draft'`);
    db.exec(`UPDATE rentals SET closed_at = actual_return_at WHERE status = 'closed' AND closed_at IS NULL`);

    rebuild(
      db,
      'rental_charges',
      `CREATE TABLE rental_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('late_return','extra_km','fuel','damage','cleaning','traffic_fine','hgs','other',
          'missing_equipment','different_branch','service_fee')),
        description TEXT,
        amount REAL NOT NULL,
        damage_id INTEGER,
        toll_id INTEGER,
        fine_id INTEGER,
        post_charge INTEGER NOT NULL DEFAULT 0,
        invoice_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );

    rebuild(
      db,
      'payments',
      `CREATE TABLE payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        rental_id INTEGER REFERENCES rentals(id),
        reservation_id INTEGER REFERENCES reservations(id),
        type TEXT NOT NULL CHECK (type IN ('payment','refund','deposit_in','deposit_out')),
        method TEXT NOT NULL DEFAULT 'cash'
          CHECK (method IN ('cash','credit_card','bank_transfer','deposit','preauth','pos','payment_link')),
        amount REAL NOT NULL CHECK (amount > 0),
        paid_at TEXT NOT NULL,
        reference TEXT,
        installments INTEGER,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`,
    );

    // ----- Basit sütun eklemeleri -----
    for (const def of [
      'credit_limit REAL NOT NULL DEFAULT 0', 'invoice_title TEXT', 'invoice_address TEXT', 'license_expiry TEXT',
      'risk_score INTEGER NOT NULL DEFAULT 0', 'risk_note TEXT', 'preferred_language TEXT NOT NULL DEFAULT \'tr\'',
      'anonymized_at TEXT', 'agency_id INTEGER',
    ]) addColumn(db, 'customers', def);
    for (const def of ['code TEXT', 'description TEXT']) addColumn(db, 'extras', def);
    for (const def of [
      'session_id INTEGER', 'mark_x REAL', 'mark_y REAL', 'mark_type TEXT', 'photo_file_id INTEGER', 'waived INTEGER NOT NULL DEFAULT 0',
      'expertise_note TEXT', 'deductible REAL NOT NULL DEFAULT 0', 'third_party TEXT',
    ]) addColumn(db, 'damages', def);
    for (const def of ['work_order_no TEXT', 'parts TEXT', 'next_km INTEGER']) addColumn(db, 'maintenance', def);
    for (const def of ['code TEXT', 'manager_user_id INTEGER']) addColumn(db, 'branches', def);

    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT,
        entity_id INTEGER,
        detail TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        original_name TEXT,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        meta TEXT,
        uploaded_by INTEGER REFERENCES users(id),
        voided_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity, entity_id);

      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('discount','deposit_refund','damage_waiver','charge_waiver')),
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        reason TEXT,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        requested_by INTEGER REFERENCES users(id),
        decided_by INTEGER REFERENCES users(id),
        decided_at TEXT,
        decision_note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS vehicle_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        type TEXT NOT NULL,
        number TEXT,
        provider TEXT,
        issued_at TEXT,
        expires_at TEXT,
        cost REAL NOT NULL DEFAULT 0,
        file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS vehicle_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        from_branch_id INTEGER REFERENCES branches(id),
        to_branch_id INTEGER NOT NULL REFERENCES branches(id),
        planned_at TEXT,
        departed_at TEXT,
        arrived_at TEXT,
        driver TEXT,
        km INTEGER,
        cost REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_transit','completed','cancelled')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS seasons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rate_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        season_id INTEGER REFERENCES seasons(id),
        channel TEXT,
        band_1_3 REAL NOT NULL,
        band_4_7 REAL NOT NULL,
        band_8_14 REAL NOT NULL,
        band_15_29 REAL NOT NULL,
        band_30 REAL NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS channels (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        markup_pct REAL NOT NULL DEFAULT 0,
        commission_pct REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS coupons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'percent' CHECK (type IN ('percent','amount')),
        value REAL NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        min_days INTEGER NOT NULL DEFAULT 0,
        early_booking_days INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        max_uses INTEGER NOT NULL DEFAULT 0,
        used_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS deposit_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT,
        driver_age_under INTEGER,
        license_years_under INTEGER,
        amount REAL NOT NULL,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS agencies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        tax_no TEXT,
        commission_pct REAL NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS drivers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        national_id TEXT,
        birth_date TEXT,
        phone TEXT,
        license_no TEXT,
        license_class TEXT,
        license_date TEXT,
        license_expiry TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS rental_drivers (
        rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        PRIMARY KEY (rental_id, driver_id)
      );

      CREATE TABLE IF NOT EXISTS consents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        type TEXT NOT NULL,
        granted INTEGER NOT NULL,
        channel TEXT,
        text_version TEXT,
        ip TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS inspection_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        kind TEXT NOT NULL CHECK (kind IN ('checkout','checkin')),
        km INTEGER,
        fuel INTEGER,
        cleanliness TEXT,
        notes TEXT,
        client_uuid TEXT UNIQUE,
        started_by INTEGER REFERENCES users(id),
        started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS inspection_photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        angle TEXT NOT NULL,
        file_id INTEGER NOT NULL REFERENCES files(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS damage_marks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        x REAL NOT NULL,
        y REAL NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor',
        note TEXT,
        photo_file_id INTEGER REFERENCES files(id),
        damage_id INTEGER REFERENCES damages(id),
        voided_at TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS inspection_checklist (
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        item TEXT NOT NULL,
        present INTEGER NOT NULL,
        note TEXT,
        PRIMARY KEY (session_id, item)
      );

      CREATE TABLE IF NOT EXISTS signatures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        purpose TEXT NOT NULL CHECK (purpose IN ('checkout','checkin')),
        signer_type TEXT NOT NULL CHECK (signer_type IN ('customer','staff')),
        signer_name TEXT NOT NULL,
        file_id INTEGER NOT NULL REFERENCES files(id),
        document_hash TEXT NOT NULL,
        signature_hash TEXT NOT NULL,
        stroke_count INTEGER,
        duration_ms INTEGER,
        ip TEXT,
        user_agent TEXT,
        user_id INTEGER REFERENCES users(id),
        signed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS contract_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'tr',
        version INTEGER NOT NULL DEFAULT 1,
        body TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'sale' CHECK (type IN ('sale','return')),
        rental_id INTEGER REFERENCES rentals(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        related_invoice_id INTEGER REFERENCES invoices(id),
        issue_date TEXT NOT NULL,
        subtotal REAL NOT NULL,
        vat_rate REAL NOT NULL,
        vat_amount REAL NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','sent','cancelled')),
        e_archive_uuid TEXT,
        sent_at TEXT,
        pdf_file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS invoice_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        amount REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS toll_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER REFERENCES vehicles(id),
        plate TEXT,
        tag_no TEXT,
        passed_at TEXT NOT NULL,
        location TEXT,
        amount REAL NOT NULL,
        rental_id INTEGER REFERENCES rentals(id),
        status TEXT NOT NULL DEFAULT 'unmatched'
          CHECK (status IN ('unmatched','matched','charged','company','disputed')),
        charge_id INTEGER,
        service_fee REAL NOT NULL DEFAULT 0,
        batch TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE (plate, passed_at, location, amount)
      );

      CREATE TABLE IF NOT EXISTS traffic_fines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER REFERENCES vehicles(id),
        plate TEXT NOT NULL,
        fine_no TEXT,
        violation_at TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        location TEXT,
        amount REAL NOT NULL,
        notified_at TEXT,
        discount_deadline TEXT,
        rental_id INTEGER REFERENCES rentals(id),
        customer_id INTEGER REFERENCES customers(id),
        status TEXT NOT NULL DEFAULT 'new'
          CHECK (status IN ('new','matched','transferred','charged','paid','objected','closed','cancelled')),
        charge_id INTEGER,
        service_fee REAL NOT NULL DEFAULT 0,
        paid_amount REAL,
        paid_at TEXT,
        objection_note TEXT,
        file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS kabis_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        kind TEXT NOT NULL CHECK (kind IN ('open','close')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','error')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        reference_no TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        sent_at TEXT,
        UNIQUE (rental_id, kind)
      );

      CREATE TABLE IF NOT EXISTS notification_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
        language TEXT NOT NULL DEFAULT 'tr',
        subject TEXT,
        body TEXT NOT NULL,
        marketing INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        UNIQUE (code, channel, language)
      );

      CREATE TABLE IF NOT EXISTS message_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_code TEXT,
        channel TEXT NOT NULL,
        to_address TEXT,
        subject TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped')),
        error TEXT,
        entity TEXT,
        entity_id INTEGER,
        customer_id INTEGER REFERENCES customers(id),
        dedupe_key TEXT UNIQUE,
        attachments TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        sent_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('delivery','collection','valet','wash','detailing','roadside','replacement','extension_request','other')),
        title TEXT NOT NULL,
        rental_id INTEGER REFERENCES rentals(id),
        reservation_id INTEGER REFERENCES reservations(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        replacement_vehicle_id INTEGER REFERENCES vehicles(id),
        branch_id INTEGER REFERENCES branches(id),
        assigned_to INTEGER REFERENCES users(id),
        due_at TEXT,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
        priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
        cost REAL NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS rental_vehicle_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        old_vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        new_vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        old_vehicle_km INTEGER,
        new_vehicle_km INTEGER,
        reason TEXT,
        changed_by INTEGER REFERENCES users(id),
        changed_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS nps_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rental_id INTEGER NOT NULL UNIQUE REFERENCES rentals(id),
        score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      );

      CREATE INDEX IF NOT EXISTS idx_res_vehicle ON reservations(vehicle_id, status);
      CREATE INDEX IF NOT EXISTS idx_res_category ON reservations(category, status);
      CREATE INDEX IF NOT EXISTS idx_rent_vehicle ON rentals(vehicle_id, status);
      CREATE INDEX IF NOT EXISTS idx_pay_rental ON payments(rental_id);
      CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);
      CREATE INDEX IF NOT EXISTS idx_toll_vehicle ON toll_transactions(vehicle_id, passed_at);
      CREATE INDEX IF NOT EXISTS idx_fine_vehicle ON traffic_fines(vehicle_id, violation_at);
    `);

    // Eski araç belge tarihlerini belge tablosuna taşı
    const docMap = { insurance_expiry: 'traffic_insurance', kasko_expiry: 'kasko', inspection_expiry: 'inspection' } as const;
    for (const [col, type] of Object.entries(docMap)) {
      db.exec(`INSERT INTO vehicle_documents (vehicle_id, type, expires_at)
               SELECT id, '${type}', ${col} FROM vehicles WHERE ${col} IS NOT NULL AND ${col} <> ''`);
    }
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Bekleyen geçişleri sırayla uygular. */
export function migrate(db: DatabaseSync) {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      MIGRATIONS[v](db);
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Geçiş ${v + 1} sonrası yabancı anahtar hatası: ${JSON.stringify(broken.slice(0, 3))}`);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
