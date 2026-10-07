// Hukuki belgeler: imzalı sözleşme, iade tutanağı, e-Arşiv fatura, KABİS çıktısı, sürücü devir yazısı.
// Üretilen her PDF değiştirilemez dosya deposuna SHA-256 özetiyle kaydedilir.
import { all, getSettings, one, run } from './db';
import { HttpError } from './core';
import { PdfWriter } from './pdf';
import { readFile, saveFile, type StoredFile } from './files';
import { FUEL, customerName, d, dt, money, numf, text } from './format';
import { CLEANLINESS_LABELS, DAMAGE_TYPES, angleLabel } from './inspection';
import { render } from './domain/notify';
import { equipmentItems } from './rules';
import type { Customer, Rental, RentalCharge, Vehicle } from './types';

type Lang = 'tr' | 'en' | 'de' | 'ru';
const L: Record<Lang, Record<string, string>> = {
  tr: {
    title: 'ARAÇ KİRALAMA SÖZLEŞMESİ', renter: 'Kiracı', vehicle: 'Araç ve kiralama', fees: 'Ücretler', inspection: 'Teslim muayenesi',
    terms: 'Genel şartlar', photos: 'Teslim fotoğrafları', sigs: 'İmzalar', lessor: 'Kiraya veren', lessee: 'Kiracı', total: 'TOPLAM',
  },
  en: {
    title: 'VEHICLE RENTAL AGREEMENT', renter: 'Renter', vehicle: 'Vehicle and rental', fees: 'Charges', inspection: 'Handover inspection',
    terms: 'Terms and conditions', photos: 'Handover photos', sigs: 'Signatures', lessor: 'Lessor', lessee: 'Renter', total: 'TOTAL',
  },
  de: {
    title: 'FAHRZEUGMIETVERTRAG', renter: 'Mieter', vehicle: 'Fahrzeug und Miete', fees: 'Kosten', inspection: 'Übergabeprotokoll',
    terms: 'Allgemeine Bedingungen', photos: 'Übergabefotos', sigs: 'Unterschriften', lessor: 'Vermieter', lessee: 'Mieter', total: 'GESAMT',
  },
  ru: {
    title: 'ДОГОВОР АРЕНДЫ АВТОМОБИЛЯ', renter: 'Арендатор', vehicle: 'Автомобиль и аренда', fees: 'Стоимость', inspection: 'Акт приёма-передачи',
    terms: 'Общие условия', photos: 'Фотографии при выдаче', sigs: 'Подписи', lessor: 'Арендодатель', lessee: 'Арендатор', total: 'ИТОГО',
  },
};

async function companyLines() {
  const s = await getSettings();
  return [s.company_name, s.company_address, [s.company_phone, s.company_email].filter(Boolean).join(' · '), s.company_tax_no ? `VKN: ${s.company_tax_no} ${s.company_tax_office}` : '']
    .filter(Boolean);
}

async function savePdf(w: PdfWriter, entity: string, entityId: number, name: string, meta: Record<string, unknown>): Promise<StoredFile> {
  return saveFile({ kind: 'pdf', entity, entityId, name, mime: 'application/pdf', data: await w.bytes(), meta });
}

async function loadRental(id: number) {
  const r = await one<Rental & { plate: string; pickup_branch: string | null; return_branch: string | null }>(
    `SELECT r.*, v.plate, pb.name AS pickup_branch, rb.name AS return_branch FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id
     LEFT JOIN branches pb ON pb.id = r.pickup_branch_id LEFT JOIN branches rb ON rb.id = r.return_branch_id WHERE r.id = ?`, id,
  );
  if (!r) throw new HttpError(404, 'Kiralama bulunamadı');
  return { r, c: (await one<Customer>('SELECT * FROM customers WHERE id = ?', r.customer_id))!, v: (await one<Vehicle>('SELECT * FROM vehicles WHERE id = ?', r.vehicle_id))! };
}

async function sessionData(rentalId: number, kind: 'checkout' | 'checkin') {
  const s = await one<{ id: number; km: number | null; fuel: number | null; cleanliness: string | null; notes: string | null; completed_at: string | null }>(
    'SELECT * FROM inspection_sessions WHERE rental_id = ? AND kind = ? ORDER BY id DESC LIMIT 1', rentalId, kind,
  );
  if (!s) return null;
  return {
    ...s,
    photos: await all<{ angle: string; file_id: number }>(
      `SELECT p.angle, p.file_id FROM inspection_photos p WHERE p.session_id = ? AND p.id IN (SELECT MAX(id) FROM inspection_photos WHERE session_id = ? GROUP BY angle)`, s.id, s.id,
    ),
    marks: await all<{ x: number; y: number; type: string; severity: string; note: string | null }>('SELECT * FROM damage_marks WHERE session_id = ? AND voided_at IS NULL', s.id),
    checklist: await all<{ item: string; present: number }>('SELECT item, present FROM inspection_checklist WHERE session_id = ?', s.id),
  };
}

async function photosFor(list: { angle: string; file_id: number }[]) {
  const out: { data: Buffer; mime: string; caption: string }[] = [];
  for (const p of list) {
    try {
      const { file, data } = await readFile(p.file_id);
      if (file.mime === 'image/jpeg' || file.mime === 'image/png') out.push({ data, mime: file.mime, caption: `${angleLabel(p.angle)} · ${file.sha256.slice(0, 10)}` });
    } catch {
      /* dosya okunamadı */
    }
  }
  return out;
}

async function signatureBoxes(rentalId: number, purpose: 'checkout' | 'checkin', labels: { lessor: string; lessee: string }, companyName: string) {
  const sigs = await all<{ signer_type: string; signer_name: string; file_id: number; signed_at: string; ip: string | null; signature_hash: string }>(
    'SELECT * FROM signatures WHERE rental_id = ? AND purpose = ? AND id IN (SELECT MAX(id) FROM signatures WHERE rental_id = ? AND purpose = ? GROUP BY signer_type)',
    rentalId, purpose, rentalId, purpose,
  );
  const box = async (type: 'staff' | 'customer', title: string, fallback: string) => {
    const s = sigs.find((x) => x.signer_type === type);
    let image: { data: Buffer; mime: string } | null = null;
    if (s) {
      try {
        const f = await readFile(s.file_id);
        image = { data: f.data, mime: f.file.mime };
      } catch {
        image = null;
      }
    }
    return { title, name: s?.signer_name ?? fallback, image, meta: s ? `${dt(s.signed_at)} · IP ${s.ip ?? '-'} · ${s.signature_hash.slice(0, 16)}` : 'İmzasız' };
  };
  return [await box('staff', labels.lessor, companyName), await box('customer', labels.lessee, '')];
}

async function templateFor(lang: string, templateId: number | null) {
  return (
    (templateId ? await one<{ id: number; body: string }>('SELECT id, body FROM contract_templates WHERE id = ?', templateId) : undefined) ??
    await one<{ id: number; body: string }>('SELECT id, body FROM contract_templates WHERE language = ? AND active = 1 ORDER BY version DESC, id DESC LIMIT 1', lang) ??
    await one<{ id: number; body: string }>("SELECT id, body FROM contract_templates WHERE language = 'tr' AND active = 1 ORDER BY version DESC, id DESC LIMIT 1")
  );
}

/** İmzalı kira sözleşmesi + teslim tutanağı. */
export async function contractPdf(rentalId: number): Promise<StoredFile> {
  const s = await getSettings();
  const { r, c, v } = await loadRental(rentalId);
  const lang = (['tr', 'en', 'de', 'ru'].includes(r.language) ? r.language : 'tr') as Lang;
  const t = L[lang];
  const out = await sessionData(rentalId, 'checkout');
  const tpl = await templateFor(lang, r.template_id);
  if (tpl && !r.template_id) await run('UPDATE rentals SET template_id = ? WHERE id = ?', tpl.id, rentalId);
  const docHash = (await one<{ document_hash: string }>("SELECT document_hash FROM signatures WHERE rental_id = ? AND purpose = 'checkout' ORDER BY id DESC", rentalId))?.document_hash;

  const w = await PdfWriter.create(`${r.contract_no} · ${s.company_name} · Belge özeti: ${docHash ?? '-'}`);
  w.header(await companyLines(), [t.title, `No: ${r.contract_no}`, `${dt(r.signed_at ?? r.pickup_at)}`]);
  w.heading(t.renter, 10.5);
  w.kv([
    ['Ad Soyad / Name', customerName(c)], ['T.C. / Pasaport', c.national_id || c.passport_no || '—'],
    ['Telefon', c.phone], ['E-posta', c.email ?? '—'], ['Ehliyet no / sınıf', `${c.license_no ?? '—'} / ${c.license_class ?? '—'}`],
    ['Ehliyet tarihi', d(c.license_date)], ['Doğum tarihi', d(c.birth_date)], ['Adres', c.address ?? '—'],
  ]);
  const drivers = await all<{ first_name: string; last_name: string; license_no: string | null }>(
    'SELECT d.first_name, d.last_name, d.license_no FROM rental_drivers rd JOIN drivers d ON d.id = rd.driver_id WHERE rd.rental_id = ?', rentalId,
  );
  if (drivers.length || r.additional_driver) {
    w.text(`Ek sürücüler: ${[...drivers.map((x) => `${x.first_name} ${x.last_name} (${x.license_no ?? '-'})`), r.additional_driver].filter(Boolean).join(', ')}`, { size: 8.5 });
  }
  w.heading(t.vehicle, 10.5);
  w.kv([
    ['Plaka', v.plate], ['Marka / Model', `${v.brand} ${v.model}${v.trim ? ' ' + v.trim : ''}${v.year ? ` (${v.year})` : ''}`],
    ['Şasi no', v.vin ?? '—'], ['Grup / ACRISS', `${v.category}${v.acriss ? ' / ' + v.acriss : ''}`],
    ['Teslim', [dt(r.pickup_at), r.pickup_branch].filter(Boolean).join(' · ')], ['Dönüş', [dt(r.planned_return_at), r.return_branch].filter(Boolean).join(' · ')],
    ['Çıkış km / yakıt', `${numf(out?.km ?? r.start_km)} km / ${FUEL(out?.fuel ?? r.start_fuel)}`],
    ['Km limiti', v.km_limit_per_day ? `${v.km_limit_per_day} km/gün, aşım ${money(v.extra_km_fee)}/km` : 'Sınırsız'],
    ['Depozito / provizyon', money(r.deposit_amount)], ['Temizlik', out?.cleanliness ? CLEANLINESS_LABELS[out.cleanliness as keyof typeof CLEANLINESS_LABELS] : '—'],
  ]);
  w.heading(t.fees, 10.5);
  const fees: string[][] = [[`${r.days} gün × ${money(r.daily_rate)}`, money(r.base_amount)]];
  if (r.long_term_discount) fees.push(['Uzun dönem indirimi', `-${money(r.long_term_discount)}`]);
  if (r.channel_markup) fees.push(['Kanal fiyat farkı', money(r.channel_markup)]);
  for (const x of await all<{ name: string; quantity: number; amount: number }>('SELECT * FROM rental_extras WHERE rental_id = ?', rentalId)) {
    fees.push([`${x.name}${x.quantity > 1 ? ` ×${x.quantity}` : ''}`, money(x.amount)]);
  }
  if (r.one_way_fee) fees.push(['Tek yön ücreti', money(r.one_way_fee)]);
  if (r.young_driver_fee) fees.push(['Genç sürücü ücreti', money(r.young_driver_fee)]);
  if (r.coupon_discount) fees.push(['Kampanya / kupon', `-${money(r.coupon_discount)}`]);
  if (r.discount) fees.push(['İndirim', `-${money(r.discount)}`]);
  fees.push([`${t.total} (KDV %${s.vat_rate} dahil)`, money(r.total_amount)]);
  w.table(['Kalem', 'Tutar'], fees, [4, 1], { totalRows: 1 });

  if (out) {
    w.heading(t.inspection, 10.5);
    const items = (await equipmentItems()).map((e) => e.name);
    const present = new Set(out.checklist.filter((x) => x.present).map((x) => x.item));
    w.text(`Ekipman: ${items.map((i) => `${present.has(i) ? '☑' : '☐'} ${i}`).join('   ')}`, { size: 8 });
    const openDamages = await all<{ description: string; location: string | null; severity: string }>(
      "SELECT description, location, severity FROM damages WHERE vehicle_id = ? AND status = 'open' AND (rental_id IS NULL OR rental_id <> ?)", v.id, rentalId,
    );
    const marks = out.marks.map((m) => [`${DAMAGE_TYPES[m.type as keyof typeof DAMAGE_TYPES] ?? m.type}`, `x:${Math.round(m.x)} y:${Math.round(m.y)}`, m.severity, m.note ?? '']);
    if (marks.length || openDamages.length) {
      w.table(
        ['Mevcut hasar', 'Konum', 'Önem', 'Not'],
        [...marks, ...openDamages.map((x) => [x.description, x.location ?? '', x.severity, 'Önceki kayıt'])],
        [2, 1.2, 0.8, 3],
      );
    } else w.text('Teslimde işaretlenmiş hasar yok.', { size: 8.5 });
  }
  if (r.checkout_notes) w.text(`Teslim notları: ${r.checkout_notes}`, { size: 8.5 });

  w.heading(t.terms, 10.5);
  const vars = {
    plate: v.plate, pickup_at: dt(r.pickup_at), return_at: dt(r.planned_return_at), return_branch: r.return_branch ?? '', start_km: numf(r.start_km),
    start_fuel: FUEL(r.start_fuel), km_limit: v.km_limit_per_day ? `${v.km_limit_per_day} km/gün` : 'sınırsız', deposit: money(r.deposit_amount),
    hold_days: s.deposit_hold_days, contract_no: r.contract_no, customer_name: customerName(c), company_name: s.company_name,
  };
  w.text(render(tpl?.body ?? s.contract_terms, vars), { size: 8 });

  if (out?.photos.length) {
    w.heading(t.photos, 10.5);
    await w.gallery(await photosFor(out.photos), 4);
  }
  w.heading(t.sigs, 10.5);
  await w.signatures(await signatureBoxes(rentalId, 'checkout', { lessor: t.lessor, lessee: t.lessee }, s.company_name));
  w.text(`Belge özeti (SHA-256): ${docHash ?? '-'}`, { size: 6.5 });
  return savePdf(w, 'rental', rentalId, `${r.contract_no}-sozlesme.pdf`, { doc: 'contract', document_hash: docHash, language: lang });
}

/** İade tutanağı ve hesap özeti. */
export async function settlementPdf(rentalId: number): Promise<StoredFile> {
  const s = await getSettings();
  const { r, c, v } = await loadRental(rentalId);
  const back = await sessionData(rentalId, 'checkin');
  const out = await sessionData(rentalId, 'checkout');
  const w = await PdfWriter.create(`${r.contract_no} · İade tutanağı`);
  w.header(await companyLines(), ['İADE TUTANAĞI / HESAP ÖZETİ', `Sözleşme: ${r.contract_no}`, dt(r.actual_return_at)]);
  w.kv([
    ['Kiracı', customerName(c)], ['Araç', `${v.plate} · ${v.brand} ${v.model}`],
    ['Teslim', dt(r.pickup_at)], ['İade', `${dt(r.actual_return_at)} · ${r.return_branch ?? ''}`],
    ['Km', `${numf(r.start_km)} → ${numf(r.end_km)} (${numf((r.end_km ?? 0) - r.start_km)} km)`], ['Yakıt', `${FUEL(r.start_fuel)} → ${FUEL(r.end_fuel)}`],
    ['Temizlik', back?.cleanliness ? CLEANLINESS_LABELS[back.cleanliness as keyof typeof CLEANLINESS_LABELS] : '—'],
    ['Ekipman', back ? (await equipmentItems()).filter((e) => out?.checklist.find((x) => x.item === e.name && x.present) && !back.checklist.find((x) => x.item === e.name && x.present)).map((e) => e.name).join(', ') || 'Eksiksiz' : '—'],
  ]);
  const charges = await all<RentalCharge>('SELECT * FROM rental_charges WHERE rental_id = ? ORDER BY id', rentalId);
  const rows: string[][] = [['Kira bedeli ve ek hizmetler', money(r.total_amount - r.charges_amount)]];
  for (const ch of charges) rows.push([`${text('chargeType', ch.type)}${ch.description ? ' — ' + ch.description : ''}`, money(ch.amount)]);
  const pays = await all<{ type: string; total: number }>("SELECT type, SUM(amount) total FROM payments WHERE rental_id = ? GROUP BY type", rentalId);
  const sum = (t: string) => pays.find((p) => p.type === t)?.total ?? 0;
  const paid = sum('payment') - sum('refund');
  rows.push(['TOPLAM', money(r.total_amount)], ['Ödenen', money(paid)], ['Kalan bakiye', money(r.total_amount - paid)]);
  w.heading('Hesap özeti', 10.5);
  w.table(['Kalem', 'Tutar'], rows, [4, 1], { totalRows: 3 });
  w.text(`Depozito/provizyon: alınan ${money(sum('deposit_in'))}, iade/mahsup ${money(sum('deposit_out'))}${r.deposit_hold_amount ? `, tutulan ${money(r.deposit_hold_amount)} (${d(r.deposit_hold_until)} tarihine kadar, bekleyen HGS/ceza için)` : ''}`, { size: 8.5 });
  const newDamages = await all<{ description: string; severity: string; customer_charge: number }>('SELECT * FROM damages WHERE rental_id = ?', rentalId);
  if (newDamages.length) {
    w.heading('Yeni tespit edilen hasarlar', 10.5);
    w.table(['Hasar', 'Önem', 'Müşteriye'], newDamages.map((x) => [x.description, x.severity, money(x.customer_charge)]), [4, 1, 1]);
  }
  if (r.checkin_notes) w.text(`Notlar: ${r.checkin_notes}`, { size: 8.5 });
  if (back?.photos.length) {
    w.heading('İade fotoğrafları', 10.5);
    await w.gallery(await photosFor(back.photos), 4);
  }
  w.heading('İmzalar', 10.5);
  await w.signatures(await signatureBoxes(rentalId, 'checkin', { lessor: 'Teslim alan', lessee: 'Kiracı' }, s.company_name));
  return savePdf(w, 'rental', rentalId, `${r.contract_no}-iade-tutanagi.pdf`, { doc: 'settlement' });
}

/** e-Arşiv fatura görünümü. */
export async function invoicePdf(invoiceId: number): Promise<StoredFile> {
  const s = await getSettings();
  const inv = await one<{ id: number; invoice_no: string; type: string; issue_date: string; subtotal: number; vat_rate: number; vat_amount: number; total: number; customer_id: number; rental_id: number | null; e_archive_uuid: string | null; notes: string | null }>(
    'SELECT * FROM invoices WHERE id = ?', invoiceId,
  );
  if (!inv) throw new HttpError(404, 'Fatura bulunamadı');
  const c = (await one<Customer>('SELECT * FROM customers WHERE id = ?', inv.customer_id))!;
  const lines = await all<{ description: string; quantity: number; unit_price: number; amount: number }>('SELECT * FROM invoice_lines WHERE invoice_id = ?', invoiceId);
  const w = await PdfWriter.create(`${inv.invoice_no} · e-Arşiv Fatura (entegratör bağlantısı yapılana kadar önizleme)`);
  w.header(await companyLines(), [inv.type === 'return' ? 'e-ARŞİV İADE FATURASI' : 'e-ARŞİV FATURA', `No: ${inv.invoice_no}`, `Tarih: ${d(inv.issue_date)}`, `ETTN: ${inv.e_archive_uuid ?? '(gönderilmedi)'}`]);
  w.heading('Alıcı', 10.5);
  w.kv([
    ['Unvan / Ad Soyad', c.invoice_title || customerName(c)], ['VKN / TCKN', c.tax_no || c.national_id || c.passport_no || '—'],
    ['Vergi dairesi', c.tax_office ?? '—'], ['Adres', c.invoice_address || c.address || '—'],
  ]);
  const vat = (n: number) => n / (1 + inv.vat_rate / 100);
  w.table(
    ['Açıklama', 'Miktar', 'Birim fiyat (KDV hariç)', 'Tutar (KDV hariç)'],
    [
      ...lines.map((l) => [l.description, String(l.quantity), money(vat(l.unit_price)), money(vat(l.amount))]),
      ['Mal/hizmet toplamı (matrah)', '', '', money(inv.subtotal)],
      [`KDV (%${inv.vat_rate})`, '', '', money(inv.vat_amount)],
      ['Ödenecek tutar', '', '', money(inv.total)],
    ],
    [4, 0.8, 1.6, 1.6],
    { totalRows: 3 },
  );
  if (inv.notes) w.text(`Not: ${inv.notes}`, { size: 8.5 });
  if (s.company_iban) w.text(`IBAN: ${s.company_iban}`, { size: 8.5 });
  return savePdf(w, 'invoice', invoiceId, `${inv.invoice_no}.pdf`, { doc: 'invoice' });
}

/** KABİS bildirim çıktısı (sözleşme dosyasına delil olarak eklenir). */
export async function kabisPdf(submissionId: number): Promise<StoredFile> {
  const k = await one<{ id: number; rental_id: number; kind: string; status: string; reference_no: string | null; payload: string; created_at: string; sent_at: string | null }>(
    'SELECT * FROM kabis_submissions WHERE id = ?', submissionId,
  );
  if (!k) throw new HttpError(404, 'Bildirim bulunamadı');
  const p = JSON.parse(k.payload);
  const w = await PdfWriter.create('KABİS bildirim çıktısı');
  w.header(await companyLines(), ['KABİS BİLDİRİMİ', k.kind === 'open' ? 'Kiralama başlangıcı' : 'Kiralama bitişi', `Durum: ${k.status}`, `Referans: ${k.reference_no ?? '-'}`]);
  w.kv([
    ['Sözleşme no', p.sozlesme_no], ['Plaka', p.arac?.plaka], ['Araç', `${p.arac?.marka} ${p.arac?.model}`], ['Şasi no', p.arac?.sasi_no ?? '—'],
    ['Kiracı', `${p.kiraci?.ad} ${p.kiraci?.soyad}`], ['T.C. / Pasaport', p.kiraci?.tc_kimlik_no || p.kiraci?.pasaport_no || '—'],
    ['Uyruk', p.kiraci?.uyruk ?? '—'], ['Ehliyet', `${p.kiraci?.ehliyet_no ?? '—'} (${p.kiraci?.ehliyet_sinifi ?? '-'})`],
    ['Başlangıç', dt(p.baslangic)], ['Bitiş', dt(p.bitis ?? p.planlanan_bitis)], ['Şube', p.sube?.ad ?? '—'], ['Km', String(p.km ?? '—')],
    ['Oluşturma', dt(k.created_at)], ['Gönderim', dt(k.sent_at)],
  ]);
  return savePdf(w, 'rental', k.rental_id, `kabis-${k.kind}-${p.sozlesme_no}.pdf`, { doc: 'kabis', submission_id: k.id });
}

/** Trafik cezası — kabahatliye bildirim / sürücüye devir yazısı. */
export async function fineLetterPdf(fineId: number): Promise<StoredFile> {
  const s = await getSettings();
  const f = await one<{ id: number; plate: string; fine_no: string | null; violation_at: string; type: string; location: string | null; amount: number; rental_id: number | null; customer_id: number | null }>(
    'SELECT * FROM traffic_fines WHERE id = ?', fineId,
  );
  if (!f || !f.rental_id || !f.customer_id) throw new HttpError(409, 'Ceza bir sözleşmeyle eşleşmemiş');
  const { r, c, v } = await loadRental(f.rental_id);
  const w = await PdfWriter.create('Sürücü devir yazısı');
  w.header(await companyLines(), ['KABAHATLİYE BİLDİRİM', `Tarih: ${d(new Date().toISOString())}`]);
  w.text('İlgili Makama,', { gap: 6 });
  w.text(
    `${f.fine_no ? f.fine_no + ' sayılı ' : ''}${dt(f.violation_at)} tarihli ${f.location ? f.location + ' konumunda tespit edilen ' : ''}${money(f.amount)} tutarındaki trafik idari para cezasına konu ${v.plate} plakalı araç, ` +
      `ihlal tarihinde şirketimizle yapılan ${r.contract_no} numaralı kira sözleşmesi (${dt(r.pickup_at)} – ${dt(r.actual_return_at ?? r.planned_return_at)}) kapsamında aşağıda kimlik bilgileri yazılı kiracının kullanımındadır.`,
    { gap: 8 },
  );
  w.kv([
    ['Ad Soyad', customerName(c)], ['T.C. / Pasaport', c.national_id || c.passport_no || '—'], ['Ehliyet no', c.license_no ?? '—'],
    ['Adres', c.address ?? '—'], ['Telefon', c.phone], ['Uyruk', c.nationality ?? '—'],
  ], 2);
  w.text('2918 sayılı Karayolları Trafik Kanunu ve 5326 sayılı Kabahatler Kanunu uyarınca cezanın sürücü adına düzenlenmesini arz ederiz. Kira sözleşmesi ve KABİS bildirim çıktısı ektedir.', { gap: 30 });
  w.text(s.company_name, { bold: true, align: 'right' });
  w.text('Kaşe / İmza', { align: 'right', color: undefined });
  return savePdf(w, 'fine', fineId, `ceza-devir-${f.plate}-${f.id}.pdf`, { doc: 'fine_letter' });
}
