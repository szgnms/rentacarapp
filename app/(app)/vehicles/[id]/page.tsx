import type { Metadata } from 'next';
import Link from 'next/link';
import { DOCUMENT_TYPES, getVehicle } from '@/lib/domain/vehicles';
import { FINE_TYPES } from '@/lib/domain/tolls';
import { can } from '@/lib/permissions';
import { listBranches } from '@/lib/domain/admin';
import { addDays, fmtDate, today } from '@/lib/core';
import { d, dt, money, numf, text } from '@/lib/format';
import { flat, orNotFound, vehicleOptions, type IdParams, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Badge, Card, PageHead, Stat, Table, Tabs, Tag } from '@/components/ui';
import { FormButton } from '@/components/client/FormButton';
import { ClickRow } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { DamageButton, ExpenseButton, MaintenanceButton, VehicleButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Araç' };

function Expiry({ date }: { date: string | null }) {
  if (!date) return <span className="muted">—</span>;
  if (date < today()) return <span className="danger-text">{d(date)} (süresi doldu)</span>;
  if (date <= fmtDate(addDays(new Date(), 30))) return <span className="badge warn">{d(date)}</span>;
  return <>{d(date)}</>;
}

export default async function VehiclePage({ params, searchParams }: { params: IdParams; searchParams: SearchParams }) {
  const [{ id }, q, user] = await Promise.all([params, flat(searchParams), requireUser()]);
  const v = orNotFound(() => getVehicle(Number(id)));
  const branches = listBranches();
  const vehicles = vehicleOptions();
  const tab = q.tab || 'rentals';
  const tabs: [string, string][] = [
    ['rentals', `Kiralamalar (${v.rentals.length})`],
    ['reservations', `Rezervasyonlar (${v.reservations.length})`],
    ['maintenance', `Bakım (${v.maintenance.length})`],
    ['damages', `Hasar (${v.damages.length})`],
    ['expenses', `Masraflar (${v.expenses.length})`],
    ['documents', `Belgeler (${v.documents.length})`],
    ['transfers', `Transfer (${v.transfers.length})`],
    ['tolls', `HGS (${v.tolls.length})`],
    ['fines', `Cezalar (${v.fines.length})`],
  ];
  const fleet = can(user, 'fleet.write');
  const branchOpts = branches.filter((b) => b.active && b.id !== v.branch_id).map((b) => [b.id, b.name] as const);
  const docFields = [
    { name: 'type', label: 'Belge tipi', type: 'select' as const, options: Object.entries(DOCUMENT_TYPES), span: 6 },
    { name: 'number', label: 'Poliçe / belge no', span: 6 },
    { name: 'provider', label: 'Sigorta şirketi / kurum', span: 6 },
    { name: 'cost', label: 'Bedel (₺)', type: 'number' as const, span: 6 },
    { name: 'issued_at', label: 'Başlangıç', type: 'date' as const, span: 6 },
    { name: 'expires_at', label: 'Bitiş', type: 'date' as const, span: 6 },
    { name: 'file_id', label: 'Belge dosyası (PDF/fotoğraf)', type: 'file' as const, entity: 'vehicle', entityId: v.id, span: 12 },
    { name: 'notes', label: 'Not', type: 'textarea' as const, span: 12 },
  ];

  return (
    <>
      <PageHead
        title={<>{v.plate} <Badge group="vehicleStatus" value={v.status} /></>}
        sub={`${v.brand} ${v.model} · ${v.year ?? ''} · ${v.category}`}
        actions={
          <>
            {v.status === 'available' ? <Link className="btn primary" href={`/booking?vehicle_id=${v.id}`}>Kirala / Rezerve et</Link> : null}
            <VehicleButton vehicle={v} branches={branches}>Düzenle</VehicleButton>
            {fleet && v.status === 'available' ? (
              <FormButton
                title={`${v.plate} şube transferi`}
                url="/api/transfers"
                extra={{ vehicle_id: v.id }}
                success="Transfer emri oluşturuldu"
                fields={[
                  { name: 'to_branch_id', label: 'Hedef şube', type: 'select', options: branchOpts, required: true },
                  { name: 'planned_at', label: 'Planlanan çıkış', type: 'datetime-local' },
                  { name: 'driver', label: 'Transfer şoförü' },
                  { name: 'cost', label: 'Maliyet (₺)', type: 'number' },
                  { name: 'notes', label: 'Not', type: 'textarea', span: 12 },
                ]}
              >
                🔁 Transfer
              </FormButton>
            ) : null}
            {fleet ? (
              <FormButton
                title="HGS bakiye yükleme"
                url={`/api/vehicles/${v.id}/hgs-topup`}
                success="HGS bakiyesi yüklendi"
                fields={[{ name: 'amount', label: 'Tutar (₺)', type: 'number', required: true, span: 12 }]}
                intro={<div className="muted small mb">Etiket: {v.hgs_tag_no || 'tanımsız'} · Mevcut bakiye {money(v.hgs_balance)} — tutar masraf olarak da kaydedilir.</div>}
              >
                HGS yükle
              </FormButton>
            ) : null}
            {fleet && ['available', 'for_sale', 'out_of_service', 'damaged'].includes(v.status) ? (
              <FormButton
                title={`${v.plate} satışı`}
                url={`/api/vehicles/${v.id}/sell`}
                className="danger"
                submitLabel="Satışı kaydet"
                success="Araç satıldı olarak işaretlendi"
                defaults={{ sale_price: v.depreciation?.book_value ?? '' }}
                fields={[
                  { name: 'sold_at', label: 'Satış tarihi', type: 'date' },
                  { name: 'sale_price', label: 'Satış bedeli (₺)', type: 'number', required: true },
                ]}
                intro={v.depreciation ? <div className="alert info">Defter değeri: {money(v.depreciation.book_value)} · Aylık amortisman {money(v.depreciation.monthly)}</div> : null}
              >
                Sat / filodan çıkar
              </FormButton>
            ) : null}
            {user.role === 'admin' ? (
              <ActionButton url={`/api/vehicles/${v.id}`} method="DELETE" className="danger" confirm={`${v.plate} plakalı araç silinsin mi?`} okLabel="Sil" success="Araç silindi" redirectTo="/vehicles">Sil</ActionButton>
            ) : null}
          </>
        }
      />
      <div className="grid grid-4 mb">
        <Stat label="Toplam ciro" value={money(v.stats.revenue)} />
        <Stat label="Kiralanan gün" value={numf(v.stats.rented_days)} />
        <Stat label="Bakım + masraf" value={money(v.stats.costs)} />
        <Stat label="Net katkı" value={money(v.stats.profit)} />
      </div>
      <div className="grid grid-2 mb">
        <Card title="Araç bilgileri">
          <div className="card-body">
            <dl className="kv">
              <dt>Yakıt / Vites</dt><dd>{v.fuel_type} / {v.transmission}</dd>
              <dt>Koltuk / Renk</dt><dd>{v.seats} / {v.color || '—'}</dd>
              <dt>Şasi no</dt><dd>{v.vin || '—'}</dd>
              {v.trim || v.acriss ? <><dt>Donanım / ACRISS</dt><dd>{v.trim || '—'} / {v.acriss || '—'}</dd></> : null}
              <dt>Şube / otopark</dt><dd>{v.branch_name || '—'}{v.parking_spot ? ` · ${v.parking_spot}` : ''}</dd>
              <dt>Güncel km</dt><dd>{numf(v.current_km)} km</dd>
              <dt>Sonraki bakım</dt><dd>{v.next_service_km ? `${numf(v.next_service_km)} km` : '—'}{v.next_service_date ? ` / ${d(v.next_service_date)}` : ''}</dd>
              <dt>HGS</dt><dd>{v.hgs_tag_no || '—'} · bakiye {money(v.hgs_balance)}</dd>
              {v.active_contract ? <><dt>Aktif sözleşme</dt><dd>{v.active_contract} (dönüş {dt(v.active_return_at)})</dd></> : null}
              {v.notes ? <><dt>Notlar</dt><dd>{v.notes}</dd></> : null}
            </dl>
          </div>
        </Card>
        <Card title="Fiyat, belgeler & değer">
          <div className="card-body">
            <dl className="kv">
              <dt>Günlük fiyat</dt><dd>{money(v.daily_rate)}</dd>
              <dt>Depozito</dt><dd>{money(v.deposit_amount)}</dd>
              <dt>Km limiti</dt><dd>{v.km_limit_per_day ? `${v.km_limit_per_day} km/gün, aşım ${money(v.extra_km_fee)}/km` : 'Sınırsız'}</dd>
              <dt>Trafik sigortası</dt><dd><Expiry date={v.insurance_expiry} /></dd>
              <dt>Kasko</dt><dd><Expiry date={v.kasko_expiry} /></dd>
              <dt>Muayene</dt><dd><Expiry date={v.inspection_expiry} /></dd>
              {v.purchase_price ? <><dt>Alış</dt><dd>{money(v.purchase_price)} · {d(v.purchase_date)} {v.financing ? `· ${({ cash: 'Peşin', loan: 'Kredi', leasing: 'Leasing' } as Record<string, string>)[v.financing] ?? v.financing}` : ''}</dd></> : null}
              {v.monthly_installment ? <><dt>Aylık taksit</dt><dd>{money(v.monthly_installment)}</dd></> : null}
              {v.depreciation ? <><dt>Defter değeri</dt><dd>{money(v.depreciation.book_value)} <span className="muted small">({v.depreciation.months} ay × {money(v.depreciation.monthly)})</span></dd></> : null}
              {v.sold_at ? <><dt>Satış</dt><dd>{d(v.sold_at)} · {money(v.sale_price)}</dd></> : null}
            </dl>
          </div>
        </Card>
      </div>
      <Card>
        <div className="card-body">
          <Tabs items={tabs} active={tab} base={`/vehicles/${v.id}`} />
          {tab === 'rentals' ? (
            <Table cols={['Sözleşme', 'Müşteri', 'Teslim', 'Dönüş', ['Km', 'num'], ['Tutar', 'num'], 'Durum']} count={v.rentals.length}>
              {v.rentals.map((r) => (
                <ClickRow key={r.id} href={`/rentals/${r.id}`}>
                  <td>{r.contract_no}</td>
                  <td>{r.customer_name}</td>
                  <td>{dt(r.pickup_at)}</td>
                  <td>{dt(r.actual_return_at || r.planned_return_at)}</td>
                  <td className="num">{r.end_km !== null ? numf(r.end_km - r.start_km) : '—'}</td>
                  <td className="num">{money(r.total_amount)}</td>
                  <td><Badge group="rentalStatus" value={r.status} /></td>
                </ClickRow>
              ))}
            </Table>
          ) : null}
          {tab === 'reservations' ? (
            <Table cols={['Kod', 'Müşteri', 'Alış', 'Dönüş', ['Tutar', 'num'], 'Durum']} count={v.reservations.length}>
              {v.reservations.map((r) => (
                <ClickRow key={r.id} href={`/reservations/${r.id}`}>
                  <td>{r.code}</td>
                  <td>{r.customer_name}</td>
                  <td>{dt(r.pickup_at)}</td>
                  <td>{dt(r.return_at)}</td>
                  <td className="num">{money(r.total_amount)}</td>
                  <td><Badge group="reservationStatus" value={r.status} /></td>
                </ClickRow>
              ))}
            </Table>
          ) : null}
          {tab === 'maintenance' ? (
            <>
              <div className="actions mb">
                <MaintenanceButton vehicles={vehicles} defaults={{ vehicle_id: v.id, km: v.current_km }} className="sm primary">+ Bakım kaydı</MaintenanceButton>
              </div>
              <Table cols={['Tarih', 'Tip', 'Açıklama', 'Servis', ['Km', 'num'], ['Maliyet', 'num'], 'Durum']} count={v.maintenance.length}>
                {v.maintenance.map((m) => (
                  <MaintenanceButton key={m.id} record={m} vehicles={vehicles} asRow>
                    <td className="nowrap">{d(m.start_date)}{m.end_date && m.end_date !== m.start_date ? ` → ${d(m.end_date)}` : ''}</td>
                    <td>{text('maintenanceType', m.type)}</td>
                    <td>{m.description}</td>
                    <td>{m.vendor}</td>
                    <td className="num">{m.km ? numf(m.km) : ''}</td>
                    <td className="num">{money(m.cost)}</td>
                    <td><Badge group="maintenanceStatus" value={m.status} /></td>
                  </MaintenanceButton>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'damages' ? (
            <>
              <div className="actions mb">
                <DamageButton vehicles={vehicles} defaults={{ vehicle_id: v.id }} className="sm primary">+ Hasar kaydı</DamageButton>
              </div>
              <Table cols={['Tarih', 'Konum', 'Açıklama', 'Önem', ['Onarım', 'num'], ['Müşteriye', 'num'], 'Durum']} count={v.damages.length}>
                {v.damages.map((x) => (
                  <DamageButton key={x.id} record={x} vehicles={vehicles} asRow>
                    <td>{d(x.reported_at)}</td>
                    <td>{x.location}</td>
                    <td>{x.description}</td>
                    <td><Badge group="severity" value={x.severity} /></td>
                    <td className="num">{money(x.repair_cost)}</td>
                    <td className="num">{money(x.customer_charge)}</td>
                    <td><Badge group="damageStatus" value={x.status} /></td>
                  </DamageButton>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'expenses' ? (
            <>
              <div className="actions mb">
                <ExpenseButton vehicles={vehicles} defaults={{ vehicle_id: v.id }} className="sm primary">+ Masraf</ExpenseButton>
              </div>
              <Table cols={['Tarih', 'Kategori', 'Açıklama', ['Tutar', 'num']]} count={v.expenses.length}>
                {v.expenses.map((x) => (
                  <ExpenseButton key={x.id} record={x} vehicles={vehicles} asRow>
                    <td>{d(x.expense_date)}</td>
                    <td>{x.category}</td>
                    <td>{x.description}</td>
                    <td className="num">{money(x.amount)}</td>
                  </ExpenseButton>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'documents' ? (
            <>
              {fleet ? (
                <div className="actions mb">
                  <FormButton title="Yeni belge" url="/api/vehicle-documents" extra={{ vehicle_id: v.id }} fields={docFields} className="sm primary" success="Belge kaydedildi">+ Belge</FormButton>
                </div>
              ) : null}
              <Table cols={['Tip', 'No', 'Kurum', 'Başlangıç', 'Bitiş', ['Bedel', 'num'], 'Dosya', '']} count={v.documents.length}>
                {v.documents.map((x) => (
                  <tr key={x.id}>
                    <td>{DOCUMENT_TYPES[x.type] ?? x.type}</td>
                    <td>{x.number}</td>
                    <td>{x.provider}</td>
                    <td>{d(x.issued_at)}</td>
                    <td><Expiry date={x.expires_at} /></td>
                    <td className="num">{x.cost ? money(x.cost) : ''}</td>
                    <td>{x.file_id ? <a href={`/api/files/${x.file_id}`} target="_blank" rel="noreferrer">📎 Aç</a> : ''}</td>
                    <td className="right nowrap">
                      {fleet ? (
                        <>
                          <FormButton title="Belge düzenle" url={`/api/vehicle-documents/${x.id}`} method="PUT" fields={docFields} defaults={{ ...x, file_id: null }} className="sm">Düzenle</FormButton>{' '}
                          <ActionButton url={`/api/vehicle-documents/${x.id}`} method="DELETE" className="sm danger" confirm="Belge silinsin mi?" okLabel="Sil">Sil</ActionButton>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            </>
          ) : null}
          {tab === 'transfers' ? (
            <Table cols={['Talep', 'Nereden', 'Nereye', 'Şoför', 'Çıkış', 'Varış', ['Km', 'num'], ['Maliyet', 'num'], 'Durum']} count={v.transfers.length}>
              {v.transfers.map((t) => (
                <tr key={t.id}>
                  <td>{dt(t.planned_at || t.created_at)}</td>
                  <td>{t.from_branch || '—'}</td>
                  <td>{t.to_branch}</td>
                  <td>{t.driver}</td>
                  <td>{dt(t.departed_at)}</td>
                  <td>{dt(t.arrived_at)}</td>
                  <td className="num">{t.km ?? ''}</td>
                  <td className="num">{money(t.cost)}</td>
                  <td><Tag tone={t.status === 'completed' ? 'ok' : t.status === 'cancelled' ? '' : 'violet'}>{TRANSFER_STATUS[t.status]}</Tag></td>
                </tr>
              ))}
            </Table>
          ) : null}
          {tab === 'tolls' ? (
            <Table cols={['Geçiş', 'Yer', 'Sözleşme', ['Tutar', 'num'], 'Durum']} count={v.tolls.length}>
              {v.tolls.map((t) => (
                <tr key={t.id}>
                  <td>{dt(t.passed_at)}</td>
                  <td>{t.location}</td>
                  <td>{t.contract_no || '—'}</td>
                  <td className="num">{money(t.amount)}</td>
                  <td><Tag>{STATUS_TR[t.status] ?? t.status}</Tag></td>
                </tr>
              ))}
            </Table>
          ) : null}
          {tab === 'fines' ? (
            <Table cols={['İhlal', 'Tip', 'Sözleşme', ['Tutar', 'num'], 'Durum']} count={v.fines.length}>
              {v.fines.map((t) => (
                <tr key={t.id}>
                  <td>{dt(t.violation_at)}</td>
                  <td>{FINE_TYPES[t.type] ?? t.type}</td>
                  <td>{t.contract_no || '—'}</td>
                  <td className="num">{money(t.amount)}</td>
                  <td><Tag>{STATUS_TR[t.status] ?? t.status}</Tag></td>
                </tr>
              ))}
            </Table>
          ) : null}
        </div>
      </Card>
    </>
  );
}

const STATUS_TR: Record<string, string> = {
  unmatched: 'Eşleşmedi', matched: 'Eşleşti', charged: 'Yansıtıldı', company: 'Şirket', disputed: 'İtirazlı', new: 'Yeni',
  transferred: 'Devredildi', paid: 'Ödendi', objected: 'İtiraz', closed: 'Kapandı', cancelled: 'İptal',
};
const TRANSFER_STATUS: Record<string, string> = { requested: 'Talep', in_transit: 'Yolda', completed: 'Tamamlandı', cancelled: 'İptal' };
