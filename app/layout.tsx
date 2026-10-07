import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/client/Toast';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Rent A Car Yönetimi', template: '%s · Rent A Car' },
  description: 'Uçtan uca araç kiralama yönetim uygulaması',
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🚗</text></svg>" },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
