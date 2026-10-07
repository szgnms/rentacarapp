import type { MetadataRoute } from 'next';

/** Tablet/telefonda ana ekrana eklenebilir (PWA) saha uygulaması. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Rent A Car Yönetimi',
    short_name: 'RentACar',
    description: 'Teslim/iade, rezervasyon ve filo yönetimi',
    start_url: '/field',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f6f7f9',
    theme_color: '#2563eb',
    lang: 'tr',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
