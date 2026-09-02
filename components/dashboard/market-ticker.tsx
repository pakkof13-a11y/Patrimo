"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn } from "@/app/lib/utils";
import { MARKET_INDICES, type MarketIndexKey } from "@/app/lib/portfolio/market-indices";
import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

const TICKER_KEYS: MarketIndexKey[] = [
  "cac40",
  "sp500",
  "bitcoin",
  "ethereum",
  "eurusd",
  "gold",
];

export const TICKER_VISIBLE_KEY = "dashboardTickerVisible";

type BenchmarkResponse = { points: Array<{ date: string; close: number }> };

function latestChange(points: BenchmarkResponse["points"] | undefined): {
  pct: number;
} | null {
  if (!points || points.length < 2) return null;
  const prev = points[points.length - 2]!.close;
  const last = points[points.length - 1]!.close;
  if (!Number.isFinite(prev) || prev === 0 || !Number.isFinite(last)) return null;
  return { pct: ((last - prev) / prev) * 100 };
}

/**
 * Bandeau ticker défilant (indices / crypto / forex) — données réelles via
 * la même API /api/benchmark que le comparateur de performance du module
 * Évolution (auth + cache + rate-limit déjà en place, aucune nouvelle route).
 */
export function MarketTicker() {
  const [visible, setVisible] = useState(() =>
    typeof window !== "undefined" ? loadUiPref(TICKER_VISIBLE_KEY, true) : true
  );

  const to = useMemo(() => new Date(), []);
  const from = useMemo(
    () => new Date(to.getTime() - 10 * 24 * 60 * 60 * 1000),
    [to]
  );

  const queries = useQueries({
    queries: TICKER_KEYS.map((key) => ({
      queryKey: ["market-ticker", key, from.toISOString().slice(0, 10)],
      queryFn: () =>
        fetchJson<BenchmarkResponse>(
          `/api/benchmark?${new URLSearchParams({
            symbol: key,
            from: from.toISOString(),
            to: to.toISOString(),
          }).toString()}`
        ),
      staleTime: 15 * 60_000,
      retry: 1,
      enabled: visible,
    })),
  });

  const items = useMemo(
    () =>
      TICKER_KEYS.map((key, i) => {
        const q = queries[i];
        const change = q?.isSuccess ? latestChange(q.data?.points) : null;
        const label =
          MARKET_INDICES.find((m) => m.key === key)?.label ?? key;
        return change ? { key, label, pct: change.pct } : null;
      }).filter((x): x is { key: MarketIndexKey; label: string; pct: number } =>
        x != null
      ),
    [queries]
  );

  function toggleVisible() {
    setVisible((v) => {
      const next = !v;
      saveUiPref(TICKER_VISIBLE_KEY, next);
      return next;
    });
  }

  if (!visible) {
    return (
      <button
        type="button"
        onClick={toggleVisible}
        className={cn(
          "inline-flex w-fit items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium",
          "text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        )}
        data-testid="dashboard-ticker-toggle"
      >
        <ChevronDown className="h-3.5 w-3.5" />
        Afficher le ticker marchés
      </button>
    );
  }

  const row = items.length > 0 ? items : null;

  return (
    <div
      className="dashboard-ticker relative flex items-center"
      data-testid="dashboard-ticker"
    >
      {row ? (
        <div className="dashboard-ticker-track py-1.5 pl-3">
          {[...row, ...row].map((it, i) => (
            <span
              key={`${it.key}-${i}`}
              className="text-[11px]"
              style={{ color: "#8b9099" }}
            >
              {it.label}{" "}
              <span
                style={{ color: it.pct >= 0 ? "#8fb28f" : "#c07a68" }}
              >
                {it.pct >= 0 ? "+" : ""}
                {it.pct.toFixed(2)}%
              </span>
            </span>
          ))}
        </div>
      ) : (
        <div className="skeleton-block h-7 w-full rounded-[var(--radius-lg)]" />
      )}
      <button
        type="button"
        onClick={toggleVisible}
        title="Masquer le ticker"
        aria-label="Masquer le ticker marchés"
        data-testid="dashboard-ticker-hide"
        className="absolute right-1.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#8b9099] transition hover:text-[#ece7dd] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
