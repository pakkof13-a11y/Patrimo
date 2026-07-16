/**
 * Vue fiscale simplifiée (année civile) — estimations, pas un avis d'imposition.
 *
 * Agrège pour une année Y (Europe/Paris) :
 * - Plus-values réalisées (ventes) par enveloppe
 * - Dividendes / revenus nets par enveloppe
 * - WHT (prélèvement à la source)
 *
 * PEA / AV : le réalisé est listé mais le PFU n'est pas appliqué automatiquement
 * (régimes spéciaux — disclaimer UI).
 */

export type FiscalEnvelope = string; // CTO | PEA | AV | …

export type FiscalEnvelopeBucket = {
  accountType: FiscalEnvelope;
  label: string;
  realizedPnlEur: number;
  dividendsNetEur: number;
  dividendsGrossEur: number;
  withholdingTaxEur: number;
  sellCount: number;
  incomeCount: number;
};

export type FiscalYearReport = {
  year: number;
  /** Disclaimer */
  disclaimer: string;
  byEnvelope: FiscalEnvelopeBucket[];
  totals: {
    realizedPnlEur: number;
    dividendsNetEur: number;
    dividendsGrossEur: number;
    withholdingTaxEur: number;
    /** Estimation PFU 30 % sur (réalisé CTO + div nets hors PEA/AV) — indicative */
    estimatedPfuEur: number;
  };
};

export type FiscalTxLite = {
  type: string;
  occurredAt: string;
  /** payment date for income if any */
  paymentDate?: string | null;
  quantity?: string | number | null;
  unitPrice?: string | number | null;
  fxRateToEur?: string | number | null;
  grossAmountEur?: string | number | null;
  feesEur?: string | number | null;
  netCashImpactEur?: string | number | null;
  withholdingTaxEur?: string | number | null;
  assetId?: string | null;
  accountType?: string | null;
};

const INCOME = new Set(["DIVIDENDE", "COUPON", "LOYER", "INTERET"]);
const ENVELOPE_LABELS: Record<string, string> = {
  CTO: "Compte-Titres",
  PEA: "PEA",
  AV: "Assurance-Vie",
  CRYPTO: "Crypto",
  IMMOBILIER: "Immobilier",
  CFD: "CFD",
};

function n(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

function parisYear(iso: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
    }).formatToParts(new Date(iso));
    return Number(parts.find((p) => p.type === "year")?.value ?? 0);
  } catch {
    return new Date(iso).getUTCFullYear();
  }
}

function emptyBucket(accountType: string): FiscalEnvelopeBucket {
  return {
    accountType,
    label: ENVELOPE_LABELS[accountType] ?? accountType,
    realizedPnlEur: 0,
    dividendsNetEur: 0,
    dividendsGrossEur: 0,
    withholdingTaxEur: 0,
    sellCount: 0,
    incomeCount: 0,
  };
}

/**
 * Calcul simplifié du réalisé d'une vente vs CUMP fourni à la vente.
 * Si `realizedPnlEur` déjà sur la tx, l'utiliser ; sinon estimation gross − cost hint.
 */
export function buildFiscalYearReport(
  year: number,
  transactions: FiscalTxLite[],
  opts?: {
    /** realizedPnl par id de vente si déjà calculé (ledger) */
    realizedByTxId?: Map<string, number>;
    /** CUMP unitaire EUR par assetId juste avant chaque vente — optionnel */
    cumpAtSell?: (tx: FiscalTxLite) => number | null;
  }
): FiscalYearReport {
  const buckets = new Map<string, FiscalEnvelopeBucket>();

  const ensure = (at: string) => {
    const k = at || "CTO";
    let b = buckets.get(k);
    if (!b) {
      b = emptyBucket(k);
      buckets.set(k, b);
    }
    return b;
  };

  for (const tx of transactions) {
    const env = (tx.accountType || "CTO").toUpperCase();
    const b = ensure(env);

    if (tx.type === "VENTE") {
      const y = parisYear(tx.occurredAt);
      if (y !== year) continue;
      const qty = n(tx.quantity);
      const unit = n(tx.unitPrice);
      const fx = n(tx.fxRateToEur) || 1;
      const sellPxEur = unit * fx;
      let realized = 0;
      const cumpFn = opts?.cumpAtSell?.(tx);
      if (cumpFn != null && Number.isFinite(cumpFn) && qty > 0) {
        realized = qty * (sellPxEur - cumpFn);
      } else {
        // Fallback : pas de coût → 0 (évite faux positif)
        realized = 0;
      }
      b.realizedPnlEur += realized;
      b.sellCount += 1;
    } else if (INCOME.has(tx.type)) {
      const payIso = tx.paymentDate || tx.occurredAt;
      if (parisYear(payIso) !== year) continue;
      const gross = n(tx.grossAmountEur);
      const net =
        n(tx.netCashImpactEur) > 0
          ? n(tx.netCashImpactEur)
          : Math.max(0, gross - n(tx.withholdingTaxEur) - n(tx.feesEur));
      const wht = n(tx.withholdingTaxEur);
      b.dividendsGrossEur += gross > 0 ? gross : net;
      b.dividendsNetEur += net;
      b.withholdingTaxEur += wht;
      b.incomeCount += 1;
    }
  }

  const byEnvelope = [...buckets.values()]
    .filter(
      (b) =>
        b.sellCount > 0 ||
        b.incomeCount > 0 ||
        Math.abs(b.realizedPnlEur) > 1e-9 ||
        Math.abs(b.dividendsNetEur) > 1e-9
    )
    .sort((a, b) => a.accountType.localeCompare(b.accountType));

  let realizedPnlEur = 0;
  let dividendsNetEur = 0;
  let dividendsGrossEur = 0;
  let withholdingTaxEur = 0;
  let pfuBase = 0;

  for (const b of byEnvelope) {
    realizedPnlEur += b.realizedPnlEur;
    dividendsNetEur += b.dividendsNetEur;
    dividendsGrossEur += b.dividendsGrossEur;
    withholdingTaxEur += b.withholdingTaxEur;
    // PFU indicatif : CTO / CRYPTO / CFD uniquement (pas PEA/AV)
    if (b.accountType === "CTO" || b.accountType === "CRYPTO" || b.accountType === "CFD") {
      pfuBase += Math.max(0, b.realizedPnlEur) + Math.max(0, b.dividendsNetEur);
    }
  }

  return {
    year,
    disclaimer:
      "Estimations indicatives — ne constituent pas un calcul fiscal opposable. " +
      "PEA / assurance-vie : régimes spéciaux (exonération sous conditions, rachat…). " +
      "Consultez un professionnel pour votre déclaration.",
    byEnvelope,
    totals: {
      realizedPnlEur,
      dividendsNetEur,
      dividendsGrossEur,
      withholdingTaxEur,
      estimatedPfuEur: pfuBase * 0.3,
    },
  };
}

/**
 * Replay minimal pour fournir le CUMP à chaque vente (ordre chrono).
 */
export function buildCumpAtSellLookup(
  transactions: Array<
    FiscalTxLite & {
      id?: string;
      fees?: string | number | null;
      feesEur?: string | number | null;
    }
  >
): (tx: FiscalTxLite & { id?: string }) => number | null {
  // Position cost/qty par assetId (agrégé multi-plateforme pour la vue fiscale simple)
  const qty = new Map<string, number>();
  const cost = new Map<string, number>();

  const ordered = [...transactions].sort(
    (a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  const realizedCump = new Map<string, number>();

  for (const tx of ordered) {
    const assetId = tx.assetId;
    if (!assetId) continue;
    const q = n(tx.quantity);
    const unit = n(tx.unitPrice);
    const fx = n(tx.fxRateToEur) || 1;
    const fees =
      n(tx.feesEur) > 0 ? n(tx.feesEur) : n(tx.fees) * fx;

    if (tx.type === "ACHAT" && q > 0) {
      const buyCost = q * unit * fx + fees;
      qty.set(assetId, (qty.get(assetId) ?? 0) + q);
      cost.set(assetId, (cost.get(assetId) ?? 0) + buyCost);
    } else if (tx.type === "SPLIT" && q > 0) {
      const cur = qty.get(assetId) ?? 0;
      qty.set(assetId, cur * q);
      // cost unchanged
    } else if (tx.type === "VENTE" && q > 0) {
      const q0 = qty.get(assetId) ?? 0;
      const c0 = cost.get(assetId) ?? 0;
      const cump = q0 > 1e-12 ? c0 / q0 : 0;
      if (tx.id) realizedCump.set(tx.id, cump);
      const sold = Math.min(q, q0);
      qty.set(assetId, Math.max(0, q0 - sold));
      cost.set(assetId, Math.max(0, c0 - cump * sold));
    }
  }

  return (tx) => {
    if (tx.type !== "VENTE") return null;
    const id = (tx as { id?: string }).id;
    if (id && realizedCump.has(id)) return realizedCump.get(id)!;
    // fallback recompute not available
    return null;
  };
}
