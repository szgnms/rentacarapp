import type { Metadata } from 'next';
import { pricingData } from '@/lib/domain/pricing';
import { CATEGORIES, DAY_BANDS } from '@/lib/rules';
import { getSettings } from '@/lib/db';
import { can } from '@/lib/permissions';
import { d, money } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tabs, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton, type FieldSpec } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'Fiyatlandırma' };

const CATS = CATEGORIES.map((c) => [c, c] as [string, string]);

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const p = await pricingData();
  const s = await getSettings();
  const edit = can(user, 'pricing.manage');
  const tab = q.tab || 'plans';
  const seasons = p.seasons.map((x) => [x.id, x.name] as [number, string]);
  const channels = p.channels.map((x) => [x.code, x.name] as [string, string]);

  const F: Record<string, FieldSpec[]> = {
    plan: [
      { name: 'name', label: 'Plan adı', required: true, span: 6 },
      { name: 'category', label: 'Araç grubu', type: 'select', options: CATS, required: true, span: 6 },
      { name: 'season_id', label: 'Sezon', type: 'select', options: seasons, empty: 'Tüm yıl (sezon dışı)', span: 6 },
      { name: 'channel', label: 'Kanal', type: 'select', options: channels, empty: 'Tüm kanallar', span: 6 },
      ...DAY_BANDS.map(([k, l]) => ({ name: k, label: `${l} günlük (₺)`, type: 'number' as const, required: true, span: 4 })),
      { name: 'active', label: 'Aktif', type: 'checkbox', span: 4 },
    ],
    season: [
      { name: 'name', label: 'Sezon adı', required: true, span: 12 },
      { name: 'start_date', label: 'Başlangıç', type: 'date', required: true, span: 4 },
      { name: 'end_date', label: 'Bitiş', type: 'date', required: true, span: 4 },
      { name: 'priority', label: 'Öncelik (çakışmada büyük kazanır)', type: 'number', span: 4 },
    ],
    channel: [
      { name: 'code', label: 'Kod', required: true, span: 4 },
      { name: 'name', label: 'Ad', required: true, span: 8 },
      { name: 'markup_pct', label: 'Fiyat farkı % (+/-)', type: 'number', span: 6 },
      { name: 'commission_pct', label: 'Komisyon %', type: 'number', span: 6 },
      { name: 'active', label: 'Aktif', type: 'checkbox', span: 6 },
    ],
    coupon: [
      { name: 'code', label: 'Kod', required: true, span: 4 },
      { name: 'type', label: 'Tip', type: 'select', options: [['percent', 'Yüzde'], ['amount', 'Tutar (₺)']], span: 4 },
      { name: 'value', label: 'Değer', type: 'number', required: true, span: 4 },
      { name: 'description', label: 'Açıklama', span: 12 },
      { name: 'valid_from', label: 'Geçerlilik başlangıç', type: 'date', span: 6 },
      { name: 'valid_to', label: 'Geçerlilik bitiş', type: 'date', span: 6 },
      { name: 'min_days', label: 'Min. gün', type: 'number', span: 4 },
      { name: 'early_booking_days', label: 'Erken rezervasyon (alıştan en az gün önce)', type: 'number', span: 4 },
      { name: 'max_uses', label: 'Maks. kullanım (0 = sınırsız)', type: 'number', span: 4 },
      { name: 'category', label: 'Yalnızca grup', type: 'select', options: CATS, empty: 'Tüm gruplar', span: 6 },
      { name: 'active', label: 'Aktif', type: 'checkbox', span: 6 },
    ],
    deposit_rule: [
      { name: 'category', label: 'Araç grubu', type: 'select', options: CATS, empty: 'Tüm gruplar', span: 6 },
      { name: 'amount', label: 'Depozito (₺)', type: 'number', required: true, span: 6 },
      { name: 'driver_age_under', label: 'Sürücü yaşı şundan küçükse', type: 'number', span: 6 },
      { name: 'license_years_under', label: 'Ehliyet yılı şundan azsa', type: 'number', span: 6 },
      { name: 'note', label: 'Açıklama', span: 12 },
    ],
    agency: [
      { name: 'name', label: 'Acente / broker', required: true, span: 8 },
      { name: 'commission_pct', label: 'Komisyon %', type: 'number', span: 4 },
      { name: 'contact_name', label: 'Yetkili', span: 6 },
      { name: 'phone', label: 'Telefon', span: 6 },
      { name: 'email', label: 'E-posta', type: 'email', span: 6 },
      { name: 'tax_no', label: 'Vergi no', span: 6 },
      { name: 'active', label: 'Aktif', type: 'checkbox', span: 6 },
    ],
  };
  const add = (kind: string, label: string, defaults: Record<string, string | number | boolean> = {}) =>
    edit ? <FormButton title={label} url={`/api/pricing/${kind}`} fields={F[kind]} defaults={{ active: true, ...defaults }} className="sm primary" wide success="Kaydedildi">+ {label}</FormButton> : null;
  const row = (kind: string, id: string | number, rec: Record<string, unknown>, name: string) =>
    edit ? (
      <td className="right nowrap">
        <FormButton title={`${name} düzenle`} url={`/api/pricing/${kind}/${id}`} method="PUT" fields={F[kind]} defaults={{ ...(rec as Record<string, string>), active: !!rec.active }} className="sm" wide>Düzenle</FormButton>{' '}
        <ActionButton url={`/api/pricing/${kind}/${id}`} method="DELETE" className="sm danger" confirm={`${name} kaldırılsın/pasifleştirilsin mi?`} okLabel="Evet">Kaldır</ActionButton>
      </td>
    ) : <td />;

  return (
    <>
      <PageHead
        title="Fiyatlandırma & kampanya"
        sub={`Öncelik: elle fiyat > sezon+kanal planı > genel plan > araç liste fiyatı (+%${s.weekly_discount_pct} haftalık / %${s.monthly_discount_pct} aylık). Fiyatlar KDV (%${s.vat_rate}) dahildir.`}
      />
      <Tabs
        items={[['plans', `Fiyat tabloları (${p.plans.length})`], ['seasons', `Sezonlar (${p.seasons.length})`], ['channels', `Kanallar (${p.channels.length})`], ['coupons', `Kupon/kampanya (${p.coupons.length})`], ['deposit', `Depozito kuralları (${p.deposit_rules.length})`], ['agencies', `Acenteler (${p.agencies.length})`]]}
        active={tab}
        base="/pricing"
      />
      {tab === 'plans' ? (
        <Card title="Grup × sezon × kanal × gün bandı günlük fiyatlar" actions={add('plan', 'Fiyat planı')}>
          <Table cols={['Plan', 'Grup', 'Sezon', 'Kanal', ...DAY_BANDS.map(([, l]) => [l, 'num'] as [string, string]), 'Durum', '']} count={p.plans.length} empty="Fiyat planı yok — araçların liste fiyatı kullanılır">
            {p.plans.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.name}</strong></td>
                <td>{x.category}</td>
                <td>{x.season_name || <span className="muted">Tüm yıl</span>}</td>
                <td>{x.channel || <span className="muted">Tümü</span>}</td>
                {DAY_BANDS.map(([k]) => <td key={k} className="num">{money(x[k])}</td>)}
                <td>{x.active ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
                {row('plan', x.id, x as unknown as Record<string, unknown>, x.name)}
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      {tab === 'seasons' ? (
        <Card actions={add('season', 'Sezon')}>
          <Table cols={['Sezon', 'Başlangıç', 'Bitiş', ['Öncelik', 'num'], '']} count={p.seasons.length}>
            {p.seasons.map((x) => (
              <tr key={x.id}><td>{x.name}</td><td>{d(x.start_date)}</td><td>{d(x.end_date)}</td><td className="num">{x.priority}</td>{row('season', x.id, x as unknown as Record<string, unknown>, x.name)}</tr>
            ))}
          </Table>
        </Card>
      ) : null}
      {tab === 'channels' ? (
        <Card actions={add('channel', 'Kanal')}>
          <Table cols={['Kod', 'Kanal', ['Fiyat farkı', 'num'], ['Komisyon', 'num'], 'Durum', '']} count={p.channels.length}>
            {p.channels.map((x) => (
              <tr key={x.code}><td className="mono">{x.code}</td><td>{x.name}</td><td className="num">%{x.markup_pct}</td><td className="num">%{x.commission_pct}</td><td>{x.active ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>}</td>{row('channel', x.code, x as unknown as Record<string, unknown>, x.name)}</tr>
            ))}
          </Table>
        </Card>
      ) : null}
      {tab === 'coupons' ? (
        <Card actions={add('coupon', 'Kupon', { type: 'percent' })}>
          <Table cols={['Kod', 'İndirim', 'Koşullar', 'Geçerlilik', ['Kullanım', 'num'], 'Durum', '']} count={p.coupons.length}>
            {p.coupons.map((x) => (
              <tr key={x.id}>
                <td className="mono"><strong>{x.code}</strong><div className="muted small">{x.description}</div></td>
                <td>{x.type === 'percent' ? `%${x.value}` : money(x.value)}</td>
                <td className="small">
                  {[x.min_days ? `min ${x.min_days} gün` : null, x.early_booking_days ? `${x.early_booking_days} gün önceden` : null, x.category].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="small">{x.valid_from ? d(x.valid_from) : '…'} – {x.valid_to ? d(x.valid_to) : '…'}</td>
                <td className="num">{x.used_count}{x.max_uses ? ` / ${x.max_uses}` : ''}</td>
                <td>{x.active ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
                {row('coupon', x.id, x as unknown as Record<string, unknown>, x.code)}
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      {tab === 'deposit' ? (
        <Card title="Depozito kuralları (en yüksek eşleşen kural uygulanır; araç depozitosunun altına inmez)" actions={add('deposit_rule', 'Kural')}>
          <Table cols={['Grup', 'Koşul', ['Depozito', 'num'], 'Açıklama', '']} count={p.deposit_rules.length}>
            {p.deposit_rules.map((x) => (
              <tr key={x.id}>
                <td>{x.category || 'Tümü'}</td>
                <td className="small">{[x.driver_age_under !== null ? `yaş < ${x.driver_age_under}` : null, x.license_years_under !== null ? `ehliyet < ${x.license_years_under} yıl` : null].filter(Boolean).join(' · ') || 'Her müşteri'}</td>
                <td className="num">{money(x.amount)}</td>
                <td>{x.note}</td>
                {row('deposit_rule', x.id, x as unknown as Record<string, unknown>, 'Kural')}
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
      {tab === 'agencies' ? (
        <Card actions={add('agency', 'Acente')}>
          <Table cols={['Acente', 'Yetkili', 'İletişim', ['Komisyon', 'num'], 'Durum', '']} count={p.agencies.length}>
            {p.agencies.map((x) => (
              <tr key={x.id}>
                <td><strong>{x.name}</strong><div className="muted small">{x.tax_no}</div></td>
                <td>{x.contact_name}</td>
                <td className="small">{x.phone}<div>{x.email}</div></td>
                <td className="num">%{x.commission_pct}</td>
                <td>{x.active ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
                {row('agency', x.id, x as unknown as Record<string, unknown>, x.name)}
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </>
  );
}
