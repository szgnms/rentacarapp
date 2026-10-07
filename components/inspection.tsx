'use client';

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ApiError, api } from './client/api';
import { ErrorBox, Modal } from './client/Modal';
import { useToast } from './client/Toast';
import { Field, Options } from './ui';
import { DAMAGE_TYPES, PHOTO_ANGLES } from '@/lib/inspection';
import { labelOptions } from '@/lib/format';

export interface PhotoRef {
  angle: string;
  file_id: number;
  sha256?: string;
  created_at?: string;
}

export interface MarkRef {
  id: number;
  x: number;
  y: number;
  type: string;
  severity: string;
  note: string | null;
  photo_file_id: number | null;
}

// ---------- Görüntü işleme ----------

/** Fotoğrafı cihazda küçültür (en fazla 1600 px, JPEG %82) — tablet ağında hızlı yükleme için. */
export async function compressImage(file: File, max = 1600): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, w, h);
  // Zaman damgası filigranı (delil değeri için görüntüye de işlenir)
  const stamp = new Date().toLocaleString('tr-TR');
  ctx.font = `${Math.max(14, Math.round(w / 50))}px sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  const tw = ctx.measureText(stamp).width;
  ctx.fillRect(w - tw - 16, h - Math.max(14, Math.round(w / 50)) - 14, tw + 12, Math.max(14, Math.round(w / 50)) + 10);
  ctx.fillStyle = '#fff';
  ctx.fillText(stamp, w - tw - 10, h - 10);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Görüntü işlenemedi'))), 'image/jpeg', 0.82));
  return { blob, width: w, height: h };
}

let geoCache: { lat: number; lng: number; accuracy: number } | null | undefined;
export function getGeo(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (geoCache !== undefined) return Promise.resolve(geoCache);
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve((geoCache = null));
    // İzin istemi yanıtlanmazsa getCurrentPosition hiç dönmeyebilir; yüklemeyi bekletme.
    const timer = setTimeout(() => resolve(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (p) => (clearTimeout(timer), resolve((geoCache = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }))),
      () => (clearTimeout(timer), resolve((geoCache = null))),
      { timeout: 4000, maximumAge: 300000 },
    );
  });
}

export async function uploadInspectionPhoto(sessionId: number, angle: string, file: File) {
  const { blob, width, height } = await compressImage(file);
  const geo = await getGeo();
  const fd = new FormData();
  fd.append('angle', angle);
  fd.append('file', new File([blob], `${angle}.jpg`, { type: 'image/jpeg' }));
  fd.append('meta', JSON.stringify({ captured_at: new Date().toISOString(), gps: geo, width, height, original_name: file.name, original_size: file.size, last_modified: file.lastModified }));
  const res = await fetch(`/api/inspections/${sessionId}/photos`, { method: 'POST', body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error || 'Fotoğraf yüklenemedi', res.status, data?.details);
  return data;
}

// ---------- Fotoğraf ızgarası ----------

export function PhotoGrid({
  sessionId, photos, compare, onChange, readOnly,
}: { sessionId: number; photos: PhotoRef[]; compare?: PhotoRef[]; onChange: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ a?: number; b?: number; label: string } | null>(null);
  const byAngle = new Map(photos.map((p) => [p.angle, p]));
  const cmp = new Map((compare ?? []).map((p) => [p.angle, p]));

  const upload = async (angle: string, file: File | undefined) => {
    if (!file) return;
    setBusy(angle);
    try {
      await uploadInspectionPhoto(sessionId, angle, file);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="photo-grid">
        {PHOTO_ANGLES.map((a) => {
          const p = byAngle.get(a.key);
          const c = cmp.get(a.key);
          return (
            <div key={a.key} className={`photo-tile ${p ? 'done' : a.required ? 'required' : ''}`}>
              <div className="photo-head">
                <span>{a.label}</span>
                {a.required ? <span className={`badge ${p ? 'ok' : 'warn'}`}>{p ? '✓' : 'Zorunlu'}</span> : <span className="badge">Opsiyonel</span>}
              </div>
              <div className={`photo-body ${compare ? 'two' : ''}`}>
                {compare ? (
                  <button type="button" className="thumb" disabled={!c} onClick={() => c && setZoom({ a: c.file_id, b: p?.file_id, label: a.label })}>
                    {c ? <img src={`/api/files/${c.file_id}`} alt={`Çıkış: ${a.label}`} loading="lazy" /> : <span className="muted small">Çıkışta yok</span>}
                    <span className="thumb-cap">Çıkış</span>
                  </button>
                ) : null}
                <button type="button" className="thumb" disabled={!p} onClick={() => p && setZoom({ a: compare ? c?.file_id : p.file_id, b: compare ? p.file_id : undefined, label: a.label })}>
                  {p ? <img src={`/api/files/${p.file_id}`} alt={a.label} loading="lazy" /> : <span className="muted small">Fotoğraf yok</span>}
                  {compare ? <span className="thumb-cap">Dönüş</span> : null}
                </button>
              </div>
              {!readOnly ? (
                <label className={`btn sm ${p ? '' : 'primary'} photo-btn`}>
                  {busy === a.key ? 'Yükleniyor…' : p ? '↻ Yeniden çek' : '📷 Çek / yükle'}
                  <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(e) => upload(a.key, e.target.files?.[0])} />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      {zoom ? (
        <Modal title={zoom.label} wide onClose={() => setZoom(null)}>
          <div className={`zoom ${zoom.a && zoom.b ? 'two' : ''}`}>
            {zoom.a ? <figure><img src={`/api/files/${zoom.a}`} alt="" /><figcaption>{zoom.b ? 'Çıkış (teslim)' : ''}</figcaption></figure> : null}
            {zoom.b ? <figure><img src={`/api/files/${zoom.b}`} alt="" /><figcaption>Dönüş (iade)</figcaption></figure> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------- Hasar şeması ----------

/** Üstten araç görünümü (yüzde koordinatlarla işaretlenir). */
function CarOutline() {
  return (
    <g fill="none" stroke="var(--text-2)" strokeWidth="0.6">
      <rect x="30" y="8" width="40" height="84" rx="12" fill="var(--surface-2)" />
      <path d="M34 22 Q50 14 66 22 L64 32 Q50 28 36 32 Z" fill="var(--primary-soft)" />
      <path d="M36 70 Q50 74 64 70 L66 80 Q50 86 34 80 Z" fill="var(--primary-soft)" />
      <rect x="37" y="36" width="26" height="30" rx="3" />
      <rect x="25" y="18" width="6" height="12" rx="2" fill="var(--text-2)" />
      <rect x="69" y="18" width="6" height="12" rx="2" fill="var(--text-2)" />
      <rect x="25" y="68" width="6" height="12" rx="2" fill="var(--text-2)" />
      <rect x="69" y="68" width="6" height="12" rx="2" fill="var(--text-2)" />
      <line x1="30" y1="50" x2="70" y2="50" strokeDasharray="1 1" />
      <text x="50" y="5" fontSize="3.5" textAnchor="middle" fill="var(--muted)" stroke="none">ÖN</text>
      <text x="50" y="98" fontSize="3.5" textAnchor="middle" fill="var(--muted)" stroke="none">ARKA</text>
      <text x="20" y="50" fontSize="3.5" textAnchor="middle" fill="var(--muted)" stroke="none" transform="rotate(-90 20 50)">SOL</text>
      <text x="80" y="50" fontSize="3.5" textAnchor="middle" fill="var(--muted)" stroke="none" transform="rotate(90 80 50)">SAĞ</text>
    </g>
  );
}

const SEV_COLOR: Record<string, string> = { minor: '#f59e0b', moderate: '#ea580c', major: '#dc2626' };

export function DamageDiagram({
  sessionId, marks, ghostMarks = [], onChange, readOnly,
}: { sessionId: number; marks: MarkRef[]; ghostMarks?: { x: number; y: number; label: string }[]; onChange: () => void; readOnly?: boolean }) {
  const toast = useToast();
  const svg = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);

  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (readOnly) return;
    const r = svg.current!.getBoundingClientRect();
    setPending({ x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 });
    setPhoto(null);
  };

  const save = async (d: Record<string, string | boolean>) => {
    let photo_file_id: number | undefined;
    if (photo) {
      const res = await uploadInspectionPhoto(sessionId, `damage-${Date.now()}`, photo);
      photo_file_id = res.file.id;
    }
    await api('POST', `/api/inspections/${sessionId}/marks`, { ...d, ...pending, photo_file_id });
    onChange();
  };

  const voidMark = async (id: number) => {
    try {
      await api('DELETE', `/api/damage-marks/${id}`);
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="damage-wrap">
      <svg ref={svg} viewBox="0 0 100 100" className={`damage-svg ${readOnly ? '' : 'editable'}`} onClick={click} role="img" aria-label="Hasar şeması">
        <CarOutline />
        {ghostMarks.map((m, i) => (
          <g key={`g${i}`}>
            <circle cx={m.x} cy={m.y} r="2.4" fill="#9ca3af" stroke="#fff" strokeWidth="0.5" />
            <title>{m.label}</title>
          </g>
        ))}
        {marks.map((m, i) => (
          <g key={m.id}>
            <circle cx={m.x} cy={m.y} r="2.8" fill={SEV_COLOR[m.severity] ?? '#dc2626'} stroke="#fff" strokeWidth="0.6" />
            <text x={m.x} y={m.y + 1.1} fontSize="3" textAnchor="middle" fill="#fff">{i + 1}</text>
          </g>
        ))}
      </svg>
      <div className="damage-list">
        {!readOnly ? <div className="muted small mb">Araç üzerinde hasarlı noktaya dokunun. Gri noktalar önceki kayıtlardır.</div> : null}
        {marks.length ? (
          marks.map((m, i) => (
            <div key={m.id} className="damage-item">
              <span className="dot" style={{ background: SEV_COLOR[m.severity] }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <strong>{DAMAGE_TYPES[m.type as keyof typeof DAMAGE_TYPES] ?? m.type}</strong>
                <div className="muted small">{m.note || '—'}</div>
              </div>
              {m.photo_file_id ? <a href={`/api/files/${m.photo_file_id}`} target="_blank" rel="noreferrer">📷</a> : null}
              {!readOnly ? <button type="button" className="sm" onClick={() => voidMark(m.id)} aria-label="İşareti iptal et">×</button> : null}
            </div>
          ))
        ) : (
          <div className="muted">Bu muayenede işaretlenmiş hasar yok.</div>
        )}
        {ghostMarks.length ? <div className="muted small" style={{ marginTop: 8 }}>{ghostMarks.length} önceki hasar kaydı (gri)</div> : null}
      </div>
      {pending ? (
        <Modal title="Hasar işaretle" onClose={() => setPending(null)} onSubmit={save} submitLabel="İşaretle">
          <div className="form-grid">
            <Field label="Hasar tipi"><select name="type" defaultValue="scratch"><Options list={Object.entries(DAMAGE_TYPES)} /></select></Field>
            <Field label="Şiddet"><select name="severity" defaultValue="minor"><Options list={labelOptions('severity')} /></select></Field>
            <Field label="Not / konum" className="c12"><input name="note" placeholder="Örn: sağ ön kapı alt kısım 10 cm çizik" /></Field>
            <label className="field c12">
              Yakın çekim fotoğraf (opsiyonel)
              <input type="file" accept="image/*" capture="environment" data-skip onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------- İmza pedi ----------

export function SignaturePad({
  title, signerName, onSave, disabled, signed,
}: { title: string; signerName?: string; onSave: (dataUrl: string, name: string, strokes: number, durationMs: number) => Promise<void>; disabled?: string | null; signed?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const stats = useRef({ strokes: 0, start: 0 });
  const [empty, setEmpty] = useState(true);
  const [name, setName] = useState(signerName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
  }, []);

  const pos = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    if (!stats.current.start) stats.current.start = Date.now();
    stats.current.strokes++;
  };
  const move = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineWidth = 1.4 + (e.pressure || 0.5) * 1.8;
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    setEmpty(false);
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    stats.current = { strokes: 0, start: 0 };
    setEmpty(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(canvas.current!.toDataURL('image/png'), name, stats.current.strokes, Date.now() - stats.current.start);
      clear();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`sigpad ${signed ? 'signed' : ''}`}>
      <div className="sig-head">
        <strong>{title}</strong>
        {signed ? <span className="badge ok">✓ İmzalandı</span> : <span className="badge warn">İmza bekleniyor</span>}
      </div>
      <ErrorBox error={error} />
      {disabled ? <div className="alert warn">{disabled}</div> : null}
      <Field label="İmzalayan ad soyad"><input value={name} onChange={(e) => setName(e.target.value)} disabled={!!disabled} /></Field>
      <canvas
        ref={canvas}
        className="sig-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label={`${title} imza alanı`}
      />
      <div className="actions" style={{ marginTop: 8 }}>
        <button type="button" onClick={clear} disabled={empty}>Temizle</button>
        <button type="button" className="primary" onClick={save} disabled={empty || busy || !!disabled || !name.trim()}>
          {busy ? 'Kaydediliyor…' : signed ? 'Yeniden imzala' : 'İmzayı kaydet'}
        </button>
      </div>
    </div>
  );
}

// ---------- Yakıt göstergesi ----------

export function FuelInput({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className="fuel">
      <input type="range" min={0} max={8} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-label="Yakıt seviyesi" />
      <div className="fuel-bar">
        {Array.from({ length: 8 }, (_, i) => <i key={i} className={i < value ? 'on' : ''} />)}
      </div>
      <strong>{value}/8</strong>
    </div>
  );
}
