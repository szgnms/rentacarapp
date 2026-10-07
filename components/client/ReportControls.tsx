'use client';

import { useRouter } from 'next/navigation';
import type { Reports } from '@/lib/domain/reports';

/** Tarih aralığı seçimi + araç raporu CSV dışa aktarımı. */
export function ReportControls({ from, to, rows }: { from: string; to: string; rows: Reports['by_vehicle'] }) {
  const router = useRouter();
  const go = (f: string, t: string) => router.push(`/reports?from=${f}&to=${t}`);
  const csv = () => {
    const head = ['Plaka', 'Marka', 'Model', 'Kategori', 'Kiralama', 'Kiralanan gün', 'Doluluk %', 'Gelir', 'Gider', 'Katkı'];
    const lines = rows.map((v) => [v.plate, v.brand, v.model, v.category, v.rentals, v.rented_days, v.utilization, v.revenue, v.cost, v.profit]);
    const text = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = `arac-raporu_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <input type="date" defaultValue={from} style={{ width: 'auto' }} onChange={(e) => e.target.value && go(e.target.value, to)} aria-label="Başlangıç" />
      <input type="date" defaultValue={to} style={{ width: 'auto' }} onChange={(e) => e.target.value && go(from, e.target.value)} aria-label="Bitiş" />
      <button onClick={csv}>CSV indir</button>
    </>
  );
}
