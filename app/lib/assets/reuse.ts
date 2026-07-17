/**
 * Règles de réutilisation d’un Asset (identité métier).
 *
 * - Multi-courtier : un même assetId peut avoir des positions sur plusieurs
 *   plateformes (ledger = assetId × platformId). Asset.platformId est seulement
 *   la plateforme « home » d’affichage — ne jamais l’écraser à la réutilisation.
 * - Multi-enveloppe : PEA / CTO / AV restent des Asset distincts (accountType).
 */

/** Filtre Prisma pour retrouver un actif réutilisable par ticker + enveloppe. */
export function assetReuseByTickerWhere(
  userId: string,
  ticker: string,
  accountType: string
) {
  return {
    userId,
    ticker: { equals: ticker.trim(), mode: "insensitive" as const },
    accountType: (accountType || "CTO").toUpperCase(),
  };
}

/**
 * true si deux enveloppes fiscales sont équivalentes pour la réutilisation.
 * (normalisation CTO / pea / …)
 */
export function sameTaxEnvelope(a: string | null | undefined, b: string | null | undefined) {
  return (a || "CTO").toUpperCase() === (b || "CTO").toUpperCase();
}
