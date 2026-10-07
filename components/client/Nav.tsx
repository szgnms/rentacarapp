'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { TEXT } from '@/lib/format';
import type { SessionUser } from '@/lib/types';

const NAV: ([string] | [string, string, string])[] = [
  ['Operasyon'],
  ['/dashboard', '📊', 'Gösterge Paneli'],
  ['/booking', '➕', 'Yeni Kiralama / Rez.'],
  ['/reservations', '📅', 'Rezervasyonlar'],
  ['/rentals', '🔑', 'Kiralamalar'],
  ['/calendar', '🗓️', 'Filo Takvimi'],
  ['Kayıtlar'],
  ['/vehicles', '🚗', 'Araçlar'],
  ['/customers', '👤', 'Müşteriler'],
  ['/maintenance', '🔧', 'Bakım & Hasar'],
  ['Finans'],
  ['/payments', '💳', 'Ödemeler'],
  ['/expenses', '🧾', 'Masraflar'],
  ['/reports', '📈', 'Raporlar'],
  ['Sistem'],
  ['/settings', '⚙️', 'Ayarlar'],
];

export function Shell({ user, company, children }: { user: SessionUser; company: string; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => {});
    router.push('/login');
    router.refresh();
  };

  return (
    <>
      <div className="topbar no-print">
        <button onClick={() => setOpen((o) => !o)} aria-label="Menü">☰</button>
        <strong>{company}</strong>
      </div>
      <div className="layout">
        <aside className={`sidebar ${open ? 'open' : ''}`}>
          <div className="brand">
            <span className="logo">🚗</span>
            <span>{company}</span>
          </div>
          <nav className="nav">
            {NAV.map((n) =>
              n.length === 1 ? (
                <div key={n[0]} className="group">{n[0]}</div>
              ) : (
                <Link key={n[0]} href={n[0]} className={pathname === n[0] || pathname.startsWith(n[0] + '/') ? 'active' : ''}>
                  <span className="ico">{n[1]}</span>
                  {n[2]}
                </Link>
              ),
            )}
          </nav>
          <div className="user">
            <div><strong>{user.full_name}</strong></div>
            <div className="muted small">{TEXT.role[user.role]} · {user.username}</div>
            <button className="sm" onClick={logout}>Çıkış yap</button>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
