const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@chessbots/common'],
  // FE-H1: Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // FE-H2: CSP is now set by middleware.ts with per-request nonces.
          // This enables strict-dynamic to work correctly with nonce-based trust propagation.
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    // Force connectkit to resolve its ESM entry
    config.resolve.alias = {
      ...config.resolve.alias,
      connectkit: path.resolve(__dirname, 'node_modules/connectkit/build/index.es.js'),
    };
    return config;
  },
};

module.exports = nextConfig;
