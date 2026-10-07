'use client';

import { useRef, useState } from 'react';
import { money, numf } from '@/lib/format';

interface Series {
  key: string;
  label: string;
  /** 1 veya 2 → --series-1 / --series-2 renk değişkeni */
  slot: 1 | 2;
}

type Row = { label: string } & Record<string, number | string>;

/** Gruplu çubuk grafik (tek y ekseni) + üzerine gelince grup tooltip'i. */
export function BarChart({ rows, series, unit = 'money', height = 220 }: { rows: Row[]; series: Series[]; unit?: 'money' | 'number'; height?: number }) {
  const format = unit === 'money' ? money : numf;
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const W = 640;
  const H = height;
  const padL = 64;
  const padB = 26;
  const padT = 8;
  const val = (r: Row, k: string) => Math.max(0, Number(r[k]) || 0);
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => val(r, s.key))));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const gw = (W - padL) / rows.length;
  const bw = Math.min(28, (gw * 0.7) / series.length);
  const gap = 2;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <div>
      <div className="chart-legend">
        {series.map((s) => (
          <span key={s.key}><i style={{ background: `var(--series-${s.slot})` }} />{s.label}</span>
        ))}
      </div>
      <div className="chart" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.label).join(', ')}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={padL} x2={W} y1={y(v)} y2={y(v)} />
              <text className="axis" x={padL - 8} y={y(v) + 4} textAnchor="end">{short(v)}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            const gx = padL + gw * i;
            const total = series.length * bw + (series.length - 1) * gap;
            return (
              <g key={i}>
                {series.map((s, j) => {
                  const v = val(r, s.key);
                  const x = gx + (gw - total) / 2 + j * (bw + gap);
                  const h = y(0) - y(v);
                  return h > 0 ? <path key={s.key} className={`bar-${s.slot}`} d={roundedTop(x, y(v), bw, h, Math.min(4, h, bw / 2))} /> : null;
                })}
                <text className="axis" x={gx + gw / 2} y={H - 8} textAnchor="middle">{r.label}</text>
                <rect
                  className="hit"
                  x={gx}
                  y={padT}
                  width={gw}
                  height={H - padT - padB}
                  onMouseMove={(e) => {
                    const b = box.current!.getBoundingClientRect();
                    setHover({ i, x: e.clientX - b.left, y: e.clientY - b.top });
                  }}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
        {hover ? (
          <div className="chart-tip" style={{ display: 'block', left: Math.min(hover.x + 12, (box.current?.clientWidth ?? 400) - 190), top: hover.y - 10 }}>
            <strong>{rows[hover.i].label}</strong>
            {series.map((s) => (
              <div key={s.key}>{s.label}: <b>{format(val(rows[hover.i], s.key))}</b></div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceStep(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function short(v: number) {
  if (v >= 1e6) return (v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' Mn';
  if (v >= 1e3) return (v / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' B';
  return v.toLocaleString('tr-TR');
}
