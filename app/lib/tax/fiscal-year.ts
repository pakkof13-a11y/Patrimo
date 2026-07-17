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
  /** native fees (converted with fx when feesEur absent) */
  fees?: string | number | null;
  netCashImpactEur?: string | number | null;
  withholdingTaxEur?: string | number | null;
  assetId?: string | null;
  /** Courtiers — le CUMP est par (assetId × platformId), comme le ledger */
  platformId?: string | null;
  toPlatformId?: string | null;
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
      const fees =
        n(tx.feesEur) > 0 ? n(tx.feesEur) : n(tx.fees) * fx;
      let realized = 0;
      const cumpFn = opts?.cumpAtSell?.(tx);
      if (cumpFn != null && Number.isFinite(cumpFn) && qty > 0) {
        // Aligné ledger : (qty × px − fees) − qty × CUMP
        realized = qty * sellPxEur - fees - qty * cumpFn;
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
      "Estimations de suivi patrimonial — non opposables à l’administration fiscale. " +
      "Le PFU estimé ne concerne que les enveloppes CTO, crypto et CFD (gains positifs). " +
      "PEA et assurance-vie relèvent de régimes spéciaux non simulés ici. " +
      "Pour toute déclaration, appuyez-vous sur vos relevés et un professionnel.",
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
 * Clé de lot fiscal / CUMP — alignée sur le ledger (`assetId::platformId`).
 * Sans platformId (données historiques incomplètes) → lot par assetId seul.
 */
export function fiscalLotKey(
  assetId: string,
  platformId?: string | null
): string {
  const p = platformId?.trim();
  return p ? `${assetId}::${p}` : assetId;
}

/**
 * Replay CUMP par lot (asset × plateforme), ordre chrono.
 * Évite d’agréger les coûts multi-courtiers sur un même assetId.
 * Gère aussi TRANSFERT_TITRE (déplace qty + coût proportionnel, sans P&L).
 */
export function buildCumpAtSellLookup(
  transactions: Array<FiscalTxLite & { id?: string }>
): (tx: FiscalTxLite & { id?: string }) => number | null {
  const qty = new Map<string, number>();
  const cost = new Map<string, number>();

  const ordered = [...transactions].sort((a, b) => {
    const da = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (da !== 0) return da;
    const ida = (a as { id?: string }).id ?? "";
    const idb = (b as { id?: string }).id ?? "";
    return ida.localeCompare(idb);
  });

  const realizedCump = new Map<string, number>();

  for (const tx of ordered) {
    const assetId = tx.assetId;
    if (!assetId) continue;
    const key = fiscalLotKey(assetId, tx.platformId);
    const q = n(tx.quantity);
    const unit = n(tx.unitPrice);
    const fx = n(tx.fxRateToEur) || 1;
    const fees = n(tx.feesEur) > 0 ? n(tx.feesEur) : n(tx.fees) * fx;

    if (tx.type === "ACHAT" && q > 0) {
      const buyCost = q * unit * fx + fees;
      qty.set(key, (qty.get(key) ?? 0) + q);
      cost.set(key, (cost.get(key) ?? 0) + buyCost);
    } else if (tx.type === "REWARD" && q > 0) {
      // Réception gratuite : +qty, coût d'acquisition inchangé (0 pour ce lot)
      qty.set(key, (qty.get(key) ?? 0) + q);
    } else if (tx.type === "SPLIT" && q > 0) {
      const cur = qty.get(key) ?? 0;
      qty.set(key, cur * q);
      // cost total unchanged → unit CUMP drops
    } else if (tx.type === "TRANSFERT_TITRE" && q > 0 && tx.toPlatformId) {
      const toKey = fiscalLotKey(assetId, tx.toPlatformId);
      const q0 = qty.get(key) ?? 0;
      const c0 = cost.get(key) ?? 0;
      const cump = q0 > 1e-12 ? c0 / q0 : 0;
      const moved = Math.min(q, q0);
      const movedCost = cump * moved;
      qty.set(key, Math.max(0, q0 - moved));
      cost.set(key, Math.max(0, c0 - movedCost));
      qty.set(toKey, (qty.get(toKey) ?? 0) + moved);
      cost.set(toKey, (cost.get(toKey) ?? 0) + movedCost);
    } else if (tx.type === "VENTE" && q > 0) {
      const q0 = qty.get(key) ?? 0;
      const c0 = cost.get(key) ?? 0;
      const cump = q0 > 1e-12 ? c0 / q0 : 0;
      if (tx.id) realizedCump.set(tx.id, cump);
      const sold = Math.min(q, q0);
      qty.set(key, Math.max(0, q0 - sold));
      cost.set(key, Math.max(0, c0 - cump * sold));
    }
  }

  return (tx) => {
    if (tx.type !== "VENTE") return null;
    const id = (tx as { id?: string }).id;
    if (id && realizedCump.has(id)) return realizedCump.get(id)!;
    return null;
  };
}
