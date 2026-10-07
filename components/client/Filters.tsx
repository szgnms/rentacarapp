'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import { Options } from '../ui';

export type FilterField =
  | { name: string; type: 'search'; placeholder: string }
  | { name: string; type: 'date'; title?: string }
  | { name: string; type: 'select'; empty: string; options: readonly (string | readonly [string | number, string])[] };

/** URL arama parametreleriyle senkron filtre çubuğu. */
export function Filters({ fields, defaults = {} }: { fields: FilterField[]; defaults?: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = Object.fromEntries(fields.map((f) => [f.name, params.get(f.name) ?? defaults[f.name] ?? '']));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(values)) {
        // Varsayılanı olan alan boş bırakılırsa "tümü" anlamında boş değer gönderilir.
        if (v || defaults[k]) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }, 250);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  const set = (k: string, v: string) => setValues((x) => ({ ...x, [k]: v }));
  return (
    <div className="filters">
      {fields.map((f) =>
        f.type === 'select' ? (
          <select key={f.name} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} aria-label={f.empty}>
            <Options list={f.options} empty={f.empty} />
          </select>
        ) : (
          <input
            key={f.name}
            type={f.type}
            value={values[f.name]}
            placeholder={f.type === 'search' ? f.placeholder : undefined}
            title={f.type === 'date' ? f.title : undefined}
            onChange={(e) => set(f.name, e.target.value)}
          />
        ),
      )}
    </div>
  );
}

/** Tıklanabilir tablo satırı (içerideki bağlantı/butonlara tıklamayı yutmaz). */
export function ClickRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const onClick = (e: MouseEvent) => {
    // Portal ile açılan modallardan kabarcıklanan olayları ve iç kontrolleri yok say.
    if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest('a,button,input,select')) return;
    router.push(href);
  };
  return <tr className="click" onClick={onClick}>{children}</tr>;
}
