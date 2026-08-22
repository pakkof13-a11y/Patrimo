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
 * `markPrice` est **déclaratif** : saisi à la création, mis à jour à l'import,
 * égal au prix d'entrée par défaut. Aucun flux de marché ne le rafraîchit. Un
 * P&L latent adossé à un prix vieux d'une semaine n'est pas un P&L latent, et
 * l'écran doit le dire au lieu de parler de « temps réel ».
 */

import type { TradingPositionRow } from "@/components/trading/types";

export type TradeDirection = "LONG" | "SHORT";

/** Fraîcheur du prix de marque, seule chose qui rende le latent crédible. */
export type MarkFreshness =
  /** Prix distinct du prix d'entrée : quelqu'un l'a réellement mis à jour. */
  | "MARKED"
  /** Prix égal au prix d'entrée — valeur par défaut, jamais actualisée. */
  | "UNMARKED"
  /** Aucun prix de marque du tout. */
  | "MISSING";

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

export function markFreshnessOf(row: TradingPositionRow): MarkFreshness {
  const mark = opt(row.markPrice);
  if (mark == null) return "MISSING";
  const entry = num(row.entryPrice);
  /*
    Un prix de marque strictement égal au prix d'entrée est presque toujours le
    défaut posé à la création, pas une cotation. Le signaler évite de présenter
    un P&L nul comme une observation de marché.
  */
  return Math.abs(mark - entry) < 1e-9 ? "UNMARKED" : "MARKED";
}

export const MARK_FRESHNESS_LABEL: Record<MarkFreshness, string> = {
  MARKED: "Prix renseigné",
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

export function buildPositionView(row: TradingPositionRow): PositionView {
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
    liquidationAlert: row.isOpen && row.derived.liquidationAlert,
    fundingAlert: row.derived.fundingAlert,
    hasRiskData:
      row.stopLoss != null ||
      row.takeProfit != null ||
      row.derived.liquidationPriceEstimated != null,
  };
}

export function buildPositionViews(
  rows: TradingPositionRow[]
): PositionView[] {
  return rows.map(buildPositionView);
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
  /** Positions ouvertes dont le prix de marque n'a jamais été actualisé. */
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
      if (v.markFreshness !== "MARKED") unmarked += 1;
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
