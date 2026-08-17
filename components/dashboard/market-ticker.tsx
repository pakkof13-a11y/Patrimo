"use client";

import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Pause, Play } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn } from "@/app/lib/utils";
import { MARKET_INDICES, type MarketIndexKey } from "@/app/lib/portfolio/market-indices";
import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";

const TICKER_KEYS: MarketIndexKey[] = [
  "cac40",
  "sp500",
  "nasdaq",
  "eurostoxx50",
  "bitcoin",
  "ethereum",
  "eurusd",
  "gold",
];

export const TICKER_VISIBLE_KEY = "dashboardTickerVisible";

type BenchmarkResponse = { points: Array<{ date: string; close: number }> };

type TickerItem = {
  key: MarketIndexKey;
  label: string;
  close: number;
  pct: number;
  /** Date de la dernière clôture connue (ISO court) — jamais du temps réel. */
  asOf: string | null;
};

/**
 * Dernière clôture + variation vs clôture précédente.
 * `null` dès qu'une des deux bornes manque : mieux vaut retirer la ligne du
 * bandeau que d'afficher une variation qu'on ne sait pas calculer.
 */
function latestQuote(
  points: BenchmarkResponse["points"] | undefined
): { close: number; pct: number; asOf: string | null } | null {
  if (!points || points.length < 2) return null;
  const prev = points[points.length - 2]!.close;
  const lastPoint = points[points.length - 1]!;
  const last = lastPoint.close;
  if (!Number.isFinite(prev) || prev === 0 || !Number.isFinite(last)) return null;
  return { close: last, pct: ((last - prev) / prev) * 100, asOf: lastPoint.date ?? null };
}

/** Compacte les grands nombres sans jamais masquer l'ordre de grandeur. */
function formatClose(v: number): string {
  const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 2 : 4;
  return v.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPct(pct: number): string {
  const abs = Math.abs(pct).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${pct >= 0 ? "+" : "−"}${abs} %`;
}

/**
 * Bandeau ticker défilant (indices / crypto / forex) — données réelles via
 * la même API /api/benchmark que le comparateur de performance du module
 * Évolution (auth + cache + rate-limit déjà en place, aucune nouvelle route).
 *
 * Ces séries sont des **clôtures journalières**, pas un flux temps réel : le
 * bandeau l'annonce explicitement (« clôture du … ») plutôt que de laisser
 * croire à une cotation live.
 */
export function MarketTicker() {
  const [visible, setVisible] = useState(() =>
    typeof window !== "undefined" ? loadUiPref(TICKER_VISIBLE_KEY, true) : true
  );
  const [paused, setPaused] = useState(false);

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

  const settled = queries.every((q) => !q.isPending);

  const items = useMemo(
    () =>
      TICKER_KEYS.map((key, i) => {
        const q = queries[i];
        const quote = q?.isSuccess ? latestQuote(q.data?.points) : null;
        const label = MARKET_INDICES.find((m) => m.key === key)?.label ?? key;
        return quote ? { key, label, ...quote } : null;
      }).filter((x): x is TickerItem => x != null),
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
          "inline-flex min-h-[2.25rem] w-fit items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-1.5 text-xs font-medium",
          "text-[var(--foreground-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]",
          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] motion-reduce:transition-none"
        )}
        data-testid="dashboard-ticker-toggle"
      >
        <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        Afficher le ticker marchés
      </button>
    );
  }

  const asOf = items.find((i) => i.asOf)?.asOf ?? null;
  const asOfLabel = asOf
    ? new Date(asOf).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
    : null;

  return (
    <section
      className="dashboard-ticker flex items-center gap-1 pr-1"
      data-testid="dashboard-ticker"
      data-paused={paused ? "true" : "false"}
      aria-label="Indices de marché, dernière clôture connue"
    >
      {items.length > 0 ? (
        <>
          {/*
            Résumé lisible par lecteur d'écran : la piste animée est dupliquée
            pour la boucle visuelle, elle est donc masquée à l'assistance et
            remplacée par cette liste unique et statique.
          */}
          <p className="sr-only">
            Dernière clôture connue{asOfLabel ? ` du ${asOfLabel}` : ""} :{" "}
            {items
              .map((it) => `${it.label} ${formatClose(it.close)}, ${formatPct(it.pct)}`)
              .join(" ; ")}
            .
          </p>

          <div className="dashboard-ticker-viewport" aria-hidden>
            <div className="dashboard-ticker-track py-1.5 pl-3">
              {[...items, ...items].map((it, i) => (
                <span
                  key={`${it.key}-${i}`}
                  className="text-xs text-[var(--foreground-muted)]"
                >
                  <span className="font-medium text-[var(--foreground)]">{it.label}</span>{" "}
                  {formatClose(it.close)}{" "}
                  <span
                    className={
                      it.pct >= 0
                        ? "text-[var(--positive)]"
                        : "text-[var(--negative)]"
                    }
                  >
                    {formatPct(it.pct)}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            aria-label={
              paused ? "Reprendre le défilement du ticker" : "Mettre le ticker en pause"
            }
            data-testid="dashboard-ticker-pause"
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
              "text-[var(--foreground-muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] motion-reduce:transition-none"
            )}
          >
            {paused ? (
              <Play className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Pause className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </>
      ) : settled ? (
        /* Aucune série exploitable : on le dit, plutôt qu'un squelette perpétuel. */
        <p
          className="flex-1 py-2 pl-3 text-xs text-[var(--foreground-muted)]"
          data-testid="dashboard-ticker-empty"
        >
          Cotations de marché indisponibles pour le moment.
        </p>
      ) : (
        <p className="flex-1 py-2 pl-3 text-xs text-[var(--foreground-faint)]">
          Chargement des cotations…
        </p>
      )}

      <button
        type="button"
        onClick={toggleVisible}
        aria-label="Masquer le ticker marchés"
        data-testid="dashboard-ticker-hide"
        className={cn(
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)]",
          "text-[var(--foreground-muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]",
          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] motion-reduce:transition-none"
        )}
      >
        <ChevronUp className="h-3.5 w-3.5" aria-hidden />
      </button>
    </section>
  );
}
