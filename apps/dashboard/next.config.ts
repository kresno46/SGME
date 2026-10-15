import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Output standalone untuk image Docker (Linux). Di Windows tanpa hak symlink, build biasa saja.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  poweredByHeader: false,
  reactStrictMode: true,
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.tiktokcdn.com' }] },
  // Request /api/* diteruskan ke NestJS sehingga cookie sesi bersifat same-origin.
  // Di produksi Nginx meneruskan /api langsung ke API; rewrite ini menjadi cadangan.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
