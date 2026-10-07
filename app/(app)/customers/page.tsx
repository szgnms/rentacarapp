import type { Metadata } from 'next';
import { listCustomers } from '@/lib/domain/fleet';
import { customerName, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { Card, PageHead, Table, Tag } from '@/components/ui';
import { ClickRow, Filters } from '@/components/client/Filters';
import { CustomerButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Müşteriler' };

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const rows = listCustomers(await flat(searchParams));
  return (
    <>
      <PageHead title="Müşteriler" sub="Bireysel ve kurumsal müşteri kayıtları" actions={<CustomerButton className="primary">+ Müşteri ekle</CustomerButton>} />
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Ad, telefon, T.C., ehliyet no ara…' },
          { name: 'blacklisted', type: 'select', empty: 'Tümü', options: [['0', 'Aktif'], ['1', 'Kara liste']] },
        ]}
      />
      <Card>
        <Table cols={['Müşteri', 'Telefon', 'E-posta', 'Kimlik', 'Ehliyet', ['Kiralama', 'num'], ['Toplam', 'num'], '']} count={rows.length}>
          {rows.map((c) => (
            <ClickRow key={c.id} href={`/customers/${c.id}`}>
              <td><strong>{customerName(c)}</strong> {c.type === 'corporate' ? <Tag tone="violet">Kurumsal</Tag> : null}</td>
              <td className="nowrap">{c.phone}</td>
              <td>{c.email}</td>
              <td>{c.national_id || c.passport_no || '—'}</td>
              <td>{c.license_no || <span className="muted">—</span>}</td>
              <td className="num">{c.rental_count}</td>
              <td className="num">{money(c.total_spent)}</td>
              <td>{c.blacklisted ? <Tag tone="danger">Kara liste</Tag> : null}</td>
            </ClickRow>
          ))}
        </Table>
      </Card>
    </>
  );
}
