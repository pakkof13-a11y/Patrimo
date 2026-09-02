"use client";

import { AssetLogo, PlatformLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { cn, formatCurrency, formatQuantity } from "@/app/lib/utils";
import type { AssetRow } from "@/app/lib/crypto/spot-overview";

/**
 * Carte d'un actif de la poche comptant.
 *
 * Préférée au tableau tant que le portefeuille compte peu de lignes : sur dix
 * positions, une grille de nombres se lit moins bien que dix objets qui portent
 * chacun leur logo, leur courbe et leur poids. Passé le seuil, l'avantage
 * s'inverse et la vue tableau reprend la main (voir `defaultAssetView`).
 *
 * L'indicateur de concentration n'est pas un conseil : il nomme une situation
 * — « cette ligne pèse plus de la moitié de la poche » — et s'arrête là.
 */

const CONCENTRATION_TONE = {
  high: "bg-[var(--chart-gold)]/12 text-[var(--warning)]",
  moderate: "bg-[var(--surface-raised)] text-[var(--foreground-secondary)]",
  low: "bg-[var(--surface-raised)] text-[var(--foreground-faint)]",
} as const;

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

function formatSignedCurrency(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), "EUR")}`;
}

export function SpotAssetCard({
  row,
  baseCurrency = "EUR",
  onOpen,
}: {
  row: AssetRow;
  baseCurrency?: string;
  /** Ouvre le détail — les opérations de la ligne, dans Portefeuille. */
  onOpen?: () => void;
}) {
  const { card, concentration } = row;
  const dayUp = (row.change24hPct ?? 0) >= 0;
  const pnlUp = card.unrealizedPnlEur >= 0;

  return (
    <article
      className="panel panel--interactive relative flex min-w-0 flex-col gap-[var(--space-3)] p-[var(--pad-card)]"
      data-testid={`spot-asset-card-${card.symbol}`}
    >
      {/* ── Identité ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 items-center gap-[var(--space-3)]">
        <AssetLogo
          src={card.logoUrl}
          name={card.name}
          ticker={card.symbol}
          assetClass="CRYPTO"
          size={36}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {/*
              Lien étiré : la carte entière devient cliquable sans envelopper
              son contenu dans un <button>, ce qui produirait du HTML invalide
              (listes et titres n'ont rien à faire dans un bouton).
            */}
            {onOpen ? (
              <button
                type="button"
                onClick={onOpen}
                className="after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
                data-testid={`spot-asset-open-${card.symbol}`}
              >
                {card.name}
              </button>
            ) : (
              card.name
            )}
          </h3>
          <p className="text-meta truncate">{card.symbol}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-[var(--radius-sm)] px-[var(--space-2)] py-[0.15rem] text-[length:var(--text-2xs)]",
            CONCENTRATION_TONE[concentration.level]
          )}
          title={`${concentration.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de la poche`}
        >
          {concentration.label}
        </span>
      </div>

      {/* ── Valeur et quantité ───────────────────────────────────── */}
      <div className="flex items-end justify-between gap-[var(--space-3)]">
        <div className="min-w-0">
          <p className="num truncate text-[length:var(--text-lg)] font-semibold leading-none text-[var(--foreground)]">
            {formatCurrency(card.marketValueEur, baseCurrency)}
          </p>
          <p className="num text-meta mt-[var(--space-1)]">
            {formatQuantity(card.quantity)} {card.symbol}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p
            className={cn(
              "num text-[length:var(--text-sm)] font-medium leading-none",
              row.change24hPct == null
                ? "text-[var(--foreground-faint)]"
                : dayUp
                  ? "val-positive"
                  : "val-negative"
            )}
          >
            {row.change24hPct != null ? formatSignedPct(row.change24hPct) : "—"}
          </p>
          <p className="text-meta mt-[var(--space-1)]">24 h</p>
        </div>
      </div>

      {/* ── Courbe 30 jours ──────────────────────────────────────── */}
      <div className="h-[2.25rem] w-full">
        {row.spark.length >= 2 ? (
          <Sparkline
            values={row.spark}
            stroke={dayUp ? "var(--chart-positive)" : "var(--chart-negative)"}
            width={240}
            height={36}
            className="h-full w-full"
          />
        ) : (
          <p className="text-meta flex h-full items-center">
            Pas d&apos;historique de cours pour ce coin
          </p>
        )}
      </div>

      {/* ── Poids dans la poche ──────────────────────────────────── */}
      <div className="flex items-center gap-[var(--space-2)]">
        <div
          className="h-[0.3rem] flex-1 overflow-hidden rounded-full bg-[var(--surface-raised)]"
          role="img"
          aria-label={`${card.allocationPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} % de la poche`}
        >
          <div
            className="h-full rounded-full bg-[var(--chart-gold)]"
            style={{ width: `${Math.min(100, card.allocationPct)}%` }}
          />
        </div>
        <span className="num shrink-0 text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
          {card.allocationPct.toLocaleString("fr-FR", {
            maximumFractionDigits: 1,
          })}{" "}
          %
        </span>
      </div>

      {/* ── P&L latent et plateformes ────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-t border-[var(--border)] pt-[var(--space-2)]">
        <p
          className={cn(
            "num text-[length:var(--text-xs)]",
            pnlUp ? "val-positive" : "val-negative"
          )}
        >
          {formatSignedCurrency(card.unrealizedPnlEur)}
          {card.unrealizedPnlPct != null && (
            <span className="text-[var(--foreground-faint)]">
              {" "}
              ({formatSignedPct(card.unrealizedPnlPct)})
            </span>
          )}
        </p>

        <div
          className="flex flex-wrap items-center gap-[var(--space-1)]"
          data-testid={`spot-asset-venues-${card.symbol}`}
        >
          {card.venues.map((v) => (
            <span
              key={v.platformId}
              title={`${v.platformName} · ${formatQuantity(v.quantity)} ${card.symbol}`}
            >
              <PlatformLogo
                src={v.platformLogoUrl}
                name={v.platformName}
                size={14}
              />
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
