"use client";

import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatCurrency } from "@/app/lib/utils";
import type { SpotTotals } from "@/app/lib/crypto/spot-overview";

/**
 * Les quatre mesures de la poche comptant.
 *
 * L'ordre suit la question qu'on se pose en arrivant : ce que ça vaut, ce que
 * ça a fait aujourd'hui, ce que ça a fait depuis l'achat, ce que ça a coûté.
 *
 * Deux tuiles peuvent ne rien avoir à dire — la variation 24 h sans clôture de
 * la veille, la performance sans prix de revient. Elles affichent alors « — »
 * et expliquent pourquoi, plutôt qu'un « 0,00 % » qui se lirait « stable ».
 */

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

function formatSignedCurrency(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), "EUR")}`;
}

/** L'équivalent BTC se lit à quatre décimales : « ≈ 2,0854 BTC ». */
function formatBtc(v: number): string {
  return `≈ ${v.toLocaleString("fr-FR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  })} BTC`;
}

function KpiCard({
  label,
  value,
  secondary,
  tertiary,
  tone,
  spark,
  sparkStroke,
  reserveSpark,
  testId,
}: {
  label: string;
  value: string;
  secondary?: string;
  /** Ligne d'appoint sous la valeur — l'équivalent BTC, une explication. */
  tertiary?: string;
  tone?: "positive" | "negative" | "muted";
  spark?: number[];
  sparkStroke?: string;
  reserveSpark: boolean;
  testId: string;
}) {
  return (
    <article
      className="panel flex flex-col gap-[var(--space-2)] p-[var(--pad-card)]"
      data-testid={testId}
    >
      <h3 className="text-label truncate" title={label}>
        {label}
      </h3>

      <p
        className={cn(
          "num truncate text-[length:var(--text-xl)] font-semibold leading-none",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          (!tone || tone === "muted") && "text-[var(--foreground)]"
        )}
      >
        {value}
      </p>

      {tertiary && (
        <p className="num text-[length:var(--text-xs)] leading-none text-[var(--foreground-faint)]">
          {tertiary}
        </p>
      )}

      <p className="text-[length:var(--text-xs)] leading-none">
        {secondary ? (
          <span
            className={cn(
              "num",
              tone === "positive" && "val-positive",
              tone === "negative" && "val-negative",
              (!tone || tone === "muted") && "text-[var(--foreground-faint)]"
            )}
          >
            {secondary}
          </span>
        ) : (
          <span>&nbsp;</span>
        )}
      </p>

      <div
        className={cn(
          "mt-auto w-full",
          reserveSpark && "h-[1.75rem] pt-[var(--space-1)]"
        )}
      >
        {spark && spark.length >= 2 && (
          <Sparkline
            values={spark}
            stroke={sparkStroke ?? "var(--chart-gold)"}
            width={200}
            height={28}
            className="h-full w-full"
          />
        )}
      </div>
    </article>
  );
}

export function SpotKpiCards({
  totals,
  change24hPct,
  change24hCoveragePct,
  spark,
  className,
}: {
  totals: SpotTotals;
  /** Variation de la poche sur 24 h, `null` si trop peu de coins sont cotés. */
  change24hPct: number | null;
  change24hCoveragePct: number;
  /** Valeur de la poche jour par jour — la courbe de la première tuile. */
  spark?: number[];
  className?: string;
}) {
  const hasSpark = Boolean(spark && spark.length >= 2);
  const dayUp = (change24hPct ?? 0) >= 0;
  const pnlUp = totals.unrealizedPnlEur >= 0;
  const partial =
    change24hPct != null && change24hCoveragePct < 99.5;

  return (
    <div
      className={cn(
        "grid min-w-0 gap-[var(--gap-card)] grid-cols-2 xl:grid-cols-4",
        className
      )}
      data-testid="spot-kpi-cards"
    >
      <KpiCard
        testId="spotkpi-value"
        label="Valeur totale"
        value={formatCurrency(totals.totalValueEur, "EUR")}
        tertiary={
          totals.btcEquivalent != null
            ? formatBtc(totals.btcEquivalent)
            : undefined
        }
        secondary={`${totals.assetCount} actif${totals.assetCount > 1 ? "s" : ""} · ${totals.venueCount} plateforme${totals.venueCount > 1 ? "s" : ""}`}
        spark={spark}
        sparkStroke="var(--chart-gold)"
        reserveSpark={hasSpark}
      />

      <KpiCard
        testId="spotkpi-change24h"
        label="Performance (24 h)"
        value={change24hPct != null ? formatSignedPct(change24hPct) : "—"}
        secondary={
          change24hPct == null
            ? "Clôtures de la veille indisponibles"
            : partial
              ? `Sur ${Math.round(change24hCoveragePct)} % de la poche`
              : "D'une clôture à l'autre"
        }
        tone={change24hPct == null ? "muted" : dayUp ? "positive" : "negative"}
        reserveSpark={hasSpark}
      />

      <KpiCard
        testId="spotkpi-pnl"
        label="Gains non réalisés"
        value={formatSignedCurrency(totals.unrealizedPnlEur)}
        secondary={
          totals.unrealizedPnlPct != null
            ? formatSignedPct(totals.unrealizedPnlPct)
            : "Sans prix de revient, aucun pourcentage"
        }
        tone={
          totals.unrealizedPnlPct == null
            ? "muted"
            : pnlUp
              ? "positive"
              : "negative"
        }
        reserveSpark={hasSpark}
      />

      <KpiCard
        testId="spotkpi-invested"
        label="Investi total"
        value={formatCurrency(totals.costBasisEur, "EUR")}
        secondary="Depuis le début, frais inclus"
        reserveSpark={hasSpark}
      />
    </div>
  );
}
