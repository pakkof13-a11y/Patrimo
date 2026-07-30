"use client";

import { useQueries } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { MARKET_TICKERS } from "@/app/lib/portfolio/market-indices";
import { cn } from "@/app/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";

type ClosePoint = { date: string; close: number };

/** Fenêtre courte : il ne faut qu'une tendance, pas un historique. */
const WINDOW_DAYS = 12;
const REFRESH_MS = 15 * 60_000;

export type TickerQuote = {
  key: string;
  label: string;
  last: number;
  prevClose: number;
  changePct: number;
  closes: number[];
};

/**
 * Dérive une cotation affichable d'une série de clôtures.
 *
 * Exige **deux** points : avec un seul, la variation serait calculée contre
 * la valeur elle-même et afficherait un 0,00 % trompeur — un bandeau de
 * marché qui annonce « stable » alors qu'il n'en sait rien est pire que muet.
 */
export function toQuote(
  key: string,
  label: string,
  points: ClosePoint[] | undefined
): TickerQuote | null {
  const closes = (points ?? [])
    .map((p) => Number(p.close))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (closes.length < 2) return null;
  const last = closes[closes.length - 1]!;
  const prevClose = closes[closes.length - 2]!;
  return {
    key,
    label,
    last,
    prevClose,
    changePct: ((last - prevClose) / prevClose) * 100,
    closes,
  };
}

/** Cours : compact au-delà de 10 000 pour tenir dans une ligne de 30 px. */
function formatPrice(v: number): string {
  if (v >= 10_000) {
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
  }
  return v.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: v < 10 ? 4 : 2,
  });
}

function formatPct(v: number): string {
  const s = Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v >= 0 ? "+" : "−"}${s} %`;
}

/**
 * Bandeau des marchés — la ligne la plus fine de l'interface.
 *
 * Statique et non défilant, contrairement aux bandeaux de chaînes d'info : un
 * texte qui bouge tout seul est illisible au clavier, indexé deux fois par les
 * lecteurs d'écran (piste dupliquée) et impossible à pointer à la souris. La
 * rangée défile horizontalement à la demande quand la largeur manque.
 */
export function MarketTicker({ className }: { className?: string }) {
  const results = useQueries({
    queries: MARKET_TICKERS.map((t) => ({
      queryKey: ["market-ticker", t.key],
      staleTime: REFRESH_MS,
      refetchInterval: REFRESH_MS,
      retry: 1,
      queryFn: () => {
        const to = new Date();
        const from = new Date(to.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          symbol: t.key,
          from: from.toISOString(),
          to: to.toISOString(),
        });
        return fetchJson<{ points: ClosePoint[] }>(
          `/api/benchmark?${params.toString()}`
        );
      },
    })),
  });

  const quotes = MARKET_TICKERS.map((t, i) =>
    toQuote(t.key, t.label, results[i]?.data?.points)
  ).filter((q): q is TickerQuote => q !== null);

  const loading = results.some((r) => r.isLoading) && quotes.length === 0;

  return (
    <div
      className={cn("term-ticker", className)}
      data-testid="market-ticker"
      aria-label="Cotations de marché"
    >
      {/*
        Résumé unique pour les aides techniques. Les cotations visuelles sont
        masquées (`aria-hidden`) : lues telles quelles, elles produiraient une
        bouillie de nombres sans unité ni contexte.
      */}
      <p className="sr-only">
        {quotes.length === 0
          ? "Cotations de marché indisponibles."
          : quotes
              .map(
                (q) =>
                  `${q.label} ${formatPrice(q.last)}, ${formatPct(q.changePct)}`
              )
              .join(". ")}
      </p>

      <div className="term-ticker-rail" aria-hidden>
        {loading && <span className="term-ticker-symbol">Chargement…</span>}
        {!loading && quotes.length === 0 && (
          <span className="term-ticker-symbol">Cotations indisponibles</span>
        )}
        {quotes.map((q) => {
          const up = q.changePct >= 0;
          const stroke = up ? "var(--chart-positive)" : "var(--chart-negative)";
          return (
            <span
              key={q.key}
              className="term-ticker-item"
              data-testid={`ticker-${q.key}`}
            >
              <span className="term-ticker-symbol">{q.label}</span>
              <span className="term-ticker-price">{formatPrice(q.last)}</span>
              <span className={up ? "val-positive" : "val-negative"}>
                {formatPct(q.changePct)}
              </span>
              <Sparkline values={q.closes} stroke={stroke} />
            </span>
          );
        })}
      </div>
    </div>
  );
}
