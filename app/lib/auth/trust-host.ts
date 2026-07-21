/**
 * Décide si Auth.js peut déduire l’URL depuis Host / X-Forwarded-Host.
 * En production, définir AUTH_URL (ex. https://patrimo-psi.vercel.app).
 *
 * - AUTH_TRUST_HOST=true|false → override explicite
 * - AUTH_URL / NEXTAUTH_URL défini → false (URL canonique, anti host-header)
 * - Preview Vercel sans AUTH_URL → true
 * - Dev local → true
 * - Prod sans AUTH_URL → false (forcer la config)
 */
export function resolveAuthTrustHost(): boolean {
  const explicit = process.env.AUTH_TRUST_HOST?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1" || explicit === "yes") return true;
  if (explicit === "false" || explicit === "0" || explicit === "no") return false;

  const authUrl =
    process.env.AUTH_URL?.trim() || process.env.NEXTAUTH_URL?.trim();
  if (authUrl) {
    return false;
  }

  if (process.env.VERCEL === "1") return true;

  if (process.env.NODE_ENV !== "production") return true;

  return false;
}
