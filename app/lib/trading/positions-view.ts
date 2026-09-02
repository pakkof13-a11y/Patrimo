/**
 * Lecture des positions à levier — assemblage, jamais recalcul.
 *
 * Le P&L, le notionnel, la marge et le prix de liquidation sont calculés par
 * `crypto/futures.ts` côté serveur et servis dans `derived`. Ce module ne fait
 * que les présenter, les filtrer et les agréger.
 *
 * ── Ce qu'il refuse d'afficher ───────────────────────────────────────────
 *
 * **Pas de P&L du jour.** Aucune photographie quotidienne des positions
 * n'existe : il n'y a pas de série de prix de marque historisée, donc rien à
 * comparer à hier. Le calculer depuis le P&L latent total reviendrait à
 * l'attribuer entièrement à la journée en cours.
 *
 * **Pas d'exécution ni de fills.** Une position est une ligne dans ce modèle,
 * pas un ensemble d'ordres partiels. Il n'y a ni table d'ordres ni table de
 * fills à lire.
 *
 * ── La fraîcheur du prix, qui conditionne tout le reste ──────────────────
 *
 * `markPrice` est **déclaratif** : saisi à la création, lu dans un relevé à
 * l'import, égal au prix d'entrée par défaut. Aucun flux de marché ne le
 * rafraîchit, et il n'en existe aucun à réutiliser — ni les wallets on-chain
 * ni les imports n'en fournissent, et le prix spot du sous-jacent n'est pas un
 * prix de marque : sur un perpétuel, la base et le funding les séparent.
 *
 * `markPriceUpdatedAt` date chaque observation réelle. La fraîcheur affichée
 * est donc un **fait**, là où la comparaison au prix d'entrée n'était qu'une
 * présomption. Un P&L latent adossé à un prix vieux d'une semaine n'est pas un
 * P&L latent, et l'écran le dit au lieu de parler de « temps réel ».
 */

import type { TradingPositionRow } from "@/components/trading/types";

export type TradeDirection = "LONG" | "SHORT";

/** Fraîcheur du prix de marque, seule chose qui rende le latent crédible. */
export type MarkFreshness =
  /** Prix observé et daté. */
  | "MARKED"
  /** Aucune observation datée : le prix n'est qu'un repli sur l'entrée. */
  | "UNMARKED"
  /** Aucun prix de marque du tout. */
  | "MISSING";

/**
 * Au-delà, un prix de marque est présenté comme ancien.
 *
 * Sept jours : sur un contrat à levier, une semaine suffit à rendre un P&L
 * latent sans rapport avec la réalité. Le seuil ne masque rien — la date exacte
 * reste affichée — il choisit seulement à partir de quand l'écran le signale.
 */
export const STALE_MARK_DAYS = 7;

export type PositionView = {
  row: TradingPositionRow;
  id: string;
  instrument: string;
  exchange: string;
  direction: TradeDirection;
  isOpen: boolean;
  underlyingType: string;
  contractType: string;

  size: number;
  entryPrice: number;
  markPrice: number | null;
  /** P&L retenu : latent si ouverte, réalisé net si close. */
  pnlEur: number;
  /** Rapporté à la marge engagée — le capital réellement immobilisé. */
  pnlPct: number | null;
  notionalEur: number;
  marginEur: number;
  leverage: number;

  markFreshness: MarkFreshness;
  /** Ancienneté de l'observation, en jours. `null` sans observation datée. */
  markAgeDays: number | null;
  /** Observation datée mais trop ancienne pour porter un P&L latent crédible. */
  markIsStale: boolean;
  liquidationAlert: boolean;
  fundingAlert: boolean;
  hasRiskData: boolean;
};

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const opt = (v: string | number | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Fraîcheur du prix de marque.
 *
 * `markPriceUpdatedAt` est la source : il n'est posé que lorsqu'un prix a été
 * réellement observé — saisi ou lu dans un relevé. C'est un fait, là où la
 * comparaison au prix d'entrée n'était qu'une présomption.
 *
 * Cette présomption reste en repli pour les lignes créées avant l'ajout de
 * l'horodatage : sans elle, tout l'historique basculerait d'un coup en « prix
 * non actualisé », y compris des positions dont le prix avait bien été saisi.
 */
export function markFreshnessOf(row: TradingPositionRow): MarkFreshness {
  const mark = opt(row.markPrice);
  if (mark == null) return "MISSING";
  if (row.markPriceUpdatedAt) return "MARKED";

  const entry = num(row.entryPrice);
  return Math.abs(mark - entry) < 1e-9 ? "UNMARKED" : "MARKED";
}

/** Ancienneté de l'observation, en jours. `null` s'il n'y en a aucune. */
export function markAgeDays(
  row: TradingPositionRow,
  now: Date
): number | null {
  if (!row.markPriceUpdatedAt) return null;
  const t = new Date(row.markPriceUpdatedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/**
 * Phrase de fraîcheur à afficher sous un P&L latent.
 *
 * Elle ne prétend jamais au temps réel : Aurea n'a **aucune** source de mark
 * price. Ni les wallets on-chain, ni les imports de relevés n'en fournissent,
 * et le prix spot du sous-jacent n'en est pas un — sur un perpétuel, la base et
 * le funding les séparent. L'écran dit donc quand le prix a été observé, et
 * laisse l'utilisateur juger.
 */
export function markFreshnessNotice(
  row: TradingPositionRow,
  now: Date
): string {
  const freshness = markFreshnessOf(row);
  if (freshness === "MISSING") {
    return "Aucun prix de marque enregistré : le P&L latent ne peut pas être calculé.";
  }
  if (freshness === "UNMARKED") {
    return "Le prix de marque est resté au prix d'entrée. Aurea ne le rafraîchit pas depuis le marché — mettez-le à jour pour obtenir un P&L latent significatif.";
  }

  const age = markAgeDays(row, now);
  if (age == null) {
    return "Prix de marque saisi. Aurea ne le rafraîchit pas depuis le marché.";
  }
  if (age === 0) return "Prix de marque observé aujourd'hui.";
  if (age === 1) return "Prix de marque observé hier.";
  return `Prix de marque observé il y a ${age} jours.`;
}

export const MARK_FRESHNESS_LABEL: Record<MarkFreshness, string> = {
  MARKED: "Prix observé",
  UNMARKED: "Prix non actualisé",
  MISSING: "Prix inconnu",
};

/**
 * P&L net d'une position close : réalisé, funding et commissions déduits.
 * Miroir de `realizedNetPnl` du moteur, appliqué aux chaînes du payload.
 */
export function closedNetPnl(row: TradingPositionRow): number {
  const realized = num(row.realizedPnl);
  const funding = Math.abs(num(row.fundingPaid));
  const commission = Math.abs(num(row.commissionPaid));
  return realized - funding - commission;
}

export function buildPositionView(
  row: TradingPositionRow,
  now: Date = new Date()
): PositionView {
  const direction = (row.direction === "SHORT" ? "SHORT" : "LONG") as TradeDirection;
  const marginEur = num(row.derived.marginUsedEur);
  const pnlEur = row.isOpen
    ? num(row.derived.unrealizedPnlEur)
    : closedNetPnl(row);

  /*
    Le pourcentage se rapporte à la **marge**, pas au notionnel. Sur un levier
    x5, un mouvement de 1 % du sous-jacent fait 5 % du capital engagé : c'est
    ce second chiffre qui informe le trader sur ce qu'il risque réellement.
  */
  const pnlPct = marginEur > 0 ? (pnlEur / marginEur) * 100 : null;
  const age = markAgeDays(row, now);

  return {
    row,
    id: row.id,
    instrument: row.instrument,
    exchange: row.exchange,
    direction,
    isOpen: row.isOpen,
    underlyingType: row.underlyingType,
    contractType: row.contractType,
    size: num(row.sizeContracts),
    entryPrice: num(row.entryPrice),
    markPrice: opt(row.markPrice),
    pnlEur,
    pnlPct,
    notionalEur: num(row.derived.notionalEur),
    marginEur,
    leverage: num(row.leverage),
    markFreshness: markFreshnessOf(row),
    markAgeDays: age,
    /*
      « Ancien » ne concerne que les positions ouvertes : sur une position
      close, le prix de marque est le prix de sortie — il est définitif, pas
      périmé.
    */
    markIsStale: row.isOpen && age != null && age > STALE_MARK_DAYS,
    liquidationAlert: row.isOpen && row.derived.liquidationAlert,
    fundingAlert: row.derived.fundingAlert,
    hasRiskData:
      row.stopLoss != null ||
      row.takeProfit != null ||
      row.derived.liquidationPriceEstimated != null,
  };
}

export function buildPositionViews(
  rows: TradingPositionRow[],
  now: Date = new Date()
): PositionView[] {
  return rows.map((r) => buildPositionView(r, now));
}

// ─── Synthèse ────────────────────────────────────────────────────────────────

export type TradingOverview = {
  openCount: number;
  closedCount: number;
  /** P&L latent des seules positions ouvertes. */
  unrealizedPnlEur: number;
  /** Résultat net des positions closes, funding et commissions déduits. */
  realizedPnlEur: number;
  /** Notionnel long − notionnel short : ce à quoi le portefeuille est exposé. */
  netExposureEur: number;
  /** Notionnel total, sens confondus : la taille des paris en cours. */
  grossExposureEur: number;
  /** Capital réellement immobilisé. */
  marginEur: number;
  liquidationAlerts: number;
  /**
   * Positions ouvertes dont le P&L latent ne peut pas être pris au sérieux :
   * prix jamais observé, ou observation trop ancienne.
   */
  unmarkedCount: number;
  exchangeCount: number;
};

export function computeTradingOverview(
  views: PositionView[]
): TradingOverview {
  let openCount = 0;
  let closedCount = 0;
  let unrealized = 0;
  let realized = 0;
  let net = 0;
  let gross = 0;
  let margin = 0;
  let alerts = 0;
  let unmarked = 0;
  const exchanges = new Set<string>();

  for (const v of views) {
    exchanges.add(v.exchange);
    if (v.isOpen) {
      openCount += 1;
      unrealized += v.pnlEur;
      net += num(v.row.derived.signedNotionalEur);
      gross += v.notionalEur;
      margin += v.marginEur;
      if (v.liquidationAlert) alerts += 1;
      if (v.markFreshness !== "MARKED" || v.markIsStale) unmarked += 1;
    } else {
      closedCount += 1;
      realized += v.pnlEur;
    }
  }

  return {
    openCount,
    closedCount,
    unrealizedPnlEur: unrealized,
    realizedPnlEur: realized,
    netExposureEur: net,
    grossExposureEur: gross,
    marginEur: margin,
    liquidationAlerts: alerts,
    unmarkedCount: unmarked,
    exchangeCount: exchanges.size,
  };
}

// ─── Filtres ─────────────────────────────────────────────────────────────────

export type StatusFilter = "OPEN" | "CLOSED" | "ALL";
export type DirectionFilter = "ALL" | "LONG" | "SHORT";

export type PositionFilters = {
  status: StatusFilter;
  direction: DirectionFilter;
  exchange: string;
  underlyingType: string;
  search: string;
};

export const EMPTY_FILTERS: PositionFilters = {
  status: "OPEN",
  direction: "ALL",
  exchange: "ALL",
  underlyingType: "ALL",
  search: "",
};

export function filterPositions(
  views: PositionView[],
  f: PositionFilters
): PositionView[] {
  const q = f.search.trim().toLowerCase();
  return views.filter((v) => {
    if (f.status === "OPEN" && !v.isOpen) return false;
    if (f.status === "CLOSED" && v.isOpen) return false;
    if (f.direction !== "ALL" && v.direction !== f.direction) return false;
    if (f.exchange !== "ALL" && v.exchange !== f.exchange) return false;
    if (f.underlyingType !== "ALL" && v.underlyingType !== f.underlyingType) {
      return false;
    }
    if (q) {
      const hay = [
        v.instrument,
        v.exchange,
        v.underlyingType,
        v.row.subAccountLabel,
        v.row.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export type PositionSort = "pnl" | "exposure" | "instrument" | "date";

export function sortPositions(
  views: PositionView[],
  sort: PositionSort
): PositionView[] {
  const out = [...views];
  switch (sort) {
    case "instrument":
      return out.sort((a, b) =>
        a.instrument.localeCompare(b.instrument, "fr", { sensitivity: "base" })
      );
    case "exposure":
      return out.sort((a, b) => b.notionalEur - a.notionalEur);
    case "date":
      return out.sort((a, b) => {
        const ta = new Date(
          a.row.closedAt ?? a.row.openedAt ?? 0
        ).getTime();
        const tb = new Date(
          b.row.closedAt ?? b.row.openedAt ?? 0
        ).getTime();
        return tb - ta;
      });
    case "pnl":
    default:
      return out.sort((a, b) => b.pnlEur - a.pnlEur);
  }
}
