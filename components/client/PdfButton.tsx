'use client';

import { useState, type ReactNode } from 'react';
import { api } from './api';
import { useToast } from './Toast';

/** Sunucuda PDF üretir (POST) ve dönen dosyayı yeni sekmede açar. */
export function PdfButton({ url, body, children, className }: { url: string; body?: Record<string, unknown>; children: ReactNode; className?: string }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        // Açılır pencere engelleyicisine takılmamak için sekmeyi tıklama anında aç.
        const win = window.open('about:blank', '_blank');
        setBusy(true);
        try {
          const f = await api<{ id: number }>('POST', url, body ?? {});
          if (win) win.location.href = `/api/files/${f.id}`;
          else window.location.href = `/api/files/${f.id}`;
        } catch (e) {
          win?.close();
          toast((e as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}
