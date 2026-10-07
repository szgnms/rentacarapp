// Postgres şeması (sürüm 1). Değişiklikler yeni bir MIGRATIONS girdisi olarak eklenir; eski girdiler değiştirilmez.
// Tarih/saat alanları uygulama genelinde yerel saatli metin ('YYYY-MM-DDTHH:MM') olarak tutulur.

export const SCHEMA_V1 = `
-- Yerel saat (APP_TZ) metni: oturum saat dilimine bağlı değildir (bağlantı havuzlayıcıları SET komutlarını korumaz).
CREATE OR REPLACE FUNCTION app_now_text() RETURNS TEXT LANGUAGE sql STABLE AS
  $fn$ SELECT to_char(now() AT TIME ZONE '__APP_TZ__', 'YYYY-MM-DD HH24:MI:SS') $fn$;

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  address TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1
, code TEXT, manager_user_id INTEGER);

CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','branch_manager','reservation','field','accounting','fleet','staff')),
        branch_id INTEGER REFERENCES branches(id),
        email TEXT,
        phone TEXT,
        discount_limit_pct DOUBLE PRECISION NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
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

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (app_now_text())
, credit_limit DOUBLE PRECISION NOT NULL DEFAULT 0, invoice_title TEXT, invoice_address TEXT, license_expiry TEXT, risk_score INTEGER NOT NULL DEFAULT 0, risk_note TEXT, preferred_language TEXT NOT NULL DEFAULT 'tr', anonymized_at TEXT, agency_id INTEGER);

CREATE TABLE IF NOT EXISTS extras (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price_type TEXT NOT NULL DEFAULT 'daily' CHECK (price_type IN ('daily','per_rental')),
  price DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_price DOUBLE PRECISION,
  active INTEGER NOT NULL DEFAULT 1
, code TEXT, description TEXT);

CREATE TABLE IF NOT EXISTS agencies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        contact_name TEXT,
        phone TEXT,
        email TEXT,
        tax_no TEXT,
        commission_pct DOUBLE PRECISION NOT NULL DEFAULT 10,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS coupons (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        description TEXT,
        type TEXT NOT NULL DEFAULT 'percent' CHECK (type IN ('percent','amount')),
        value DOUBLE PRECISION NOT NULL,
        valid_from TEXT,
        valid_to TEXT,
        min_days INTEGER NOT NULL DEFAULT 0,
        early_booking_days INTEGER NOT NULL DEFAULT 0,
        category TEXT,
        max_uses INTEGER NOT NULL DEFAULT 0,
        used_count INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
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
        daily_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
        deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        current_km INTEGER NOT NULL DEFAULT 0,
        km_limit_per_day INTEGER NOT NULL DEFAULT 0,
        extra_km_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        fuel_capacity DOUBLE PRECISION NOT NULL DEFAULT 50,
        status TEXT NOT NULL DEFAULT 'available'
          CHECK (status IN ('available','rented','maintenance','out_of_service','damaged','for_sale','in_transfer','sold')),
        branch_id INTEGER REFERENCES branches(id),
        parking_spot TEXT,
        hgs_tag_no TEXT,
        hgs_balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        insurance_expiry TEXT,
        kasko_expiry TEXT,
        inspection_expiry TEXT,
        next_service_km INTEGER,
        next_service_date TEXT,
        purchase_date TEXT,
        purchase_price DOUBLE PRECISION,
        financing TEXT,
        monthly_installment DOUBLE PRECISION,
        depreciation_years DOUBLE PRECISION,
        residual_value DOUBLE PRECISION,
        sold_at TEXT,
        sale_price DOUBLE PRECISION,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        vehicle_id INTEGER REFERENCES vehicles(id),
        category TEXT,
        pickup_branch_id INTEGER REFERENCES branches(id),
        return_branch_id INTEGER REFERENCES branches(id),
        pickup_at TEXT NOT NULL,
        return_at TEXT NOT NULL,
        days INTEGER NOT NULL,
        daily_rate DOUBLE PRECISION NOT NULL,
        base_amount DOUBLE PRECISION NOT NULL,
        long_term_discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        extras_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        one_way_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        young_driver_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        channel_markup DOUBLE PRECISION NOT NULL DEFAULT 0,
        coupon_id INTEGER REFERENCES coupons(id),
        coupon_discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_amount DOUBLE PRECISION NOT NULL,
        deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        rate_plan_id INTEGER,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','confirmed','cancelled','no_show','converted','waitlist')),
        source TEXT DEFAULT 'Ofis',
        agency_id INTEGER REFERENCES agencies(id),
        agency_commission DOUBLE PRECISION NOT NULL DEFAULT 0,
        option_expires_at TEXT,
        cancel_reason TEXT,
        cancellation_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        approval_id INTEGER,
        portal_token TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS reservation_extras (
  id SERIAL PRIMARY KEY,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  extra_id INTEGER NOT NULL REFERENCES extras(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS rentals (
        id SERIAL PRIMARY KEY,
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
        daily_rate DOUBLE PRECISION NOT NULL,
        base_amount DOUBLE PRECISION NOT NULL,
        long_term_discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        extras_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        one_way_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        young_driver_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        channel_markup DOUBLE PRECISION NOT NULL DEFAULT 0,
        coupon_id INTEGER REFERENCES coupons(id),
        coupon_discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        discount DOUBLE PRECISION NOT NULL DEFAULT 0,
        charges_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        total_amount DOUBLE PRECISION NOT NULL,
        deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        deposit_hold_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        deposit_hold_until TEXT,
        additional_driver TEXT,
        source TEXT,
        agency_id INTEGER REFERENCES agencies(id),
        agency_commission DOUBLE PRECISION NOT NULL DEFAULT 0,
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
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS rental_extras (
  id SERIAL PRIMARY KEY,
  rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  extra_id INTEGER NOT NULL REFERENCES extras(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS maintenance (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  type TEXT NOT NULL DEFAULT 'periodic'
    CHECK (type IN ('periodic','repair','tire','inspection','damage_repair','other')),
  description TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  km INTEGER,
  cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  vendor TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL DEFAULT (app_now_text())
, work_order_no TEXT, parts TEXT, next_km INTEGER);

CREATE TABLE IF NOT EXISTS damages (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  rental_id INTEGER REFERENCES rentals(id),
  reported_at TEXT NOT NULL,
  location TEXT,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','moderate','major')),
  repair_cost DOUBLE PRECISION NOT NULL DEFAULT 0,
  customer_charge DOUBLE PRECISION NOT NULL DEFAULT 0,
  insurance_claim INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','repaired','closed')),
  created_at TEXT NOT NULL DEFAULT (app_now_text())
, session_id INTEGER, mark_x DOUBLE PRECISION, mark_y DOUBLE PRECISION, mark_type TEXT, photo_file_id INTEGER, waived INTEGER NOT NULL DEFAULT 0, expertise_note TEXT, deductible DOUBLE PRECISION NOT NULL DEFAULT 0, third_party TEXT);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  vehicle_id INTEGER REFERENCES vehicles(id),
  category TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL CHECK (amount >= 0),
  expense_date TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (app_now_text())
);

CREATE TABLE IF NOT EXISTS rental_charges (
        id SERIAL PRIMARY KEY,
        rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('late_return','extra_km','fuel','damage','cleaning','traffic_fine','hgs','other',
          'missing_equipment','different_branch','service_fee')),
        description TEXT,
        amount DOUBLE PRECISION NOT NULL,
        damage_id INTEGER,
        toll_id INTEGER,
        fine_id INTEGER,
        post_charge INTEGER NOT NULL DEFAULT 0,
        invoice_id INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        rental_id INTEGER REFERENCES rentals(id),
        reservation_id INTEGER REFERENCES reservations(id),
        type TEXT NOT NULL CHECK (type IN ('payment','refund','deposit_in','deposit_out')),
        method TEXT NOT NULL DEFAULT 'cash'
          CHECK (method IN ('cash','credit_card','bank_transfer','deposit','preauth','pos','payment_link')),
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        paid_at TEXT NOT NULL,
        reference TEXT,
        installments INTEGER,
        description TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action TEXT NOT NULL,
        entity TEXT,
        entity_id INTEGER,
        detail TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS files (
        id SERIAL PRIMARY KEY,
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
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS approvals (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('discount','deposit_refund','damage_waiver','charge_waiver')),
        entity TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        reason TEXT,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        requested_by INTEGER REFERENCES users(id),
        decided_by INTEGER REFERENCES users(id),
        decided_at TEXT,
        decision_note TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS vehicle_documents (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        type TEXT NOT NULL,
        number TEXT,
        provider TEXT,
        issued_at TEXT,
        expires_at TEXT,
        cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS vehicle_transfers (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        from_branch_id INTEGER REFERENCES branches(id),
        to_branch_id INTEGER NOT NULL REFERENCES branches(id),
        planned_at TEXT,
        departed_at TEXT,
        arrived_at TEXT,
        driver TEXT,
        km INTEGER,
        cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','in_transit','completed','cancelled')),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS seasons (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0
      );

CREATE TABLE IF NOT EXISTS rate_plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        season_id INTEGER REFERENCES seasons(id),
        channel TEXT,
        band_1_3 DOUBLE PRECISION NOT NULL,
        band_4_7 DOUBLE PRECISION NOT NULL,
        band_8_14 DOUBLE PRECISION NOT NULL,
        band_15_29 DOUBLE PRECISION NOT NULL,
        band_30 DOUBLE PRECISION NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      );

CREATE TABLE IF NOT EXISTS channels (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        markup_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
        commission_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      );

CREATE TABLE IF NOT EXISTS deposit_rules (
        id SERIAL PRIMARY KEY,
        category TEXT,
        driver_age_under INTEGER,
        license_years_under INTEGER,
        amount DOUBLE PRECISION NOT NULL,
        note TEXT
      );

CREATE TABLE IF NOT EXISTS drivers (
        id SERIAL PRIMARY KEY,
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
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS rental_drivers (
        rental_id INTEGER NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
        driver_id INTEGER NOT NULL REFERENCES drivers(id),
        PRIMARY KEY (rental_id, driver_id)
      );

CREATE TABLE IF NOT EXISTS consents (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        type TEXT NOT NULL,
        granted INTEGER NOT NULL,
        channel TEXT,
        text_version TEXT,
        ip TEXT,
        recorded_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS inspection_sessions (
        id SERIAL PRIMARY KEY,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        kind TEXT NOT NULL CHECK (kind IN ('checkout','checkin')),
        km INTEGER,
        fuel INTEGER,
        cleanliness TEXT,
        notes TEXT,
        client_uuid TEXT UNIQUE,
        started_by INTEGER REFERENCES users(id),
        started_at TEXT NOT NULL DEFAULT (app_now_text()),
        completed_at TEXT
      );

CREATE TABLE IF NOT EXISTS inspection_photos (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        angle TEXT NOT NULL,
        file_id INTEGER NOT NULL REFERENCES files(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS damage_marks (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        x DOUBLE PRECISION NOT NULL,
        y DOUBLE PRECISION NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'minor',
        note TEXT,
        photo_file_id INTEGER REFERENCES files(id),
        damage_id INTEGER REFERENCES damages(id),
        voided_at TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS inspection_checklist (
        session_id INTEGER NOT NULL REFERENCES inspection_sessions(id),
        item TEXT NOT NULL,
        present INTEGER NOT NULL,
        note TEXT,
        PRIMARY KEY (session_id, item)
      );

CREATE TABLE IF NOT EXISTS signatures (
        id SERIAL PRIMARY KEY,
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
        signed_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS contract_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'tr',
        version INTEGER NOT NULL DEFAULT 1,
        body TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_no TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'sale' CHECK (type IN ('sale','return')),
        rental_id INTEGER REFERENCES rentals(id),
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        related_invoice_id INTEGER REFERENCES invoices(id),
        issue_date TEXT NOT NULL,
        subtotal DOUBLE PRECISION NOT NULL,
        vat_rate DOUBLE PRECISION NOT NULL,
        vat_amount DOUBLE PRECISION NOT NULL,
        total DOUBLE PRECISION NOT NULL,
        status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','sent','cancelled')),
        e_archive_uuid TEXT,
        sent_at TEXT,
        pdf_file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS invoice_lines (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity DOUBLE PRECISION NOT NULL DEFAULT 1,
        unit_price DOUBLE PRECISION NOT NULL,
        amount DOUBLE PRECISION NOT NULL
      );

CREATE TABLE IF NOT EXISTS toll_transactions (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id),
        plate TEXT,
        tag_no TEXT,
        passed_at TEXT NOT NULL,
        location TEXT,
        amount DOUBLE PRECISION NOT NULL,
        rental_id INTEGER REFERENCES rentals(id),
        status TEXT NOT NULL DEFAULT 'unmatched'
          CHECK (status IN ('unmatched','matched','charged','company','disputed')),
        charge_id INTEGER,
        service_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        batch TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text()),
        UNIQUE (plate, passed_at, location, amount)
      );

CREATE TABLE IF NOT EXISTS traffic_fines (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES vehicles(id),
        plate TEXT NOT NULL,
        fine_no TEXT,
        violation_at TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'other',
        location TEXT,
        amount DOUBLE PRECISION NOT NULL,
        notified_at TEXT,
        discount_deadline TEXT,
        rental_id INTEGER REFERENCES rentals(id),
        customer_id INTEGER REFERENCES customers(id),
        status TEXT NOT NULL DEFAULT 'new'
          CHECK (status IN ('new','matched','transferred','charged','paid','objected','closed','cancelled')),
        charge_id INTEGER,
        service_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
        paid_amount DOUBLE PRECISION,
        paid_at TEXT,
        objection_note TEXT,
        file_id INTEGER REFERENCES files(id),
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS kabis_submissions (
        id SERIAL PRIMARY KEY,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        kind TEXT NOT NULL CHECK (kind IN ('open','close')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','error')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        reference_no TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (app_now_text()),
        sent_at TEXT,
        UNIQUE (rental_id, kind)
      );

CREATE TABLE IF NOT EXISTS notification_templates (
        id SERIAL PRIMARY KEY,
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
        id SERIAL PRIMARY KEY,
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
        created_at TEXT NOT NULL DEFAULT (app_now_text()),
        sent_at TEXT
      );

CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
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
        cost DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (app_now_text()),
        completed_at TEXT
      );

CREATE TABLE IF NOT EXISTS rental_vehicle_changes (
        id SERIAL PRIMARY KEY,
        rental_id INTEGER NOT NULL REFERENCES rentals(id),
        old_vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        new_vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
        old_vehicle_km INTEGER,
        new_vehicle_km INTEGER,
        reason TEXT,
        changed_by INTEGER REFERENCES users(id),
        changed_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE TABLE IF NOT EXISTS nps_responses (
        id SERIAL PRIMARY KEY,
        rental_id INTEGER NOT NULL UNIQUE REFERENCES rentals(id),
        score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10),
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (app_now_text())
      );

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE INDEX IF NOT EXISTS idx_files_entity ON files(entity, entity_id);

CREATE INDEX IF NOT EXISTS idx_res_vehicle ON reservations(vehicle_id, status);

CREATE INDEX IF NOT EXISTS idx_res_category ON reservations(category, status);

CREATE INDEX IF NOT EXISTS idx_rent_vehicle ON rentals(vehicle_id, status);

CREATE INDEX IF NOT EXISTS idx_pay_rental ON payments(rental_id);

CREATE INDEX IF NOT EXISTS idx_pay_customer ON payments(customer_id);

CREATE INDEX IF NOT EXISTS idx_toll_vehicle ON toll_transactions(vehicle_id, passed_at);

CREATE INDEX IF NOT EXISTS idx_fine_vehicle ON traffic_fines(vehicle_id, violation_at);
`;

/** Sıralı migration listesi: [sürüm, SQL]. */
export const MIGRATIONS: [number, string][] = [[1, SCHEMA_V1]];
