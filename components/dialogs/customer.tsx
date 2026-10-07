'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../client/api';
import { Modal } from '../client/Modal';
import { useToast } from '../client/Toast';
import { Field, Options } from '../ui';

/** KVKK / İYS rıza güncelleme: her değişiklik ayrı kayıt olarak (kanal, IP, personel) saklanır. */
export function ConsentButton({ customerId, types, state }: { customerId: number; types: Record<string, string>; state: Record<string, boolean> }) {
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button type="button" className="sm" onClick={() => setOpen(true)}>Rızaları güncelle</button>
      {open ? (
        <Modal
          title="Aydınlatma & açık rıza"
          onClose={hide}
          onSubmit={async (d) => {
            const consents = Object.fromEntries(Object.keys(types).filter((k) => !!d[k] !== !!state[k]).map((k) => [k, !!d[k]]));
            await api('POST', `/api/customers/${customerId}/consents`, { consents, channel: d.channel });
            toast('Rıza kayıtları güncellendi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            {Object.entries(types).map(([k, label]) => (
              <label key={k} className="check c12"><input type="checkbox" name={k} defaultChecked={!!state[k]} /> {label}</label>
            ))}
            <Field label="Kanal" className="c6">
              <select name="channel" defaultValue="Ofis"><Options list={['Ofis', 'Telefon', 'Web', 'Mobil uygulama', 'Islak imza']} /></select>
            </Field>
          </div>
          <div className="muted small">Yalnızca değişen rızalar yeni kayıt olarak eklenir; geçmiş kayıtlar silinmez.</div>
        </Modal>
      ) : null}
    </>
  );
}

/** Varlığa belge/fotoğraf yükleme (WORM dosya deposu, SHA-256). */
export function UploadButton({
  entity, entityId, kinds, children, className,
}: { entity: string; entityId: number; kinds: Record<string, string>; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const hide = useCallback(() => setOpen(false), []);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{children}</button>
      {open ? (
        <Modal
          title="Belge yükle"
          submitLabel="Yükle"
          onClose={hide}
          onSubmit={async (d, form) => {
            const file = form.querySelector<HTMLInputElement>('input[type=file]')?.files?.[0];
            if (!file) throw new Error('Dosya seçin');
            const fd = new FormData();
            fd.set('file', file);
            fd.set('entity', entity);
            fd.set('entity_id', String(entityId));
            fd.set('kind', 'document');
            fd.set('meta', JSON.stringify({ doc_type: d.doc_type, expires_at: d.expires_at || null, note: d.note || null }));
            const res = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
            const j = await res.json().catch(() => null);
            if (!res.ok) throw new Error(j?.error || 'Yükleme başarısız');
            toast('Belge yüklendi');
            router.refresh();
          }}
        >
          <div className="form-grid">
            <Field label="Belge tipi" className="c6"><select name="doc_type"><Options list={Object.entries(kinds)} /></select></Field>
            <Field label="Geçerlilik bitişi" className="c6"><input type="date" name="expires_at" /></Field>
            <Field label="Dosya" className="c12"><input type="file" data-skip accept="image/*,application/pdf" capture="environment" /></Field>
            <Field label="Not" className="c12"><input name="note" /></Field>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
