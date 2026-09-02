/** Filtre rapide P&L latent — fonction pure. */

export type PnlFilter = "all" | "gain" | "loss";

export function parsePnlFilter(value: string | null | undefined): PnlFilter {
  return value === "gain" || value === "loss" ? value : "all";
}

export function matchesPnlFilter(
  unrealizedPnl: string | number,
  filter: PnlFilter
): boolean {
  if (filter === "all") return true;
  const n = Number(unrealizedPnl);
  if (!Number.isFinite(n)) return false;
  return filter === "gain" ? n > 0 : n < 0;
}
