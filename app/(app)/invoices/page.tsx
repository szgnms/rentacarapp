import type { Metadata } from 'next';
import Link from 'next/link';
import { listInvoices } from '@/lib/domain/finance';
import { d, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Stat, Table, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'Faturalar' };

const STATUS: Record<string, [string, '' | 'ok' | 'warn' | 'danger' | 'info']> = { issued: ['Düzenlendi', 'info'], sent: ['Gönderildi', 'ok'], cancelled: ['İptal', 'danger'] };

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('finance.manage')]);
  const rows = await listInvoices(q);
  const live = rows.filter((r) => r.status !== 'cancelled');
  const sales = live.filter((r) => r.type === 'sale');
  const returns = live.filter((r) => r.type === 'return');
  return (
    <>
      <PageHead title="Faturalar (e-Arşiv)" sub="Sözleşme kapanışında otomatik kesilir; kapanış sonrası ücretler için fark faturası, iadeler için iade faturası. e-Arşiv entegrasyonu simülasyon modundadır." />
      <div className="grid grid-4 mb">
        <Stat label="Satış faturası" value={sales.length} hint={money(sales.reduce((a, r) => a + r.total, 0))} />
        <Stat label="İade faturası" value={returns.length} hint={money(returns.reduce((a, r) => a + r.total, 0))} />
        <Stat label="KDV toplamı" value={money(sales.reduce((a, r) => a + r.vat_amount, 0) - returns.reduce((a, r) => a + r.vat_amount, 0))} />
        <Stat label="Net ciro (KDV dahil)" value={money(sales.reduce((a, r) => a + r.total, 0) - returns.reduce((a, r) => a + r.total, 0))} />
      </div>
      <Filters
        fields={[
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: Object.entries(STATUS).map(([k, v]) => [k, v[0]] as [string, string]) },
          { name: 'from', type: 'date', title: 'Başlangıç' },
          { name: 'to', type: 'date', title: 'Bitiş' },
        ]}
      />
      <Card>
        <Table cols={['No', 'Tarih', 'Tip', 'Müşteri', 'Sözleşme', ['Matrah', 'num'], ['KDV', 'num'], ['Toplam', 'num'], 'Durum', '']} count={rows.length} empty="Fatura yok">
          {rows.map((i) => (
            <tr key={i.id}>
              <td>{i.pdf_file_id ? <a href={`/api/files/${i.pdf_file_id}`} target="_blank" rel="noreferrer"><strong>{i.invoice_no}</strong></a> : <strong>{i.invoice_no}</strong>}<div className="muted small mono">{i.e_archive_uuid?.slice(0, 13)}</div></td>
              <td>{d(i.issue_date)}</td>
              <td>{i.type === 'return' ? <Tag tone="warn">İade</Tag> : <Tag>Satış</Tag>}</td>
              <td><Link href={`/customers/${i.customer_id}`}>{i.customer_name}</Link></td>
              <td>{i.rental_id ? <Link href={`/rentals/${i.rental_id}`}>{i.contract_no}</Link> : '—'}</td>
              <td className="num">{money(i.subtotal)}</td>
              <td className="num">{money(i.vat_amount)} <span className="muted small">%{i.vat_rate}</span></td>
              <td className="num">{money(i.total)}</td>
              <td><Tag tone={STATUS[i.status]?.[1] ?? ''}>{STATUS[i.status]?.[0] ?? i.status}</Tag></td>
              <td className="right nowrap">
                {i.status === 'issued' ? <ActionButton url={`/api/invoices/${i.id}/send`} className="sm" success="Fatura müşteriye gönderildi">Gönder</ActionButton> : null}{' '}
                {i.status !== 'cancelled' && i.type === 'sale' ? (
                  <FormButton
                    title={`İade faturası · ${i.invoice_no}`}
                    url={`/api/invoices/${i.id}/credit`}
                    className="sm"
                    success="İade faturası oluşturuldu"
                    defaults={{ amount: i.total }}
                    fields={[{ name: 'amount', label: 'İade tutarı (KDV dahil, ₺)', type: 'number', required: true }, { name: 'reason', label: 'Gerekçe', required: true }]}
                  >
                    İade fat.
                  </FormButton>
                ) : null}{' '}
                {i.status !== 'cancelled' ? (
                  <ActionButton url={`/api/invoices/${i.id}/cancel`} className="sm danger" confirm="Fatura iptal edilsin mi? (e-Arşiv iptali aynı gün içinde yapılabilir)" reasonLabel="Gerekçe" okLabel="İptal et" success="Fatura iptal edildi">İptal</ActionButton>
                ) : null}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
