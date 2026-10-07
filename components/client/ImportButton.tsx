'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Field } from '../ui';

interface ImportResult {
  imported: number;
  duplicates: number;
  matched: number;
  unmatched: number;
  errors: string[];
}

/** CSV içe aktarma (dosya veya yapıştırma); sonuç özetini gösterir. */
export function ImportButton({ url, title, sample, children, className }: { url: string; title: string; sample: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const hide = useCallback(() => setOpen(false), []);
  const router = useRouter();
  const toast = useToast();
  return (
    <>
      <button type="button" className={className} onClick={() => (setOpen(true), setResult(null), setCsv(''))}>{children}</button>
      {open ? (
        <Modal
          title={title}
          wide
          submitLabel={result ? 'Kapat' : 'İçe aktar'}
          onClose={hide}
          onSubmit={async () => {
            if (result) return;
            const r = await api<ImportResult>('POST', url, { csv });
            toast(`${r.imported} kayıt aktarıldı, ${r.matched} sözleşmeyle eşleşti`);
            router.refresh();
            setResult(r);
            throw Object.assign(new Error(''), { keepOpen: true });
          }}
        >
          {result ? (
            <div>
              <div className="alert ok">
                Aktarılan: <strong>{result.imported}</strong> · Eşleşen: <strong>{result.matched}</strong> · Eşleşmeyen (istisna kuyruğu): <strong>{result.unmatched}</strong> ·
                Mükerrer: {result.duplicates}
              </div>
              {result.errors.length ? <div className="alert danger"><ul>{result.errors.slice(0, 50).map((e) => <li key={e}>{e}</li>)}</ul></div> : null}
            </div>
          ) : (
            <>
              <Field label="CSV dosyası">
                <input type="file" accept=".csv,text/csv,text/plain" data-skip onChange={async (e) => setCsv(await (e.target.files?.[0]?.text() ?? Promise.resolve('')))} />
              </Field>
              <Field label="veya içeriği yapıştırın">
                <textarea data-skip value={csv} onChange={(e) => setCsv(e.target.value)} rows={8} placeholder={sample} style={{ fontFamily: 'monospace' }} />
              </Field>
              <div className="muted small">Ayraç ; veya , olabilir. Başlık satırı zorunludur. Örnek:<pre className="mono small">{sample}</pre></div>
            </>
          )}
        </Modal>
      ) : null}
    </>
  );
}
