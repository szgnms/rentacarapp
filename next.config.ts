import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite WASM/veri dosyalarını çalışma anında kendi klasöründen yükler; paketlenmemeli.
  serverExternalPackages: ['@electric-sql/pglite'],
  // PDF üretiminde fs ile okunan Türkçe fontlar sunucusuz paketlere de dahil edilsin.
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
      './node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf',
      './node_modules/@electric-sql/pglite/dist/*.{wasm,data}',
    ],
  },
};

export default nextConfig;
