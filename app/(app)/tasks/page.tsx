import type { Metadata } from 'next';
import Link from 'next/link';
import { TASK_TYPES, listTasks } from '@/lib/domain/tasks';
import { listBranches, listUsers } from '@/lib/domain/admin';
import { can } from '@/lib/permissions';
import { dt, money } from '@/lib/format';
import { flat, rentalOptions, vehicleOptions, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton, type FieldSpec } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'İş emirleri' };

const PRIORITY: Record<string, [string, '' | 'ok' | 'warn' | 'danger' | 'info']> = { low: ['Düşük', ''], normal: ['Normal', 'info'], high: ['Yüksek', 'warn'], urgent: ['Acil', 'danger'] };
const STATUS: Record<string, [string, '' | 'ok' | 'warn' | 'danger' | 'info' | 'violet']> = { open: ['Açık', 'warn'], in_progress: ['Devam ediyor', 'violet'], done: ['Tamamlandı', 'ok'], cancelled: ['İptal', ''] };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const rows = await listTasks({ ...q, status: q.status ?? 'open_all' }, user);
  const manage = can(user, 'tasks.manage');
  const vehicles = (await vehicleOptions()).map((v) => [v.id, v.label] as [number, string]);
  const users = (await listUsers()).filter((u) => u.active).map((u) => [u.id, u.full_name] as [number, string]);
  const fields: FieldSpec[] = [
    { name: 'type', label: 'Tip', type: 'select', options: Object.entries(TASK_TYPES), required: true, span: 4 },
    { name: 'priority', label: 'Öncelik', type: 'select', options: Object.entries(PRIORITY).map(([k, v]) => [k, v[0]] as [string, string]), span: 4 },
    { name: 'due_at', label: 'Termin', type: 'datetime-local', span: 4 },
    { name: 'title', label: 'Başlık', span: 12, placeholder: 'Boş bırakılırsa tip adı kullanılır' },
    { name: 'rental_id', label: 'Sözleşme', type: 'select', options: await rentalOptions(), empty: '—', span: 6 },
    { name: 'vehicle_id', label: 'Araç', type: 'select', options: vehicles, empty: '—', span: 6 },
    { name: 'replacement_vehicle_id', label: 'İkame araç (ikame iş emri)', type: 'select', options: vehicles, empty: '—', span: 6 },
    { name: 'assigned_to', label: 'Sorumlu', type: 'select', options: users, empty: 'Atanmadı', span: 6 },
    { name: 'branch_id', label: 'Şube', type: 'select', options: (await listBranches()).map((b) => [b.id, b.name] as [number, string]), empty: '—', span: 6 },
    { name: 'cost', label: 'Tahmini maliyet (₺)', type: 'number', span: 6 },
    { name: 'address', label: 'Adres / konum', span: 12 },
    { name: 'notes', label: 'Not', type: 'textarea', span: 12 },
  ];
  return (
    <>
      <PageHead
        title="Operasyon iş emirleri"
        sub="Adrese teslim/alım, valet, yıkama, yol yardım, ikame araç ve müşteri talepleri"
        actions={manage ? <FormButton title="Yeni iş emri" url="/api/tasks" fields={fields} className="primary" wide success="İş emri oluşturuldu">+ İş emri</FormButton> : null}
      />
      <Filters
        defaults={{ status: 'open_all' }}
        fields={[
          { name: 'status', type: 'select', empty: 'Tümü', options: [['open_all', 'Açık + devam eden'], ...Object.entries(STATUS).map(([k, v]) => [k, v[0]] as [string, string])] },
          { name: 'type', type: 'select', empty: 'Tüm tipler', options: Object.entries(TASK_TYPES) },
          { name: 'mine', type: 'select', empty: 'Herkes', options: [['1', 'Bana atanan / atanmamış']] },
        ]}
      />
      <Card>
        <Table cols={['Termin', 'Tip', 'Başlık', 'Araç / sözleşme', 'Adres', 'Sorumlu', 'Öncelik', 'Durum', '']} count={rows.length} empty="İş emri yok">
          {rows.map((t) => (
            <tr key={t.id} className={t.priority === 'urgent' && t.status !== 'done' ? 'row-alarm' : ''}>
              <td className="nowrap">{dt(t.due_at) || '—'}</td>
              <td>{TASK_TYPES[t.type] ?? t.type}</td>
              <td>{t.title}{t.notes ? <div className="muted small">{t.notes}</div> : null}</td>
              <td>
                {t.vehicle_id ? <Link href={`/vehicles/${t.vehicle_id}`}>{t.plate}</Link> : null}
                {t.replacement_plate ? <> → {t.replacement_plate}</> : null}
                {t.rental_id ? <div className="small"><Link href={`/rentals/${t.rental_id}`}>{t.contract_no}</Link></div> : null}
                {t.reservation_id ? <div className="small"><Link href={`/reservations/${t.reservation_id}`}>{t.reservation_code}</Link></div> : null}
              </td>
              <td className="small">{t.address}</td>
              <td>{t.assigned_name || <span className="muted">—</span>}<div className="muted small">{t.branch_name}</div></td>
              <td><Tag tone={PRIORITY[t.priority]?.[1] ?? ''}>{PRIORITY[t.priority]?.[0]}</Tag></td>
              <td><Tag tone={STATUS[t.status]?.[1] ?? ''}>{STATUS[t.status]?.[0]}</Tag>{t.cost ? <div className="muted small">{money(t.cost)}</div> : null}</td>
              <td className="right nowrap">
                {manage && t.status === 'open' ? <ActionButton url={`/api/tasks/${t.id}`} body={{ status: 'in_progress' }} className="sm">Başla</ActionButton> : null}{' '}
                {manage && (t.status === 'open' || t.status === 'in_progress') ? (
                  <>
                    <FormButton
                      title={`Tamamla · ${t.title}`}
                      url={`/api/tasks/${t.id}`}
                      extra={{ status: 'done' }}
                      className="sm success"
                      submitLabel="Tamamlandı"
                      success="İş emri tamamlandı"
                      defaults={{ cost: t.cost || '' }}
                      intro={t.type === 'replacement' ? <div className="alert info">Tamamlanınca sözleşmedeki araç ikame araçla değiştirilir.</div> : null}
                      fields={[
                        { name: 'cost', label: 'Gerçekleşen maliyet (₺)', type: 'number' },
                        ...(t.type === 'replacement'
                          ? ([
                              { name: 'old_vehicle_km', label: "Eski aracın km'si", type: 'number' },
                              { name: 'old_vehicle_status', label: 'Eski araç durumu', type: 'select', options: [['maintenance', 'Servise'], ['damaged', 'Hasarlı'], ['available', 'Müsait']] },
                            ] as FieldSpec[])
                          : []),
                      ]}
                    >
                      Tamamla
                    </FormButton>{' '}
                    <FormButton title="İş emri düzenle" url={`/api/tasks/${t.id}`} method="PUT" fields={fields} defaults={{ ...t }} className="sm" wide>Düzenle</FormButton>{' '}
                    <ActionButton url={`/api/tasks/${t.id}`} body={{ status: 'cancelled' }} className="sm danger" confirm="İş emri iptal edilsin mi?" okLabel="İptal et">İptal</ActionButton>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
