'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Field } from '../ui';

interface Props {
  url: string;
  method?: 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
  children: ReactNode;
  className?: string;
  /** Onay sorusu; verilirse önce modal açılır. */
  confirm?: string;
  /** Onay modalında metin alanı (ör. iptal nedeni) — değeri body.reason olarak gönderilir. */
  reasonLabel?: string;
  okLabel?: string;
  success?: string;
  /** Başarıdan sonra gidilecek adres (yoksa sayfa yenilenir). */
  redirectTo?: string | ((result: unknown) => string);
}

/** Tek tıkla API işlemi (opsiyonel onay ile), ardından sayfayı tazeler. */
export function ActionButton({ url, method = 'POST', body, children, className = '', confirm, reasonLabel, okLabel = 'Evet', success, redirectTo }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (extra: Record<string, unknown> = {}) => {
    const result = await api(method, url, method === 'DELETE' ? undefined : { ...body, ...extra });
    if (success) toast(success);
    if (redirectTo) router.push(typeof redirectTo === 'function' ? redirectTo(result) : redirectTo);
    else router.refresh();
  };

  const click = async () => {
    if (confirm) return setOpen(true);
    setBusy(true);
    try {
      await run();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={click} disabled={busy}>{children}</button>
      {open ? (
        <Modal title="Onay" onClose={() => setOpen(false)} submitLabel={okLabel} onSubmit={(d) => run(reasonLabel ? { reason: d.reason } : {})}>
          <p>{confirm}</p>
          {reasonLabel ? <Field label={reasonLabel}><input name="reason" /></Field> : null}
        </Modal>
      ) : null}
    </>
  );
}
