/**
 * Alignement marqueurs Achat / Vente / Dividende sur les barres OHLC.
 * Logique pure (pas de React) — utilisée par SessionLine/Candle charts.
 */

import type { PriceBarInterval } from "@/app/lib/market/price-history-types";
import type { LedgerTxLite } from "@/app/lib/portfolio/total-return";
import { formatCurrency } from "@/app/lib/utils";
import { normalizeSessionOhlc } from "@/app/lib/market/price-history-types";
import type { PriceHistoryPoint } from "@/app/lib/market/price-history-types";

export function isIntraday(iv?: PriceBarInterval): boolean {
  return iv === "15m" || iv === "1h" || iv === "4h";
}

export function formatDateFr(iso: string, bar?: PriceBarInterval): string {
  try {
    if (isIntraday(bar)) {
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(iso));
    }
    if (bar === "1wk") {
      return (
        "Sem. du " +
        new Intl.DateTimeFormat("fr-FR", {
          timeZone: "Europe/Paris",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(iso))
      );
    }
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatCompact(v: number): string {
  return new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(v);
}

export function ensureSession(p: PriceHistoryPoint): PriceHistoryPoint {
  const n = normalizeSessionOhlc(p);
  return { ...p, ...n, price: n.close };
}

/** Date comparable (calendrier Paris) → 'YYYY-MM-DD' */
export function toDayKey(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * La transaction est dans la plage affichée ssi :
 * - son timestamp est entre la 1ʳᵉ et la dernière barre, OU
 * - elle tombe le même jour calendaire (Paris) qu'au moins une barre.
 */
export function isTxWithinDisplayedRange(
  txIso: string,
  bars: Array<{ date: string }>
): boolean {
  if (bars.length === 0) return false;
  const t = new Date(txIso).getTime();
  if (!Number.isFinite(t)) return false;
  const t0 = new Date(bars[0]!.date).getTime();
  const t1 = new Date(bars[bars.length - 1]!.date).getTime();
  if (t >= t0 && t <= t1) return true;
  const day = toDayKey(txIso);
  for (const b of bars) {
    if (toDayKey(b.date) === day) return true;
  }
  return false;
}

/** Index de la barre de cours la plus proche — uniquement si tx dans la plage. */
export function findNearestBarIndex(
  bars: Array<{ date: string }>,
  txIso: string
): number {
  if (bars.length === 0) return -1;
  if (!isTxWithinDisplayedRange(txIso, bars)) return -1;

  const t = new Date(txIso).getTime();
  if (!Number.isFinite(t)) return -1;

  const day = toDayKey(txIso);
  let dayMatch = -1;
  let dayBestDist = Infinity;
  for (let i = 0; i < bars.length; i++) {
    if (toDayKey(bars[i]!.date) !== day) continue;
    const d = Math.abs(new Date(bars[i]!.date).getTime() - t);
    if (d < dayBestDist) {
      dayBestDist = d;
      dayMatch = i;
    }
  }
  if (dayMatch >= 0) return dayMatch;

  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < bars.length; i++) {
    const d = Math.abs(new Date(bars[i]!.date).getTime() - t);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function formatTxDateTimeFr(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function nField(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Prix unitaire en EUR (hors frais) pour coller à la courbe EUR. */
export function unitPriceEur(tx: LedgerTxLite): number | null {
  const p = nField(tx.unitPrice);
  if (p <= 0) return null;
  const fx = nField(tx.fxRateToEur) || 1;
  return p * fx;
}

export function txAmountEur(tx: LedgerTxLite): number {
  const gross = nField(tx.grossAmountEur);
  if (gross > 0) return gross;
  const qty = nField(tx.quantity);
  const up = unitPriceEur(tx);
  if (qty > 0 && up != null) return qty * up;
  return Math.abs(nField(tx.netCashImpactEur));
}

export type MarkerKind = "BUY" | "SELL" | "DIVIDEND";

/** Point marqueur aligné sur l'index de barre (axe X). */
export type ChartTxMarker = {
  i: number;
  barIndex: number;
  label: string;
  date: string;
  markerPrice: number;
  lineAnchorPrice: number;
  candleAnchorPrice: number;
  barLow: number;
  barHigh: number;
  barOpen: number;
  barClose: number;
  kind: MarkerKind;
  quantity?: number;
  unitPrice?: number;
  amountEur: number;
  isMarker: true;
};

export function markerTooltipText(m: ChartTxMarker): string {
  const when = formatTxDateTimeFr(m.date);
  const qty =
    m.quantity != null && m.quantity > 0
      ? m.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 6 })
      : null;
  const unit =
    m.unitPrice != null ? formatCurrency(m.unitPrice, "EUR") : null;
  const total = formatCurrency(m.amountEur, "EUR");

  if (m.kind === "BUY") {
    return `Achat : ${qty ?? "—"} parts${unit ? ` à ${unit}` : ""} (Total : ${total}) le ${when}`;
  }
  if (m.kind === "SELL") {
    return `Vente : ${qty ?? "—"} parts${unit ? ` à ${unit}` : ""} (Total : ${total}) le ${when}`;
  }
  return `Dividende : ${total} perçus le ${when}`;
}

const MARKER_TX_TYPES: Record<string, MarkerKind> = {
  ACHAT: "BUY",
  VENTE: "SELL",
  DIVIDENDE: "DIVIDEND",
  COUPON: "DIVIDEND",
  LOYER: "DIVIDEND",
  INTERET: "DIVIDEND",
};

/**
 * Marqueurs Achat / Vente / Dividende strictement dans la plage affichée.
 */
export function buildChartTxMarkers(
  bars: Array<{
    date: string;
    label: string;
    close: number;
    open?: number;
    high?: number;
    low?: number;
  }>,
  transactions: LedgerTxLite[]
): ChartTxMarker[] {
  if (bars.length === 0 || transactions.length === 0) return [];

  const raw: ChartTxMarker[] = [];
  for (const tx of transactions) {
    if (tx.type === "FRAIS" || tx.type === "FEES") continue;
    const kind = MARKER_TX_TYPES[tx.type];
    if (!kind) continue;

    if (!isTxWithinDisplayedRange(tx.occurredAt, bars)) continue;

    const idx = findNearestBarIndex(bars, tx.occurredAt);
    if (idx < 0) continue;
    const bar = bars[idx]!;
    const close = Number(bar.close) || 0;
    const high = Number(bar.high ?? close) || close;
    const low = Number(bar.low ?? close) || close;
    const span = Math.max(high - low, Math.abs(close) * 0.004, 0.01);
    const pad = span * 0.12;

    const exec = unitPriceEur(tx);
    const barClose = close > 0 ? close : high > 0 ? high : low;
    if (!(barClose > 0) || !Number.isFinite(barClose)) continue;

    const markerPrice =
      exec != null && exec > 0 && Number.isFinite(exec) ? exec : barClose;

    const lineAnchorPrice = barClose;
    const candleAnchorPrice = kind === "BUY" ? low - pad : high + pad;

    const qty = nField(tx.quantity);
    const open = Number(bar.open ?? close) || close;
    raw.push({
      i: idx,
      barIndex: idx,
      label: bar.label,
      date: tx.occurredAt,
      markerPrice,
      lineAnchorPrice,
      candleAnchorPrice,
      barLow: low,
      barHigh: high,
      barOpen: open,
      barClose,
      kind,
      quantity: qty > 0 ? qty : undefined,
      unitPrice: exec ?? undefined,
      amountEur: txAmountEur(tx),
      isMarker: true,
    });
  }

  const byBar = new Map<number, ChartTxMarker[]>();
  for (const m of raw) {
    const list = byBar.get(m.barIndex) ?? [];
    list.push(m);
    byBar.set(m.barIndex, list);
  }
  const out: ChartTxMarker[] = [];
  for (const [, group] of byBar) {
    const n = group.length;
    group.forEach((m, k) => {
      const offset = n <= 1 ? 0 : (k - (n - 1) / 2) * 0.22;
      out.push({ ...m, i: m.barIndex + offset });
    });
  }
  out.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return out;
}

export function safeFinite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}
