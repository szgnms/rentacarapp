import type { Metadata } from 'next';
import { EXPENSE_CATEGORIES, listExpenses } from '@/lib/domain/service';
import { d, money, todayStr } from '@/lib/format';
import { flat, vehicleOptions, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { ExpenseButton } from '@/components/dialogs/forms';

export const metadata: Metadata = { title: 'Masraflar' };

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const defaults = { from: todayStr().slice(0, 8) + '01', to: todayStr() };
  const rows = await listExpenses({ ...defaults, ...q });
  const vehicles = await vehicleOptions();
  const total = rows.reduce((a, x) => a + x.amount, 0);
  return (
    <>
      <PageHead title="Masraflar" sub="Genel ve araç bazlı giderler" actions={<ExpenseButton vehicles={vehicles} className="primary">+ Masraf</ExpenseButton>} />
      <Filters
        defaults={defaults}
        fields={[
          { name: 'from', type: 'date', title: 'Başlangıç' },
          { name: 'to', type: 'date', title: 'Bitiş' },
          { name: 'category', type: 'select', empty: 'Tüm kategoriler', options: EXPENSE_CATEGORIES },
        ]}
      />
      <Card>
        <Table cols={['Tarih', 'Kategori', 'Araç', 'Açıklama', ['Tutar', 'num'], '']} count={rows.length}>
          {rows.map((x) => (
            <ExpenseButton key={x.id} record={x} vehicles={vehicles} asRow>
              <td>{d(x.expense_date)}</td>
              <td>{x.category}</td>
              <td>{x.plate || <span className="muted">Genel</span>}</td>
              <td>{x.description}</td>
              <td className="num">{money(x.amount)}</td>
              <td className="right">
                {user.role === 'admin' ? <ActionButton url={`/api/expenses/${x.id}`} method="DELETE" className="sm" confirm="Masraf silinsin mi?" okLabel="Sil" success="Silindi">Sil</ActionButton> : null}
              </td>
            </ExpenseButton>
          ))}
        </Table>
        <div className="card-body right"><strong>Toplam: {money(total)}</strong></div>
      </Card>
    </>
  );
}
