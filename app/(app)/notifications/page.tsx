import type { Metadata } from 'next';
import Link from 'next/link';
import { CHANNELS, TRIGGERS, listMessages } from '@/lib/domain/notify';
import { listNotificationTemplates } from '@/lib/domain/templates';
import { getSettings } from '@/lib/db';
import { dt } from '@/lib/format';
import { flat, type SearchParams } from '@/lib/page';
import { requirePerm } from '@/lib/session';
import { Card, PageHead, Table, Tabs, Tag } from '@/components/ui';
import { Filters } from '@/components/client/Filters';
import { ActionButton } from '@/components/client/ActionButton';
import { FormButton, type FieldSpec } from '@/components/client/FormButton';

export const metadata: Metadata = { title: 'Bildirimler' };

const CH: Record<string, string> = { email: 'E-posta', sms: 'SMS', whatsapp: 'WhatsApp' };
const ST: Record<string, [string, '' | 'ok' | 'warn' | 'danger']> = { queued: ['Kuyrukta', 'warn'], sent: ['Gönderildi', 'ok'], failed: ['Hata', 'danger'], skipped: ['Atlandı (rıza/adres yok)', ''] };
const LANGS: [string, string][] = [['tr', 'Türkçe'], ['en', 'English'], ['de', 'Deutsch'], ['ru', 'Русский']];

const TPL_FIELDS: FieldSpec[] = [
  { name: 'code', label: 'Tetikleyici', type: 'select', options: Object.entries(TRIGGERS), required: true, span: 4 },
  { name: 'channel', label: 'Kanal', type: 'select', options: CHANNELS.map((c) => [c, CH[c]] as [string, string]), span: 4 },
  { name: 'language', label: 'Dil', type: 'select', options: LANGS, span: 4 },
  { name: 'subject', label: 'Konu (e-posta)', span: 12 },
  { name: 'body', label: 'Metin — değişkenler: {{customer_name}} {{contract_no}} {{plate}} {{pickup_at}} {{return_at}} {{amount}} {{portal_url}} {{company_name}}', type: 'textarea', span: 12 },
  { name: 'marketing', label: 'Ticari ileti (İYS rızası gerekir)', type: 'checkbox', span: 6 },
  { name: 'active', label: 'Aktif', type: 'checkbox', span: 6 },
];

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const [q] = await Promise.all([flat(searchParams), requirePerm('notifications.manage')]);
  const tab = q.tab || 'log';
  const s = getSettings();
  return (
    <>
      <PageHead
        title="Bildirim motoru"
        sub="Olay tetiklemeli e-posta / SMS / WhatsApp; şablon × dil × kanal; ticari iletilerde İYS rızası kontrolü"
        actions={<ActionButton url="/api/automation" className="primary" success="Otomasyon çalıştı: hatırlatmalar, opsiyon iptalleri ve e-posta kuyruğu işlendi">▶ Otomasyonu şimdi çalıştır</ActionButton>}
      />
      <div className="alert info">
        E-posta: {s.smtp_host ? <>SMTP <strong>{s.smtp_host}</strong> üzerinden gönderilir.</> : <>SMTP tanımlı değil — e-postalar kuyrukta kalır.</>} SMS ve WhatsApp sağlayıcı entegrasyonu
        simülasyon modundadır (mesajlar kaydedilir). Otomatik hatırlatmalar: {s.notify_auto === '1' ? 'açık' : 'kapalı'} · <Link href="/settings">Ayarlar →</Link>
      </div>
      <Tabs items={[['log', 'Gönderim kaydı'], ['templates', 'Şablonlar']]} active={tab} base="/notifications" />
      {tab === 'log' ? <Log q={q} /> : <Templates />}
    </>
  );
}

function Log({ q }: { q: Record<string, string> }) {
  const rows = listMessages(q);
  return (
    <>
      <Filters
        fields={[
          { name: 'q', type: 'search', placeholder: 'Alıcı, konu, metin ara…' },
          { name: 'status', type: 'select', empty: 'Tüm durumlar', options: Object.entries(ST).map(([k, v]) => [k, v[0]] as [string, string]) },
          { name: 'channel', type: 'select', empty: 'Tüm kanallar', options: Object.entries(CH) },
        ]}
      />
      <Card>
        <Table cols={['Zaman', 'Tetikleyici', 'Kanal', 'Alıcı', 'İçerik', 'Durum', '']} count={rows.length} empty="Gönderim yok">
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="nowrap small">{dt(m.created_at.replace(' ', 'T'))}</td>
              <td className="small">{TRIGGERS[m.template_code ?? ''] ?? m.template_code}</td>
              <td>{CH[m.channel] ?? m.channel}</td>
              <td className="small">{m.customer_id ? <Link href={`/customers/${m.customer_id}`}>{m.to_address || '—'}</Link> : m.to_address}</td>
              <td className="small" style={{ maxWidth: 420 }}>{m.subject ? <strong>{m.subject}<br /></strong> : null}{m.body.slice(0, 200)}{m.body.length > 200 ? '…' : ''}{m.attachments ? <div className="muted">📎 ek</div> : null}</td>
              <td><Tag tone={ST[m.status]?.[1] ?? ''}>{ST[m.status]?.[0] ?? m.status}</Tag>{m.error ? <div className="small danger-text">{m.error}</div> : null}</td>
              <td>{m.status === 'failed' ? <ActionButton url={`/api/notifications/${m.id}/retry`} className="sm" success="Yeniden kuyruğa alındı">Tekrar</ActionButton> : null}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function Templates() {
  const rows = listNotificationTemplates();
  return (
    <Card actions={<FormButton title="Yeni şablon" url="/api/notification-templates" fields={TPL_FIELDS} defaults={{ active: true, language: 'tr', channel: 'email' }} className="sm primary" wide>+ Şablon</FormButton>}>
      <Table cols={['Tetikleyici', 'Kanal', 'Dil', 'Konu / metin', 'Tür', 'Durum', '']} count={rows.length}>
        {rows.map((t) => (
          <tr key={t.id}>
            <td>{TRIGGERS[t.code] ?? t.code}</td>
            <td>{CH[t.channel]}</td>
            <td>{t.language.toUpperCase()}</td>
            <td className="small" style={{ maxWidth: 460 }}>{t.subject ? <strong>{t.subject}<br /></strong> : null}{t.body.slice(0, 160)}{t.body.length > 160 ? '…' : ''}</td>
            <td>{t.marketing ? <Tag tone="warn">Ticari</Tag> : <Tag>Bilgilendirme</Tag>}</td>
            <td>{t.active ? <Tag tone="ok">Aktif</Tag> : <Tag>Pasif</Tag>}</td>
            <td><FormButton title="Şablon düzenle" url={`/api/notification-templates/${t.id}`} method="PUT" fields={TPL_FIELDS} defaults={{ ...t, marketing: !!t.marketing, active: !!t.active }} className="sm" wide>Düzenle</FormButton></td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}
