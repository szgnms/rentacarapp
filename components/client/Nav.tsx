'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import { ROLE_LABELS, type Permission } from '@/lib/permissions';
import type { SessionUser } from '@/lib/types';

type Item = [href: string, icon: string, label: string, perm?: Permission, badge?: string];
type Group = [title: string, items: Item[]];

const NAV: Group[] = [
  ['Operasyon', [
    ['/dashboard', '📊', 'Gösterge Paneli'],
    ['/field', '📱', 'Günün İşleri (Saha)', 'rentals.operate'],
    ['/booking', '➕', 'Yeni Rezervasyon', 'reservations.write'],
    ['/reservations', '📅', 'Rezervasyonlar'],
    ['/rentals', '🔑', 'Sözleşmeler'],
    ['/calendar', '🗓️', 'Müsaitlik Takvimi'],
    ['/tasks', '🧰', 'İş Emirleri', undefined, 'tasks'],
  ]],
  ['Filo & Müşteri', [
    ['/vehicles', '🚗', 'Araçlar'],
    ['/transfers', '🔁', 'Şube Transferleri', 'fleet.write'],
    ['/maintenance', '🔧', 'Bakım & Hasar'],
    ['/customers', '👤', 'Müşteriler'],
  ]],
  ['Finans & Yasal', [
    ['/payments', '💳', 'Tahsilatlar'],
    ['/invoices', '🧾', 'Faturalar (e-Arşiv)', 'finance.manage'],
    ['/finance', '📒', 'Cari & Yaşlandırma', 'finance.manage'],
    ['/expenses', '💸', 'Masraflar', 'expenses.write'],
    ['/tolls', '🛣️', 'HGS / OGS', 'tolls.manage', 'tolls'],
    ['/fines', '🚨', 'Trafik Cezaları', 'fines.manage'],
    ['/kabis', '🛡️', 'KABİS Bildirimleri', 'kabis.manage', 'kabis'],
  ]],
  ['Yönetim', [
    ['/reports', '📈', 'Raporlar & BI', 'reports.view'],
    ['/pricing', '🏷️', 'Fiyatlandırma', 'pricing.manage'],
    ['/approvals', '✅', 'Onaylar', undefined, 'approvals'],
    ['/notifications', '✉️', 'Bildirimler', 'notifications.manage'],
    ['/settings', '⚙️', 'Ayarlar'],
    ['/audit', '🧾', 'Denetim İzi', 'audit.view'],
  ]],
];

export function Shell({
  user, company, permissions, badges, children,
}: { user: SessionUser; company: string; permissions: Permission[]; badges: Record<string, number>; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  const can = (p?: Permission) => !p || permissions.includes(p);

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
        <aside className={`sidebar no-print ${open ? 'open' : ''}`}>
          <div className="brand">
            <span className="logo">🚗</span>
            <span>{company}</span>
          </div>
          <nav className="nav">
            {NAV.map(([title, items]) => {
              const visible = items.filter((i) => can(i[3]));
              if (!visible.length) return null;
              return (
                <div key={title}>
                  <div className="group">{title}</div>
                  {visible.map(([href, icon, label, , badge]) => (
                    <Link key={href} href={href} className={pathname === href || pathname.startsWith(href + '/') ? 'active' : ''}>
                      <span className="ico">{icon}</span>
                      <span style={{ flex: 1 }}>{label}</span>
                      {badge && badges[badge] ? <span className="nav-badge">{badges[badge]}</span> : null}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
          <div className="user">
            <div><strong>{user.full_name}</strong></div>
            <div className="muted small">{ROLE_LABELS[user.role]} · {user.username}</div>
            <button className="sm" onClick={logout}>Çıkış yap</button>
          </div>
        </aside>
        <main className="main">{children}</main>
      </div>
    </>
  );
}
