import type { Metadata } from 'next';
import { PERMISSIONS, ROLE_LABELS, can, permissionsOf } from '@/lib/permissions';
import { CONTRACT_VARIABLES, listContractTemplates } from '@/lib/domain/templates';
import { LANGUAGES } from '@/lib/inspection';
import type { Role } from '@/lib/types';
import { getSettings } from '@/lib/db';
import { listBranches, listExtras, listUsers } from '@/lib/domain/admin';
import { money, text } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requireUser } from '@/lib/session';
import { Card, PageHead, Table, Tabs, Tag } from '@/components/ui';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton, type FieldSpec } from '@/components/client/FormButton';
import { BranchButton, ExtraButton, PasswordButton, SettingsForm, UserButton } from '@/components/dialogs/settings';

export const metadata: Metadata = { title: 'Ayarlar' };

const Active = ({ on }: { on: number }) => (on ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>);

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q, user] = await Promise.all([flat(searchParams), requireUser()]);
  const admin = can(user, 'settings.manage');
  const userAdmin = can(user, 'users.manage');
  const tabs: [string, string][] = [
    ['general', 'Genel & kurallar'],
    ['branches', 'Şubeler'],
    ['extras', 'Ek hizmetler'],
    ['contracts', 'Sözleşme şablonları'],
    ...(userAdmin ? ([['users', 'Kullanıcılar'], ['roles', 'Rol / yetki matrisi']] as [string, string][]) : []),
    ['account', 'Hesabım'],
  ];
  const branches = listBranches();
  const tplFields: FieldSpec[] = [
    { name: 'name', label: 'Şablon adı', required: true, span: 8 },
    { name: 'language', label: 'Dil', type: 'select', options: Object.entries(LANGUAGES), span: 4 },
    { name: 'body', label: `Metin — değişkenler: ${CONTRACT_VARIABLES.map((v) => `{{${v}}}`).join(' ')}`, type: 'textarea', span: 12 },
  ];
  const tab = tabs.some(([k]) => k === q.tab) ? q.tab : 'general';

  return (
    <>
      <PageHead title="Ayarlar" sub={admin ? 'Sistem yapılandırması' : 'Yalnızca yöneticiler ayarları değiştirebilir'} />
      <Tabs items={tabs} active={tab} base="/settings" />

      {tab === 'general' ? <SettingsForm settings={(({ smtp_pass, ...rest }) => ({ ...rest, smtp_pass: smtp_pass ? '***' : '' }))(getSettings())} editable={admin} /> : null}

      {tab === 'branches' ? (
        <>
          {admin ? <div className="actions mb"><BranchButton label="+ Şube" className="primary" /></div> : null}
          <Card>
            {(() => {
              const rows = branches;
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
                      <td><strong>{x.name}</strong> {x.code ? <Tag tone="violet">{x.code}</Tag> : null}<div className="muted small">{x.description}</div></td>
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

      {tab === 'contracts' ? (
        <Card
          title="Çok dilli sözleşme şablonları (düzenleme yeni versiyon oluşturur; imzalı sözleşmeler kendi versiyonunu korur)"
          actions={admin ? <FormButton title="Yeni şablon" url="/api/contract-templates" fields={tplFields} defaults={{ language: 'tr' }} className="sm primary" wide>+ Şablon</FormButton> : null}
        >
          {(() => {
            const rows = listContractTemplates();
            return (
              <Table cols={['Şablon', 'Dil', ['Versiyon', 'num'], 'Metin', 'Durum', '']} count={rows.length}>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td><strong>{t.name}</strong></td>
                    <td>{LANGUAGES[t.language as keyof typeof LANGUAGES] ?? t.language}</td>
                    <td className="num">v{t.version}</td>
                    <td className="small" style={{ maxWidth: 480 }}>{t.body.slice(0, 180)}{t.body.length > 180 ? '…' : ''}</td>
                    <td><Active on={t.active} /></td>
                    <td className="right nowrap">
                      {admin && t.active ? (
                        <FormButton title={`${t.name} (${t.language}) — yeni versiyon`} url={`/api/contract-templates/${t.id}`} method="PUT" fields={tplFields} defaults={{ ...t }} className="sm" wide submitLabel="Yeni versiyon kaydet">
                          Düzenle
                        </FormButton>
                      ) : null}{' '}
                      {admin ? (
                        <ActionButton url={`/api/contract-templates/${t.id}`} method="PUT" body={{ name: t.name, language: t.language, body: t.body }} className="sm" success="Bu metinle yeni aktif versiyon oluşturuldu">
                          {t.active ? 'Kopyala' : 'Geri yükle'}
                        </ActionButton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </Table>
            );
          })()}
        </Card>
      ) : null}

      {tab === 'roles' && userAdmin ? (
        <Card title="Rol bazlı yetki matrisi (RBAC)">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Yetki</th>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <th key={r} className="small">{ROLE_LABELS[r]}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMISSIONS).map(([p, label]) => (
                  <tr key={p}>
                    <td>{label} <span className="muted small mono">{p}</span></td>
                    {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                      <td key={r} className="center">{permissionsOf(r).includes(p as keyof typeof PERMISSIONS) ? '✅' : ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-body muted small">Şubeye bağlı kullanıcılar (yönetici hariç) yalnızca kendi şubesinin araç, rezervasyon ve sözleşmelerini görür.</div>
        </Card>
      ) : null}

      {tab === 'users' && userAdmin ? (
        <>
          <div className="actions mb"><UserButton label="+ Kullanıcı" className="primary" roles={ROLE_LABELS} branches={branches} /></div>
          <Card>
            {(() => {
              const rows = listUsers();
              return (
                <Table cols={['Kullanıcı adı', 'Ad soyad', 'Rol', 'Şube', ['İndirim limiti', 'num'], 'Durum', '']} count={rows.length}>
                  {rows.map((u) => (
                    <tr key={u.id}>
                      <td><strong>{u.username}</strong></td>
                      <td>{u.full_name}<div className="muted small">{u.email}</div></td>
                      <td>{ROLE_LABELS[u.role]}</td>
                      <td>{branches.find((b) => b.id === u.branch_id)?.name ?? <span className="muted">Tümü</span>}</td>
                      <td className="num">%{u.discount_limit_pct}</td>
                      <td><Active on={u.active} /></td>
                      <td className="right"><UserButton user={u} label="Düzenle" className="sm" roles={ROLE_LABELS} branches={branches} /></td>
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
              <dt>Rol</dt><dd>{ROLE_LABELS[user.role]}</dd>
              <dt>Şube</dt><dd>{branches.find((b) => b.id === user.branch_id)?.name ?? 'Tüm şubeler'}</dd>
              <dt>İndirim limiti</dt><dd>%{user.discount_limit_pct}</dd>
            </dl>
            <PasswordButton />
          </div>
        </div>
      ) : null}
    </>
  );
}
