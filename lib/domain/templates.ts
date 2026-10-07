// Sözleşme şablonları (çok dilli, versiyonlu) ve bildirim şablonları.
import { all, insertRow, one, run, updateRow } from '../db';
import { HttpError, bool, mustGet, oneOf, required, str } from '../core';
import { audit } from '../audit';
import { CHANNELS, TRIGGERS, type NotificationTemplate } from './notify';
import type { Body, SessionUser } from '../types';

export interface ContractTemplate {
  id: number;
  name: string;
  language: string;
  version: number;
  body: string;
  active: number;
  created_at: string;
}

export const CONTRACT_VARIABLES = [
  'contract_no', 'customer_name', 'plate', 'pickup_at', 'return_at', 'return_branch', 'start_km', 'start_fuel', 'km_limit', 'deposit', 'hold_days', 'company_name',
];

export const listContractTemplates = () => all<ContractTemplate>('SELECT * FROM contract_templates ORDER BY language, name, version DESC');

/** Düzenleme yeni versiyon oluşturur; önceki versiyon (imzalı sözleşmelerde kullanılmış olabilir) korunur. */
export async function saveContractTemplate(id: number | null, b: Body, user: SessionUser): Promise<ContractTemplate> {
  required(b, [['name', 'Ad'], ['body', 'Metin']]);
  const language = oneOf(b.language, ['tr', 'en', 'de', 'ru'] as const, 'Dil', 'tr');
  let version = 1;
  if (id) {
    const old = await mustGet<ContractTemplate>('contract_templates', id, 'Şablon');
    version = ((await one<{ v: number }>('SELECT MAX(version) v FROM contract_templates WHERE name = ? AND language = ?', old.name, old.language))?.v ?? old.version) + 1;
    await run('UPDATE contract_templates SET active = 0 WHERE name = ? AND language = ?', old.name, old.language);
  }
  const newId = await insertRow('contract_templates', { name: str(b.name), language, version, body: String(b.body), active: 1, created_by: user.id });
  await audit('template.contract', 'contract_template', newId, { version, language });
  return mustGet<ContractTemplate>('contract_templates', newId);
}

export async function setContractTemplateActive(id: number, active: unknown) {
  await mustGet('contract_templates', id, 'Şablon');
  await updateRow('contract_templates', id, { active: bool(active) });
  return listContractTemplates();
}

export const listNotificationTemplates = () => all<NotificationTemplate>('SELECT * FROM notification_templates ORDER BY code, channel, language');

export async function saveNotificationTemplate(id: number | null, b: Body): Promise<NotificationTemplate> {
  required(b, [['code', 'Tetikleyici'], ['channel', 'Kanal'], ['body', 'Metin']]);
  const data = {
    code: oneOf(b.code, Object.keys(TRIGGERS), 'Tetikleyici'),
    channel: oneOf(b.channel, CHANNELS, 'Kanal'),
    language: oneOf(b.language, ['tr', 'en', 'de', 'ru'] as const, 'Dil', 'tr'),
    subject: str(b.subject),
    body: String(b.body),
    marketing: bool(b.marketing),
    active: b.active === undefined ? 1 : bool(b.active),
  };
  const dup = await one<{ id: number }>('SELECT id FROM notification_templates WHERE code = ? AND channel = ? AND language = ?', data.code, data.channel, data.language);
  if (dup && dup.id !== id) throw new HttpError(409, 'Bu tetikleyici/kanal/dil için şablon zaten var');
  if (id) await updateRow('notification_templates', id, data);
  else id = await insertRow('notification_templates', data);
  await audit('template.notification', 'notification_template', id, { code: data.code, channel: data.channel });
  return mustGet<NotificationTemplate>('notification_templates', id);
}
