'use client';

import { useRouter } from 'next/navigation';

/** Seçim değişince ilgili adrese giden select. options: [href, label, value] */
export function NavSelect({ value, options }: { value: string; options: readonly (readonly [string, string, string])[] }) {
  const router = useRouter();
  return (
    <select style={{ width: 'auto' }} value={value} onChange={(e) => router.push(options.find((o) => o[2] === e.target.value)![0])}>
      {options.map(([, label, v]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
