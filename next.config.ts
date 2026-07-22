import type { NextConfig } from "next";

/**
 * Security headers — defense-in-depth (XSS, clickjacking, MIME sniffing).
 * CSP volontairement stricte mais compatible Next.js App Router + next-themes
 * + images logos externes (logo.dev, CoinGecko, etc.).
 *
 * Note : 'unsafe-inline' / 'unsafe-eval' sur script restent nécessaires pour
 * Next runtime / hydratation tant qu'on n'a pas de nonces middleware.
 * frame-ancestors 'none' renforce X-Frame-Options.
 * TODO(SEC-01): remplacer unsafe-eval / unsafe-inline par des nonces middleware
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy,
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // fix(OPT-04): set to 'off' — 'on' caused DNS prefetch leaks via external logo URLs
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // fix(OPT-05): *.trycloudflare.com wildcard scoped to development only
  ...(isDev ? { allowedDevOrigins: ["127.0.0.1", "localhost", "*.trycloudflare.com"] } : {}),
  /**
   * Masque le badge Next.js DevTools (« N ») en bas à gauche —
   * il recouvrait le FAB Préférences / avatar.
   */
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
