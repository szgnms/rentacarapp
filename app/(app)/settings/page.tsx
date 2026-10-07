import type { Metadata } from 'next';
import { getSettings } from '@/lib/db';
import { listBranches, listExtras, listUsers } from '@/lib/domain/admin';
import { money, text } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tabs, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { BranchButton, ExtraButton, PasswordButton, SettingsForm, UserButton } from '@/components/dialogs/settings';

export const metadata: Metadata = { title: 'Ayarlar' };

const Active = ({ on }: { on: number }) => (on ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>);

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const admin = user.role === 'admin';
  const tabs: [string, string][] = [
    ['general', 'Genel & fiyat kuralları'],
    ['branches', 'Şubeler'],
    ['extras', 'Ek hizmetler'],
    ...(admin ? ([['users', 'Kullanıcılar']] as [string, string][]) : []),
    ['account', 'Hesabım'],
  ];
  const tab = tabs.some(([k]) => k === q.tab) ? q.tab : 'general';

  return (
    <>
      <PageHead title="Ayarlar" sub={admin ? 'Sistem yapılandırması' : 'Yalnızca yöneticiler ayarları değiştirebilir'} />
      <Tabs items={tabs} active={tab} base="/settings" />

      {tab === 'general' ? <SettingsForm settings={getSettings()} editable={admin} /> : null}

      {tab === 'branches' ? (
        <>
          {admin ? <div className="actions mb"><BranchButton label="+ Şube" className="primary" /></div> : null}
          <Card>
            {(() => {
              const rows = listBranches();
              return (
                <Table cols={['Şube', 'Şehir', 'Adres', 'Telefon', 'Durum', '']} count={rows.length}>
                  {rows.map((b) => (
                    <tr key={b.id}>
                      <td><strong>{b.name}</strong></td>
                      <td>{b.city}</td>
                      <td>{b.address}</td>
                      <td>{b.phone}</td>
                      <td><Active on={b.active} /></td>
                      <td className="right nowrap">
                        {admin ? (
                          <>
                            <BranchButton branch={b} label="Düzenle" className="sm" />{' '}
                            <ActionButton url={`/api/branches/${b.id}`} method="DELETE" className="sm danger" confirm="Şube silinsin mi? (Kullanımdaysa pasife alınır)" okLabel="Sil">Sil</ActionButton>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </Table>
              );
            })()}
          </Card>
        </>
      ) : null}

      {tab === 'extras' ? (
        <>
          {admin ? <div className="actions mb"><ExtraButton label="+ Ek hizmet" className="primary" /></div> : null}
          <Card>
            {(() => {
              const rows = listExtras();
              return (
                <Table cols={['Hizmet', 'Fiyat tipi', ['Fiyat', 'num'], ['Üst limit', 'num'], 'Durum', '']} count={rows.length}>
                  {rows.map((x) => (
                    <tr key={x.id}>
                      <td><strong>{x.name}</strong></td>
                      <td>{x.price_type === 'daily' ? 'Günlük' : 'Kiralama başı'}</td>
                      <td className="num">{money(x.price)}</td>
                      <td className="num">{x.max_price ? money(x.max_price) : '—'}</td>
                      <td><Active on={x.active} /></td>
                      <td className="right nowrap">
                        {admin ? (
                          <>
                            <ExtraButton extra={x} label="Düzenle" className="sm" />{' '}
                            <ActionButton url={`/api/extras/${x.id}`} method="DELETE" className="sm danger" confirm="Ek hizmet silinsin mi? (Kullanımdaysa pasife alınır)" okLabel="Sil">Sil</ActionButton>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </Table>
              );
            })()}
          </Card>
        </>
      ) : null}

      {tab === 'users' && admin ? (
        <>
          <div className="actions mb"><UserButton label="+ Kullanıcı" className="primary" /></div>
          <Card>
            {(() => {
              const rows = listUsers();
              return (
                <Table cols={['Kullanıcı adı', 'Ad soyad', 'Rol', 'Durum', '']} count={rows.length}>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td><strong>{u.username}</strong></td>
                      <td>{u.full_name}</td>
                      <td>{text('role', u.role)}</td>
                      <td><Active on={u.active} /></td>
                      <td className="right"><UserButton user={u} label="Düzenle" className="sm" /></td>
                    </tr>
                  ))}
                </Table>
              );
            })()}
          </Card>
        </>
      ) : null}

      {tab === 'account' ? (
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="card-body">
            <dl className="kv mb">
              <dt>Kullanıcı</dt><dd>{user.username}</dd>
              <dt>Ad soyad</dt><dd>{user.full_name}</dd>
              <dt>Rol</dt><dd>{text('role', user.role)}</dd>
            </dl>
            <PasswordButton />
          </div>
        </div>
      ) : null}
    </>
  );
}
