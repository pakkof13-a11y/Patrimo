/**
 * Décide si Auth.js peut faire confiance au Host / X-Forwarded-Host de la requête.
 *
 * IMPORTANT : dans @auth/core@0.41.x (assertConfig, lib/utils/assert.js), `trustHost`
 * est un simple booléen sans mode intermédiaire — `trustHost: false` fait
 * échouer TOUTE requête avec `UntrustedHost`, quelle que soit la valeur de
 * `AUTH_URL`/`NEXTAUTH_URL` (il n'existe PAS de validation Host-vs-AUTH_URL
 * en fallback). Définir AUTH_URL seul ne "sécurise" donc rien ici — ça cassait
 * l'auth en prod (config pourtant recommandée dans .env.example) et en dev.
 * La seule vraie protection possible avec cette version est au niveau infra
 * (Vercel routage edge, ou reverse proxy de confiance en self-host).
 *
 * - AUTH_TRUST_HOST=true|false → override explicite (prioritaire)
 * - Vercel (VERCEL=1) → true (le routage edge garantit un Host fiable)
 * - Hors production (dev/test) → true
 * - Prod auto-hébergée sans VERCEL → false (à activer explicitement via
 *   AUTH_TRUST_HOST=true une fois un reverse proxy de confiance en place)
 */
export function resolveAuthTrustHost(): boolean {
  const explicit = process.env.AUTH_TRUST_HOST?.trim().toLowerCase();
  if (explicit === "true" || explicit === "1" || explicit === "yes") return true;
  if (explicit === "false" || explicit === "0" || explicit === "no") return false;

  if (process.env.VERCEL === "1") return true;

  if (process.env.NODE_ENV !== "production") return true;

  return false;
}
