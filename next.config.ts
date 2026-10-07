import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PDF üretiminde fs ile okunan Türkçe fontlar sunucusuz paketlere de dahil edilsin.
  outputFileTracingIncludes: {
    '/**': ['./node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', './node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf'],
  },
};

export default nextConfig;
