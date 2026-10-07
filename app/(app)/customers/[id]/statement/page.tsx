import type { Metadata } from 'next';
import Link from 'next/link';
import { customerStatement } from '@/lib/domain/finance';
import { getSettings } from '@/lib/db';
import { customerName, dt, money } from '@/lib/format';
import { orNotFound, type IdParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Stat, Table } from '@/components/ui';
import { PrintButton } from '@/components/client/PrintButton';

export const metadata: Metadata = { title: 'Cari ekstre' };

export default async function StatementPage({ params }: { params: IdParams }) {
  const [{ id }] = await Promise.all([params, requireUser()]);
  const s = orNotFound(() => customerStatement(Number(id)));
  const company = getSettings().company_name;
  return (
    <>
      <PageHead
        title={`Cari ekstre · ${customerName(s.customer)}`}
        sub={`${company} · ${dt(new Date().toISOString().slice(0, 16))}`}
        actions={<><Link className="btn no-print" href={`/customers/${s.customer.id}`}>← Müşteri</Link><PrintButton /></>}
      />
      <div className="grid grid-3 mb">
        <Stat label="Bakiye (borç)" value={money(s.balance)} valueClass={s.balance > 0.009 ? 'danger-text' : ''} />
        <Stat label="Tutulan depozito" value={money(s.deposit_held)} />
        <Stat label="Kredi limiti" value={s.credit_limit ? money(s.credit_limit) : '—'} hint={s.credit_limit ? `Kullanılabilir ${money(s.credit_limit - s.balance)}` : undefined} />
      </div>
      <Card>
        <Table cols={['Tarih', 'Açıklama', 'Belge', ['Borç', 'num'], ['Alacak', 'num'], ['Bakiye', 'num']]} count={s.lines.length} empty="Hareket yok">
          {s.lines.map((l, i) => (
            <tr key={i}>
              <td className="nowrap">{dt(l.date)}</td>
              <td>{l.description}</td>
              <td>{l.link ? <Link href={l.link}>{l.ref}</Link> : l.ref}</td>
              <td className="num">{l.debit ? money(l.debit) : ''}</td>
              <td className="num">{l.credit ? money(l.credit) : ''}</td>
              <td className={`num ${l.balance > 0.009 ? 'danger-text' : ''}`}>{money(l.balance)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
