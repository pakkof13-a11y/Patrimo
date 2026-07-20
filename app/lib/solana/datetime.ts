/**
 * Dates on-chain Solana → ISO pour le journal Patrimo.
 *
 * Important : `toISOString().slice(0, 16)` sans `Z` est interprété par
 * `new Date(...)` en **heure locale** → décalage (souvent −1h / jour faux).
 * On force toujours un instant UTC explicite.
 */

/** Instant UTC ISO complet (recommandé pour createTransaction). */
export function toOccurredAtIso(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * blockTime RPC = secondes unix ; signature info aussi.
 * Retourne Date UTC ou null.
 */
export function blockTimeToDate(
  blockTimeSec: number | null | undefined
): Date | null {
  if (blockTimeSec == null) return null;
  const n = Number(blockTimeSec);
  if (!Number.isFinite(n) || n <= 0) return null;
  // secondes (typique Solana) vs ms accidentel
  const ms = n > 1e12 ? n : n * 1000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Choisit la meilleure date d’opération pour une tx on-chain.
 */
export function resolveOnchainOccurredAt(opts: {
  parsedBlockTime?: Date | null;
  signatureBlockTimeSec?: number | null;
  fallback?: Date | null;
}): Date {
  if (opts.parsedBlockTime && !Number.isNaN(opts.parsedBlockTime.getTime())) {
    return opts.parsedBlockTime;
  }
  const fromSig = blockTimeToDate(opts.signatureBlockTimeSec);
  if (fromSig) return fromSig;
  if (opts.fallback && !Number.isNaN(opts.fallback.getTime())) {
    return opts.fallback;
  }
  return new Date();
}
