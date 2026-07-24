/**
 * Garde-fou boot : AUTH_SECRET manquant en production.
 *
 * NextAuth génère un secret aléatoire par instance si `secret` est vide.
 * En multi-lambda Vercel, chaque instance aurait alors un secret différent
 * → les JWT signés par une lambda ne seraient pas vérifiables par une autre
 * → déconnexions aléatoires en production. On échoue vite et fort au boot
 * plutôt que de laisser ce bug intermittent se manifester en silence.
 */
export function assertAuthSecretConfigured(): void {
  if (!process.env.AUTH_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production");
  }
}
