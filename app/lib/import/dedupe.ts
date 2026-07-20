/**
 * Empreintes d’import + classification strict / suspect pour arbitrage UI.
 */

export type ImportFingerprintInput = {
  platformId: string;
  type: string;
  occurredAt: string | null | undefined;
  ticker: string | null | undefined;
  quantity: string | number | null | undefined;
  unitPrice: string | number | null | undefined;
  cashAmount: string | number | null | undefined;
  fees: string | number | null | undefined;
  currency: string | null | undefined;
};

/** Tolérance « suspect » : ±5 minutes autour de l’horodatage. */
export const SUSPECT_TIME_TOLERANCE_MS = 5 * 60 * 1000;

export function normalizeImportNumber(
  v: string | number | null | undefined
): string {
  if (v == null || v === "") return "";
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return s.toLowerCase();
  const fixed = n.toFixed(8).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

/** Instant à la seconde près (strict). */
export function normalizeImportInstantSecond(
  iso: string | Date | null | undefined
): string {
  if (iso == null || iso === "") return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 19);
  return d.toISOString().slice(0, 19);
}

/** Instant à la minute (legacy / coarse). */
export function normalizeImportInstant(
  iso: string | Date | null | undefined
): string {
  if (iso == null || iso === "") return "";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  return d.toISOString().slice(0, 16);
}

function economicKey(input: ImportFingerprintInput): string {
  const type = String(input.type || "").toUpperCase();
  const qty = normalizeImportNumber(input.quantity);
  const price = normalizeImportNumber(input.unitPrice);
  const isTrade = Boolean(qty || price);
  const cash = isTrade ? "" : normalizeImportNumber(input.cashAmount);
  return [
    input.platformId,
    type,
    String(input.ticker || "")
      .trim()
      .toUpperCase(),
    qty,
    price,
    cash,
    normalizeImportNumber(input.fees ?? "0") || "0",
    String(input.currency || "EUR")
      .trim()
      .toUpperCase()
      .slice(0, 3) || "EUR",
  ].join("\u001f");
}

/** Empreinte stricte : économie + horodatage à la seconde. */
export function buildStrictFingerprint(input: ImportFingerprintInput): string {
  return `${economicKey(input)}\u001f${normalizeImportInstantSecond(input.occurredAt)}`;
}

/** Empreinte économique seule (sans date) — pour rapprocher les suspects. */
export function buildEconomicFingerprint(input: ImportFingerprintInput): string {
  return economicKey(input);
}

/** @deprecated alias — minute precision (compat tests / ancien code) */
export function buildImportFingerprint(input: ImportFingerprintInput): string {
  return `${economicKey(input)}\u001f${normalizeImportInstant(input.occurredAt)}`;
}

export type ExistingTxLite = {
  id: string;
  type: string;
  occurredAt: Date | string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  currency: string;
  netCashImpactEur?: string | null;
  ticker: string | null;
  notes?: string | null;
};

export type DuplicateKind = "strict" | "suspect";

export type DuplicateMatch = {
  kind: DuplicateKind;
  existing: ExistingTxLite;
  deltaMs: number;
};

function sameNormNumber(
  a: string | number | null | undefined,
  b: string | number | null | undefined
): boolean {
  return normalizeImportNumber(a) === normalizeImportNumber(b);
}

function tickerCompatible(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const ta = String(a || "")
    .trim()
    .toUpperCase();
  const tb = String(b || "")
    .trim()
    .toUpperCase();
  // null / vide d’un côté : souvent APPORT/REWARD importés sans asset lié
  if (!ta || !tb) return true;
  return ta === tb;
}

/**
 * Classe une ligne entrante vs un index d’existants (même plateforme).
 * - strict : même empreinte à la seconde
 * - suspect : même économie, |Δt| ≤ tolérance et pas strict
 * - secours : ticker manquant en base (ou type APPORT↔REWARD) + même qty/prix/temps
 */
export function classifyAgainstExisting(
  input: ImportFingerprintInput,
  byStrict: Map<string, ExistingTxLite>,
  byEconomic: Map<string, ExistingTxLite[]>,
  toleranceMs: number = SUSPECT_TIME_TOLERANCE_MS
): DuplicateMatch | null {
  const strictFp = buildStrictFingerprint(input);
  const strictHit = byStrict.get(strictFp);
  if (strictHit) {
    return {
      kind: "strict",
      existing: strictHit,
      deltaMs: 0,
    };
  }

  const eco = buildEconomicFingerprint(input);
  let candidates = byEconomic.get(eco) || [];

  // Empreinte « sans ticker » : rattrape les txs stockées sans asset
  // (ex. ancienne Réception crypto → APPORT assetId null).
  if (candidates.length === 0 && input.ticker) {
    const noTickerEco = buildEconomicFingerprint({ ...input, ticker: null });
    candidates = byEconomic.get(noTickerEco) || [];
  }
  // Draft sans ticker vs existants avec ticker
  if (candidates.length === 0 && !input.ticker) {
    for (const list of byEconomic.values()) {
      for (const ex of list) {
        if (
          ex.type === String(input.type || "").toUpperCase() &&
          sameNormNumber(ex.quantity, input.quantity) &&
          sameNormNumber(ex.unitPrice, input.unitPrice) &&
          sameNormNumber(ex.fees, input.fees ?? "0")
        ) {
          candidates = candidates.concat(ex);
        }
      }
    }
  }

  const tIn = input.occurredAt ? new Date(input.occurredAt).getTime() : NaN;
  if (!Number.isFinite(tIn)) return null;

  let best: ExistingTxLite | null = null;
  let bestDelta = Infinity;
  for (const ex of candidates) {
    if (!tickerCompatible(input.ticker, ex.ticker)) continue;
    const tEx = new Date(ex.occurredAt).getTime();
    if (!Number.isFinite(tEx)) continue;
    const delta = Math.abs(tIn - tEx);
    if (delta <= toleranceMs && delta < bestDelta) {
      bestDelta = delta;
      best = ex;
    }
  }

  // Secours : APPORT stocké vs REWARD draft (réception crypto reclassée)
  if (!best) {
    const typeIn = String(input.type || "").toUpperCase();
    const altTypes =
      typeIn === "REWARD"
        ? ["APPORT"]
        : typeIn === "APPORT"
          ? ["REWARD"]
          : [];
    if (altTypes.length) {
      for (const list of byEconomic.values()) {
        for (const ex of list) {
          if (!altTypes.includes(ex.type)) continue;
          if (!tickerCompatible(input.ticker, ex.ticker)) continue;
          if (!sameNormNumber(ex.quantity, input.quantity)) continue;
          if (!sameNormNumber(ex.unitPrice, input.unitPrice)) continue;
          if (!sameNormNumber(ex.fees, input.fees ?? "0")) continue;
          const tEx = new Date(ex.occurredAt).getTime();
          if (!Number.isFinite(tEx)) continue;
          const delta = Math.abs(tIn - tEx);
          if (delta <= toleranceMs && delta < bestDelta) {
            bestDelta = delta;
            best = ex;
          }
        }
      }
    }
  }

  if (!best) return null;
  // delta 0 second already caught by strict; remaining are suspects
  if (bestDelta < 1000) {
    return { kind: "strict", existing: best, deltaMs: bestDelta };
  }
  return { kind: "suspect", existing: best, deltaMs: bestDelta };
}

export function indexExistingTransactions(
  platformId: string,
  rows: ExistingTxLite[]
): {
  byStrict: Map<string, ExistingTxLite>;
  byEconomic: Map<string, ExistingTxLite[]>;
} {
  const byStrict = new Map<string, ExistingTxLite>();
  const byEconomic = new Map<string, ExistingTxLite[]>();

  for (const tx of rows) {
    const qty = tx.quantity;
    const price = tx.unitPrice;
    const isTrade = Boolean(qty || price);
    const input: ImportFingerprintInput = {
      platformId,
      type: tx.type,
      occurredAt:
        tx.occurredAt instanceof Date
          ? tx.occurredAt.toISOString()
          : String(tx.occurredAt),
      ticker: tx.ticker,
      quantity: qty,
      unitPrice: price,
      cashAmount: isTrade ? null : tx.netCashImpactEur
        ? String(Math.abs(Number(tx.netCashImpactEur)))
        : null,
      fees: tx.fees,
      currency: tx.currency,
    };
    const s = buildStrictFingerprint(input);
    byStrict.set(s, tx);
    const e = buildEconomicFingerprint(input);
    const list = byEconomic.get(e) || [];
    list.push(tx);
    byEconomic.set(e, list);
  }
  return { byStrict, byEconomic };
}
