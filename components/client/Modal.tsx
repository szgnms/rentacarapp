'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, formToObject } from './api';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as (string | { message: string })[]) : [];
  const list = details.length > 1 || (details[0] && typeof details[0] === 'object') ? details : [];
  return (
    <div className="alert danger">
      {message}
      {list.length ? (
        <ul>
          {list.map((x, i) => (
            <li key={i}>{typeof x === 'string' ? x : x.message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Verilirse gövde bir <form> olur ve gönderimde çağrılır; hata fırlatırsa modal açık kalır. */
  onSubmit?: (data: Record<string, string | boolean>, form: HTMLFormElement) => Promise<unknown> | unknown;
  submitLabel?: string;
  submitClass?: string;
  cancelLabel?: string;
}

export function Modal({ title, onClose, children, wide, onSubmit, submitLabel = 'Kaydet', submitClass = 'primary', cancelLabel = 'Vazgeç' }: ModalProps) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input:not([type=hidden]),select,textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Portal içindeki form olayı React ağacında dış formlara kabarcıklanmasın.
    e.stopPropagation();
    if (!onSubmit) return onClose();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(formToObject(e.currentTarget), e.currentTarget);
      onClose();
    } catch (err) {
      setError(err);
      ref.current?.parentElement?.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  // Portal: tablo satırı gibi kapsayıcıların içinden açılsa da geçerli DOM üretir.
  return createPortal(
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form ref={ref} className={`modal ${wide ? 'wide' : ''}`} onSubmit={submit} noValidate>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Kapat">×</button>
        </div>
        <div className="modal-body">
          <ErrorBox error={error} />
          {children}
        </div>
        <div className="modal-foot">
          <button type="button" onClick={onClose}>{onSubmit ? cancelLabel : 'Kapat'}</button>
          {onSubmit ? (
            <button type="submit" className={submitClass} disabled={busy}>{busy ? 'Kaydediliyor…' : submitLabel}</button>
          ) : null}
        </div>
      </form>
    </div>,
    document.body,
  );
}
