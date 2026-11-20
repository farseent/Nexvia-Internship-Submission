import type { NextConfig } from 'next';

// Same-origin proxy to the API (D6): the browser only talks to the web origin, so the
// session cookie is first-party and CORS is not involved. Rewrites are resolved when the
// app is built (`next build`), so API_INTERNAL_URL must be set at build time as well.
const apiInternalUrl = process.env['API_INTERNAL_URL'] ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server output, enabled only for the production Docker image
  // (infra/Dockerfile.web sets NEXT_OUTPUT=standalone). `next start` does not support it.
  ...(process.env['NEXT_OUTPUT'] === 'standalone' ? { output: 'standalone' as const } : {}),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
};

export default nextConfig;
