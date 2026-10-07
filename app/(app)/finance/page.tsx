import type { Metadata } from 'next';
import Link from 'next/link';
import { agencyStatement, receivablesAging } from '@/lib/domain/finance';
import { listAgencies } from '@/lib/domain/pricing';
import { d, dt, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, Table, Tabs, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';

export const metadata: Metadata = { title: 'Cari & alacak' };

export default async function FinancePage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('finance.manage')]);
  const tab = q.tab || 'aging';
  return (
    <>
      <PageHead title="Cari & alacak yönetimi" sub="Alacak yaşlandırma, acente komisyon ekstresi, müşteri cari ekstreleri (müşteri kartından)" />
      <Tabs items={[['aging', 'Alacak yaşlandırma'], ['agencies', 'Acente komisyonları']]} active={tab} base="/finance" />
      {tab === 'aging' ? <Aging /> : <Agencies q={q} />}
    </>
  );
}

async function Aging() {
  const a = await receivablesAging();
  return (
    <>
      <div className="grid grid-4 mb">
        {(['0-30', '31-60', '61-90', '90+'] as const).map((b) => (
          <Stat key={b} label={`${b} gün`} value={money(a.totals[b])} valueClass={b === '90+' && a.totals[b] > 0 ? 'danger-text' : ''} />
        ))}
      </div>
      <Card title={`Açık alacaklar · toplam ${money(a.total)}`}>
        <Table cols={['Sözleşme', 'Müşteri', 'Vade (iade)', ['Gün', 'num'], 'Dilim', ['Bakiye', 'num']]} count={a.rows.length} empty="Açık alacak yok">
          {a.rows.map((r) => (
            <tr key={r.rental_id}>
              <td><Link href={`/rentals/${r.rental_id}`}>{r.contract_no}</Link></td>
              <td><Link href={`/customers/${r.customer_id}/statement`}>{r.customer_name}</Link><div className="muted small">{r.phone}</div></td>
              <td>{dt(r.due_date)}</td>
              <td className="num">{r.age}</td>
              <td><Tag tone={r.bucket === '90+' ? 'danger' : r.bucket === '61-90' ? 'warn' : ''}>{r.bucket}</Tag></td>
              <td className="num danger-text">{money(r.balance)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

async function Agencies({ q }: { q: Record<string, string> }) {
  const s = await agencyStatement(q);
  return (
    <>
      <Filters
        defaults={{ from: s.from, to: s.to }}
        fields={[
          { name: 'agency_id', type: 'select', empty: 'Tüm acenteler', options: (await listAgencies()).map((a) => [a.id, a.name] as [number, string]) },
          { name: 'from', type: 'date', title: 'Başlangıç' },
          { name: 'to', type: 'date', title: 'Bitiş' },
        ]}
      />
      <div className="grid grid-3 mb">
        {s.agencies.map((a) => (
          <Stat key={a.agency_id} label={a.agency_name} value={money(a.commission)} hint={`${a.count} işlem · ciro ${money(a.total)}`} />
        ))}
      </div>
      <Card title={`${d(s.from)} – ${d(s.to)} komisyon ekstresi`}>
        <Table cols={['Acente', 'Belge', 'Müşteri', 'Alış', ['Tutar', 'num'], ['Komisyon', 'num'], 'Durum']} count={s.rows.length} empty="Bu dönemde acente işlemi yok">
          {s.rows.map((r) => (
            <tr key={`${r.kind}${r.id}`}>
              <td>{r.agency_name}</td>
              <td><Link href={r.kind === 'rental' ? `/rentals/${r.id}` : `/reservations/${r.id}`}>{r.ref}</Link></td>
              <td>{r.customer_name}</td>
              <td>{dt(r.pickup_at)}</td>
              <td className="num">{money(r.total)}</td>
              <td className="num">{money(r.commission)}</td>
              <td><Tag>{r.kind === 'rental' ? r.status : 'rezervasyon'}</Tag></td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
