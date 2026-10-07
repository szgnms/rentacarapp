import Link from 'next/link';
import type { ReactNode } from 'react';
import { LABELS, type LabelGroup, type Tone } from '@/lib/format';

export function Badge({ group, value }: { group: LabelGroup; value: string }) {
  const v = (LABELS[group] as Record<string, readonly [string, Tone]>)[value];
  return <span className={`badge ${v?.[1] ?? ''}`}>{v?.[0] ?? value}</span>;
}

export function Tag({ tone = '', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, hint, valueClass }: { label: string; value: ReactNode; hint?: ReactNode; valueClass?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${valueClass ?? ''}`}>{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`card ${className}`}>
      {title || actions ? (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

type Col = string | [string, string];

export function Table({ cols, children, empty = 'Kayıt bulunamadı', count }: { cols: Col[]; children: ReactNode; empty?: string; count: number }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {cols.map((c, i) => (Array.isArray(c) ? <th key={i} className={c[1]}>{c[0]}</th> : <th key={i}>{c}</th>))}
          </tr>
        </thead>
        <tbody>
          {count ? children : (
            <tr>
              <td colSpan={cols.length} className="empty">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function SumRow({ label, value, total, className }: { label: ReactNode; value: ReactNode; total?: boolean; className?: string }) {
  return (
    <div className={`sum-row ${total ? 'total' : ''} ${className ?? ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function Options({ list, empty }: { list: readonly (string | readonly [string | number, string])[]; empty?: string }) {
  return (
    <>
      {empty !== undefined ? <option value="">{empty}</option> : null}
      {list.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        return <option key={String(v)} value={v}>{l}</option>;
      })}
    </>
  );
}

export function Field({ label, className = '', children }: { label: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`field ${className}`}>
      {label}
      {children}
    </label>
  );
}

export const FUEL_OPTIONS: [number, string][] = Array.from({ length: 9 }, (_, i) => {
  const n = 8 - i;
  return [n, `${n}/8${n === 8 ? ' (Dolu)' : n === 0 ? ' (Boş)' : ''}`];
});

/** URL tabanlı sekmeler (?tab=...). */
export function Tabs({ items, active, base }: { items: [string, string][]; active: string; base: string }) {
  const sep = base.includes('?') ? '&' : '?';
  return (
    <div className="tabs">
      {items.map(([k, l]) => (
        <Link key={k} href={`${base}${sep}tab=${k}`} scroll={false} replace className={k === active ? 'active' : ''}>
          {l}
        </Link>
      ))}
    </div>
  );
}
