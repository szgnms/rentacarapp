'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Field, Options } from '../ui';

type Opt = readonly (string | readonly [string | number, string])[];

export type FieldSpec =
  | { name: string; label: string; type?: 'text' | 'number' | 'date' | 'datetime-local' | 'email' | 'tel' | 'password'; required?: boolean; span?: number; step?: string; placeholder?: string }
  | { name: string; label: string; type: 'select'; options: Opt; empty?: string; required?: boolean; span?: number }
  | { name: string; label: string; type: 'textarea'; span?: number; placeholder?: string }
  | { name: string; label: string; type: 'checkbox'; span?: number }
  | { name: string; label: string; type: 'file'; entity: string; entityId: number; kind?: string; accept?: string; span?: number }
  | { name: string; label: string; type: 'hidden' };

interface Props {
  title: ReactNode;
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  fields: FieldSpec[];
  defaults?: Record<string, string | number | boolean | null | undefined>;
  /** Gönderilecek sabit alanlar. */
  extra?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
  submitLabel?: string;
  success?: string | ((result: unknown) => string);
  intro?: ReactNode;
  wide?: boolean;
  redirectTo?: (result: unknown) => string;
}

/** Alan tanımından üretilen basit form diyaloğu: dosya alanları önce /api/files'a yüklenir, kimliği gövdeye eklenir. */
export function FormButton({ title, url, method = 'POST', fields, defaults = {}, extra, children, className, submitLabel, success = 'Kaydedildi', intro, wide, redirectTo }: Props) {
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);
  const router = useRouter();
  const toast = useToast();
  const dv = (k: string) => {
    const v = defaults[k];
    return v === null || v === undefined ? '' : String(v);
  };
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <Modal
          title={title}
          wide={wide}
          submitLabel={submitLabel}
          onClose={hide}
          onSubmit={async (d, form) => {
            const body: Record<string, unknown> = { ...extra, ...d };
            for (const f of fields) {
              if (f.type !== 'file') continue;
              const input = form.querySelector<HTMLInputElement>(`input[type=file][data-name="${f.name}"]`);
              const file = input?.files?.[0];
              delete body[f.name];
              if (!file) continue;
              const fd = new FormData();
              fd.set('file', file);
              fd.set('entity', f.entity);
              fd.set('entity_id', String(f.entityId));
              fd.set('kind', f.kind ?? 'document');
              const res = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
              const j = await res.json().catch(() => null);
              if (!res.ok) throw new Error(j?.error || 'Dosya yüklenemedi');
              body[f.name] = j.id;
            }
            const result = await api(method, url, method === 'DELETE' ? undefined : body);
            toast(typeof success === 'function' ? success(result) : success);
            if (redirectTo) router.push(redirectTo(result));
            else router.refresh();
          }}
        >
          {intro}
          <div className="form-grid">
            {fields.map((f) => {
              const cls = f.type === 'hidden' ? '' : `c${f.span ?? 6}`;
              switch (f.type) {
                case 'hidden':
                  return <input key={f.name} type="hidden" name={f.name} defaultValue={dv(f.name)} />;
                case 'select':
                  return (
                    <Field key={f.name} label={f.label} className={cls}>
                      <select name={f.name} defaultValue={dv(f.name)} required={f.required}><Options list={f.options} empty={f.empty} /></select>
                    </Field>
                  );
                case 'textarea':
                  return <Field key={f.name} label={f.label} className={cls}><textarea name={f.name} defaultValue={dv(f.name)} placeholder={f.placeholder} /></Field>;
                case 'checkbox':
                  return (
                    <label key={f.name} className={`check ${cls}`}>
                      <input type="checkbox" name={f.name} defaultChecked={!!defaults[f.name]} /> {f.label}
                    </label>
                  );
                case 'file':
                  return <Field key={f.name} label={f.label} className={cls}><input type="file" data-name={f.name} data-skip accept={f.accept ?? 'image/*,application/pdf'} /></Field>;
                default:
                  return (
                    <Field key={f.name} label={f.label} className={cls}>
                      <input type={f.type ?? 'text'} name={f.name} defaultValue={dv(f.name)} required={f.required} step={f.step ?? (f.type === 'number' ? '0.01' : undefined)} placeholder={f.placeholder} />
                    </Field>
                  );
              }
            })}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
