import type { Metadata } from 'next';
import Link from 'next/link';
import { getRental } from '@/lib/domain/bookings';
import { getSettings } from '@/lib/db';
import { FUEL, customerName, d, dt, money, numf, text } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { PrintButton } from '@/components/client/PrintButton';

export const metadata: Metadata = { title: 'Kira sözleşmesi' };

export default async function ContractPage({ params }: { params: IdParams }) {
  const { id } = await params;
  const r = orNotFound(() => getRental(Number(id)));
  const s = getSettings();
  const c = r.customer;
  const v = r.vehicle;
  return (
    <>
      <div className="no-print actions mb">
        <Link className="btn" href={`/rentals/${r.id}`}>← Geri</Link>
        <PrintButton />
      </div>
      <div className="contract">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 16 }}>
          <div>
            <h1>{s.company_name}</h1>
            <div>{s.company_address}</div>
            <div>{s.company_phone}</div>
            {s.company_tax_no ? <div>VKN: {s.company_tax_no}</div> : null}
          </div>
          <div className="right">
            <h1>ARAÇ KİRALAMA SÖZLEŞMESİ</h1>
            <div>No: <strong>{r.contract_no}</strong></div>
            <div>Tarih: {dt(r.created_at)}</div>
          </div>
        </div>
        <h3 style={{ margin: '18px 0 6px' }}>Kiracı</h3>
        <table>
          <tbody>
            <tr><th>Ad Soyad</th><td>{customerName(c)}</td><th>T.C. / Pasaport</th><td>{c.national_id || c.passport_no}</td></tr>
            <tr><th>Telefon</th><td>{c.phone}</td><th>E-posta</th><td>{c.email}</td></tr>
            <tr><th>Ehliyet no / sınıf</th><td>{c.license_no} / {c.license_class}</td><th>Ehliyet tarihi</th><td>{d(c.license_date)}</td></tr>
            <tr><th>Adres</th><td colSpan={3}>{c.address}</td></tr>
            {r.additional_driver ? <tr><th>Ek sürücü</th><td colSpan={3}>{r.additional_driver}</td></tr> : null}
          </tbody>
        </table>
        <h3 style={{ margin: '18px 0 6px' }}>Araç ve kiralama</h3>
        <table>
          <tbody>
            <tr><th>Plaka</th><td>{v.plate}</td><th>Marka / Model</th><td>{v.brand} {v.model} ({v.year})</td></tr>
            <tr><th>Teslim</th><td>{dt(r.pickup_at)} · {r.pickup_branch_name}</td><th>Dönüş</th><td>{dt(r.planned_return_at)} · {r.return_branch_name}</td></tr>
            <tr>
              <th>Çıkış km / yakıt</th><td>{numf(r.start_km)} / {FUEL(r.start_fuel)}</td>
              <th>Dönüş km / yakıt</th><td>{r.end_km !== null ? `${numf(r.end_km)} / ${FUEL(r.end_fuel)}` : '………… / ……'}</td>
            </tr>
            <tr>
              <th>Km limiti</th><td>{v.km_limit_per_day ? `${v.km_limit_per_day} km/gün (aşım ${money(v.extra_km_fee)}/km)` : 'Sınırsız'}</td>
              <th>Depozito</th><td>{money(r.deposit_amount)}</td>
            </tr>
          </tbody>
        </table>
        <h3 style={{ margin: '18px 0 6px' }}>Ücretler</h3>
        <table>
          <tbody>
            <tr><td>{r.days} gün × {money(r.daily_rate)}</td><td className="num">{money(r.base_amount)}</td></tr>
            {r.long_term_discount ? <tr><td>Uzun dönem indirimi</td><td className="num">-{money(r.long_term_discount)}</td></tr> : null}
            {r.extras.map((x) => <tr key={x.extra_id}><td>{x.name}{x.quantity > 1 ? ` ×${x.quantity}` : ''}</td><td className="num">{money(x.amount)}</td></tr>)}
            {r.one_way_fee ? <tr><td>Tek yön ücreti</td><td className="num">{money(r.one_way_fee)}</td></tr> : null}
            {r.discount ? <tr><td>İndirim</td><td className="num">-{money(r.discount)}</td></tr> : null}
            {r.charges.map((x) => <tr key={x.id}><td>{text('chargeType', x.type)}{x.description ? ` — ${x.description}` : ''}</td><td className="num">{money(x.amount)}</td></tr>)}
            <tr><th>TOPLAM (KDV %{s.vat_rate} dahil)</th><th className="num">{money(r.total_amount)}</th></tr>
            <tr><td>Ödenen</td><td className="num">{money(r.finance.paid)}</td></tr>
            <tr><td>Kalan</td><td className="num">{money(r.finance.balance)}</td></tr>
          </tbody>
        </table>
        {r.checkout_notes ? <p><strong>Teslim notları:</strong> {r.checkout_notes}</p> : null}
        <h3 style={{ margin: '18px 0 6px' }}>Genel şartlar</h3>
        <p style={{ fontSize: 12, whiteSpace: 'pre-line' }}>{s.contract_terms}</p>
        <div className="sig">
          <div>Kiraya veren<br />{s.company_name}</div>
          <div>Kiracı<br />{customerName(c)}</div>
        </div>
      </div>
    </>
  );
}
