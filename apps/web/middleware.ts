import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * FE-H2: Nonce-based CSP middleware.
 *
 * Generates a cryptographic nonce per request and sets it in the
 * Content-Security-Policy header. Next.js reads the nonce from the
 * `x-nonce` header and injects it into <script> tags automatically
 * when using the App Router (Next.js 13.4+).
 *
 * With a nonce present, `strict-dynamic` correctly propagates trust
 * to dynamically-loaded scripts while blocking injected inline scripts
 * that don't have the nonce. The `unsafe-inline` fallback is ignored
 * by modern browsers when a nonce is present (CSP Level 3 spec).
 */
export function middleware(request: NextRequest) {
  // Generate a random nonce for this request
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  // Build the CSP header with the nonce
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-inline'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://testnet.monadexplorer.com",
    "font-src 'self' data:",
    "connect-src 'self' https://testnet-rpc.monad.xyz https://rpc.monad.xyz wss://testnet-rpc.monad.xyz wss://rpc.monad.xyz https://relay.walletconnect.com wss://relay.walletconnect.com https://verify.walletconnect.com",
    "frame-ancestors 'none'",
  ].join('; ');

  // Clone the request headers and set the nonce so Next.js can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Set the CSP header on the response (overrides static next.config.js CSP)
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  // FE-H2(R6): Apply to ALL routes including prefetch requests.
  // Prefetch responses must also have CSP headers to prevent injection
  // in prefetched RSC payloads. Only exclude static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
