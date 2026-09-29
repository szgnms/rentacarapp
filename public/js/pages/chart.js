import { html, raw, esc } from '../core.js';

/**
 * Gruplu çubuk grafik (tek y ekseni). series: [{ key, label, cls }], rows: [{ label, [key]: number }]
 * Tooltip, üzerine gelinen grubun tüm değerlerini gösterir.
 */
export function barChart(el, { rows, series, format = (v) => v, height = 220 }) {
  const W = 640;
  const H = height;
  const padL = 64;
  const padB = 26;
  const padT = 8;
  const max = Math.max(1, ...rows.flatMap((r) => series.map((s) => r[s.key] || 0)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const gw = (W - padL) / rows.length;
  const bw = Math.min(28, (gw * 0.7) / series.length);
  const gap = 2;
  let svg = '';
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(short(v))}</text>`;
  }
  rows.forEach((r, i) => {
    const gx = padL + gw * i;
    const total = series.length * bw + (series.length - 1) * gap;
    series.forEach((s, j) => {
      const v = Math.max(0, r[s.key] || 0);
      const x = gx + (gw - total) / 2 + j * (bw + gap);
      const h = y(0) - y(v);
      if (h > 0) svg += `<path class="${s.cls}" d="${roundedTop(x, y(v), bw, h, Math.min(4, h, bw / 2))}"/>`;
    });
    svg += `<text class="axis" x="${gx + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${gx}" y="${padT}" width="${gw}" height="${H - padT - padB}"/>`;
  });
  el.innerHTML = html`<div class="chart-legend">${series.map((s) => html`<span><i class="${s.cls}" style="background:var(--series-${s.cls.slice(-1)})"></i>${s.label}</span>`)}</div>
    <div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.label).join(', ')}">${raw(svg)}</svg><div class="chart-tip"></div></div>`.s;
  const tip = el.querySelector('.chart-tip');
  const box = el.querySelector('.chart');
  el.querySelectorAll('.hit').forEach((rect) => {
    rect.addEventListener('mousemove', (e) => {
      const r = rows[rect.dataset.i];
      tip.innerHTML = html`<strong>${r.label}</strong>${series.map((s) => html`<div>${s.label}: <b>${format(r[s.key] || 0)}</b></div>`)}`.s;
      const b = box.getBoundingClientRect();
      tip.style.display = 'block';
      const x = e.clientX - b.left + 12;
      tip.style.left = Math.min(x, b.width - tip.offsetWidth - 4) + 'px';
      tip.style.top = e.clientY - b.top - 10 + 'px';
    });
    rect.addEventListener('mouseleave', () => (tip.style.display = 'none'));
  });
}

function roundedTop(x, y, w, h, r) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceStep(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function short(v) {
  if (v >= 1e6) return (v / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' Mn';
  if (v >= 1e3) return (v / 1e3).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) + ' B';
  return v.toLocaleString('tr-TR');
}
