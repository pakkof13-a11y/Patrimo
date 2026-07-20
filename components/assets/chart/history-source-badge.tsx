"use client";

import { cn } from "@/app/lib/utils";

export type HistorySource = "yahoo" | "db" | "coingecko" | "mock";

const SOURCE_META: Record<
  HistorySource,
  { label: string; title: string; className: string }
> = {
  yahoo: {
    label: "Yahoo",
    title: "Cours de marché (Yahoo Finance), convertis en EUR",
    className:
      "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-800",
  },
  coingecko: {
    label: "CoinGecko",
    title: "Historique crypto (CoinGecko), en EUR — aligné sur le pricing live",
    className:
      "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800",
  },
  db: {
    label: "Base locale",
    title: "Historique reconstitué depuis les snapshots prix en base",
    className:
      "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-200 dark:ring-violet-800",
  },
  mock: {
    label: "Estimé",
    title:
      "Série synthétique (pas de feed marché). Les niveaux peuvent être irréalistes — ne pas s'y fier pour la perf.",
    className:
      "bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950/60 dark:text-amber-100 dark:ring-amber-700",
  },
};

/**
 * Badge visible de la source des barres de cours (yahoo / db / mock).
 * Toujours affiché dès qu'une source est connue — surtout critique pour mock.
 */
export function HistorySourceBadge({
  source,
  barIntervalLabel: barLabel,
  extendedToFirstBuy,
  className,
}: {
  source?: HistorySource | string | null;
  barIntervalLabel?: string | null;
  extendedToFirstBuy?: boolean;
  className?: string;
}) {
  if (!source || !(source in SOURCE_META)) {
    return null;
  }
  const meta = SOURCE_META[source as HistorySource];

  return (
    <span
      className={cn(
        "inline-flex flex-wrap items-center gap-1 text-[10px]",
        className
      )}
      data-testid="history-source-badge"
      data-source={source}
    >
      {barLabel && (
        <span className="text-slate-400 dark:text-slate-500">· {barLabel}</span>
      )}
      <span
        className={cn(
          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ring-1 ring-inset",
          meta.className
        )}
        title={meta.title}
      >
        {meta.label}
      </span>
      {extendedToFirstBuy && (
        <span
          className="text-slate-400 dark:text-slate-500"
          title="Fenêtre de cours étendue jusqu'à la date du premier achat"
        >
          · depuis 1er achat
        </span>
      )}
    </span>
  );
}
