"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Coins,
  LayoutGrid,
  PieChart as PieIcon,
  Receipt,
  Star,
  type LucideIcon,
} from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { AssetLogo } from "@/components/ui/platform-logo";
import { formatCurrency, cn } from "@/app/lib/utils";
import type { Holding } from "@/app/lib/types/ui";
import {
  allocatePercents,
  capTinyHoldings,
} from "@/app/lib/ui/allocate-percents";
import { squarify } from "@/app/lib/ui/squarify";
import { SegmentedControl, SegmentedItem } from "@/components/ui/panel";
import type { EvolutionRange } from "@/app/lib/portfolio/evolution-aggregate";

/**
 * Logos du tableau de bord.
 *
 * Plus petits que dans Portefeuille (28 px) : ici le logo sert à reconnaître
 * une ligne d'un coup d'œil au milieu d'un écran dense, pas à identifier une
 * position qu'on s'apprête à ouvrir. Au-delà, il prendrait le pas sur les
 * chiffres, qui sont le sujet de ces deux panneaux.
 */
const DASHBOARD_LOGO_SIZE = 18;

/* ══════════════════════════════════════════════════════════════════════════
   RÉPARTITION DU PORTEFEUILLE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Teintes catégorielles de l'allocation.
 *
 * Deux règles, toutes deux structurelles :
 *
 * 1. **La couleur suit la classe, jamais son rang de taille.** Colorier par
 *    ordre décroissant fait changer une classe de teinte dès qu'elle en
 *    dépasse une autre : l'immobilier n'est plus reconnaissable d'une session
 *    à la suivante.
 * 2. **Aucun rouge.** Il porte la perte partout ailleurs ; une part de
 *    patrimoine en rouge se lirait comme une position en moins-value.
 *
 * Les classes connues ont une teinte fixe et deux à deux distinctes — un
 * simple hachage produisait des collisions et rendait la moitié du camembert
 * grise, donc illisible.
 */
const ALLOCATION_TONES = [
  "var(--chart-gold)",
  "var(--chart-cyan)",
  "var(--chart-positive)",
  "var(--gold-deep)",
  "var(--chart-neutral)",
  "var(--cyan-ink-light)",
] as const;

/** Libellés produits par `getAssetClassLabel` → teinte réservée. */
const TONE_BY_CLASS: Record<string, string> = {
  "Actions / ETF": "var(--chart-gold)",
  Immobilier: "var(--chart-cyan)",
  Cryptomonnaies: "var(--gold-deep)",
  Obligations: "var(--chart-positive)",
  "Liquidités / Cash": "var(--chart-neutral)",
  Autre: "var(--cyan-ink-light)",
};

export function allocationTone(label: string): string {
  const fixed = TONE_BY_CLASS[label];
  if (fixed) return fixed;
  // Libellé inconnu (plateforme saisie à la main) : hachage déterministe,
  // pour que la même chaîne garde sa couleur d'une session à l'autre.
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  }
  return ALLOCATION_TONES[hash % ALLOCATION_TONES.length]!;
}

function formatPct1(v: number): string {
  return `${v.toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/**
 * Teinte Coin360 : aire = MV, couleur = performance (vert / rouge).
 *
 * L'intensité suit l'amplitude, plafonnée : +2 % et +80 % doivent se
 * distinguer, sans qu'une tuile disparaisse dans un vert saturé.
 */
export function perfTone(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct === 0) {
    return "var(--chart-neutral)";
  }
  const token = pct > 0 ? "var(--chart-positive)" : "var(--chart-negative)";
  const intensity = Math.min(100, Math.max(32, Math.round(Math.abs(pct) * 2.4)));
  return `color-mix(in srgb, ${token} ${intensity}%, var(--surface-raised))`;
}

function holdingValue(h: Holding): number {
  const v = Number(h.marketValueBase ?? h.marketValueEur);
  return Number.isFinite(v) ? v : 0;
}

function holdingPerf(h: Holding): number | null {
  const v = Number(h.unrealizedPnlPct);
  return Number.isFinite(v) ? v : null;
}

export function AllocationCard({
  data,
  holdings,
  periodRange,
  baseCurrency,
  className,
  title = "Répartition du portefeuille",
  subtitle,
  showValues = false,
  emptyHint = "Les classes d'actifs apparaîtront dès le premier achat.",
  testId = "allocation-card",
  toneOf = allocationTone,
  compact = false,
}: {
  data: { name: string; value: number }[];
  /**
   * Lignes détenues — mosaïque Coin360 (aire ∝ MV). Absentes, le second
   * mode n'est pas proposé : le camembert de classes reste seul.
   */
  holdings?: Holding[];
  /**
   * Période partagée du tableau de bord. La mosaïque colore chaque ligne
   * par son P&L latent (coût → maintenant) : le moteur ne publie pas de
   * rendement fenêtré par ligne, et en inventer un serait une autre
   * grandeur. La période reste celle des KPI / de l'évolution.
   */
  periodRange?: EvolutionRange;
  baseCurrency: string;
  className?: string;
  /** Le même camembert sert le tableau de bord et la vue PEA & CTO. */
  title?: string;
  subtitle?: string;
  /** Ajoute le montant à côté du pourcentage dans la légende. */
  showValues?: boolean;
  emptyHint?: string;
  testId?: string;
  /**
   * Teinte d'une part. Le tableau de bord répartit par classe d'actifs, la vue
   * PEA & CTO par sous-catégorie : deux vocabulaires, donc deux palettes, mais
   * un seul camembert.
   */
  toneOf?: (label: string) => string;
  /** Anneau resserré : la légende porte alors les montants sans se faire rogner. */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"pie" | "treemap">("pie");

  const rows = useMemo(() => {
    const positive = data.filter((d) => d.value > 0);
    const sorted = [...positive].sort((a, b) => b.value - a.value);
    const pcts = allocatePercents(sorted.map((d) => d.value), 1);
    return sorted.map((d, i) => ({
      ...d,
      pct: pcts[i] ?? 0,
      tone: toneOf(d.name),
    }));
  }, [data, toneOf]);

  const mosaic = useMemo(() => {
    if (!holdings?.length) return [];
    const items = capTinyHoldings(
      holdings
        .filter((h) => holdingValue(h) > 0)
        .map((h) => ({
          name: h.name,
          value: holdingValue(h),
          perfPct: holdingPerf(h),
        })),
      { minShare: 0.01, otherLabel: "Autres" }
    );
    const pcts = allocatePercents(items.map((it) => it.value), 1);
    const labeled = items.map((it, i) => ({
      ...it,
      pct: pcts[i] ?? 0,
      color:
        it.name === "Autres"
          ? "var(--chart-neutral)"
          : perfTone(it.perfPct),
    }));
    return squarify(labeled);
  }, [holdings]);

  const canTreemap = mosaic.length > 0;

  return (
    <section
      className={cn("panel", className)}
      data-testid={testId}
      aria-labelledby="allocation-heading"
    >
      <div className="panel-head">
        <div className="min-w-0">
          <h3 id="allocation-heading" className="text-title">
            {title}
          </h3>
          {subtitle && <p className="text-meta">{subtitle}</p>}
        </div>
        {canTreemap && (
          <SegmentedControl
            aria-label="Mode de répartition"
            testId="allocation-mode"
          >
            <SegmentedItem
              selected={mode === "pie"}
              testId="allocation-mode-pie"
              onClick={() => setMode("pie")}
            >
              <PieIcon className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only">Camembert</span>
            </SegmentedItem>
            <SegmentedItem
              selected={mode === "treemap"}
              testId="allocation-mode-treemap"
              onClick={() => setMode("treemap")}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only">Mosaïque</span>
            </SegmentedItem>
          </SegmentedControl>
        )}
      </div>

      <div className="panel-body" data-period={periodRange}>
        {rows.length === 0 && mosaic.length === 0 ? (
          <p className="text-meta py-[var(--space-6)] text-center">
            {emptyHint}
          </p>
        ) : mode === "treemap" && mosaic.length > 0 ? (
          <div
            className="relative h-44 w-full overflow-hidden rounded-[var(--radius-md)] bg-[var(--surface-sunken)] sm:h-48"
            data-testid="allocation-treemap"
            role="img"
            aria-label={mosaic
              .map(
                (t) =>
                  `${t.name} : ${formatPct1(t.pct)}, ${formatCurrency(t.value, baseCurrency)}`
              )
              .join(". ")}
          >
            {mosaic.map((t) => {
              const showName = t.h * 192 >= 16 && t.w * 260 >= 40;
              const showPct = t.h * 192 >= 22 && t.w * 260 >= 48;
              return (
                <div
                  key={t.name}
                  title={`${t.name} · ${formatPct1(t.pct)} · ${formatCurrency(t.value, baseCurrency)}`}
                  className="absolute box-border overflow-hidden px-1.5 py-1 text-[var(--background)]"
                  style={{
                    left: `${t.x * 100}%`,
                    top: `${t.y * 100}%`,
                    width: `${t.w * 100}%`,
                    height: `${t.h * 100}%`,
                    backgroundColor: t.color,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.35)",
                  }}
                >
                  {showName && (
                    <div className="truncate text-[length:var(--text-2xs)] font-semibold leading-tight">
                      {t.name}
                    </div>
                  )}
                  {showPct && (
                    <div className="num text-[length:var(--text-xs)] font-semibold leading-none">
                      {formatPct1(t.pct)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className={cn(
              "flex items-center",
              compact ? "gap-[var(--space-3)]" : "gap-[var(--space-5)]"
            )}
          >
            <div
              className={cn(
                "shrink-0",
                compact ? "h-[5.5rem] w-[5.5rem]" : "h-[7.5rem] w-[7.5rem]"
              )}
            >
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rows}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius="100%"
                    innerRadius="62%"
                    paddingAngle={1.5}
                    stroke="none"
                    animationDuration={0}
                  >
                    {rows.map((r) => (
                      <Cell key={r.name} fill={r.tone} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/*
              Légende porteuse des valeurs, et non simple clé de couleurs :
              c'est elle qui rend le camembert lisible sans survol — donc
              utilisable au doigt et au lecteur d'écran.
            */}
            <ul className="min-w-0 flex-1 space-y-[var(--space-2)]">
              {rows.map((r) => (
                <li
                  key={r.name}
                  className="flex items-baseline gap-[var(--space-2)] text-[length:var(--text-sm)]"
                >
                  <span
                    className="h-[0.5rem] w-[0.5rem] shrink-0 translate-y-[-1px] rounded-[var(--radius-xs)]"
                    style={{ backgroundColor: r.tone }}
                    aria-hidden
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[var(--foreground-secondary)]"
                    title={r.name}
                  >
                    {r.name}
                  </span>
                  {/* `%` et montant ne rétrécissent pas : ce sont les faits.
                      Seul le libellé s'abrège, et son `title` le rend entier. */}
                  <span className="num shrink-0 text-[var(--foreground)]">
                    {formatPct1(r.pct)}
                  </span>
                  {showValues && (
                    <span className="num shrink-0 text-right text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                      {formatCurrency(r.value, baseCurrency)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {rows.length > 0 && mode !== "treemap" && (
          <p className="sr-only">
            {rows
              .map(
                (r) =>
                  `${r.name} : ${formatPct1(r.pct)}, ${formatCurrency(
                    r.value,
                    baseCurrency
                  )}`
              )
              .join(". ")}
          </p>
        )}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   WATCHLIST
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Watchlist — les lignes que l'utilisateur a explicitement épinglées.
 *
 * Elle affichait auparavant les positions de plus gros poids. C'était une
 * approximation commode, mais elle répondait à « qu'est-ce qui pèse ? » et non
 * à « qu'est-ce que je surveille en ce moment ? » — or une ligne modeste peut
 * être précisément celle qu'on regarde tous les matins. L'étoile de la fiche
 * d'un actif alimente désormais cette liste.
 *
 * Pas de sparkline par ligne, contrairement au mockup : l'historique de cours
 * par actif n'est pas chargé sur cet écran, et une diagonale tracée entre 0 et
 * la variation courante aurait l'apparence d'une tendance sans en être une.
 * Mieux vaut la colonne absente qu'une courbe qui ment.
 */
export function WatchlistCard({
  holdings,
  limit = 5,
  className,
  onOpenPositions,
  onUnwatch,
}: {
  holdings: Holding[];
  limit?: number;
  className?: string;
  onOpenPositions?: () => void;
  /**
   * Retire la ligne de la watchlist.
   *
   * Épingler se faisait depuis la fiche d'un actif, dépingler aussi — il
   * fallait donc rouvrir la fiche d'une ligne qu'on ne voulait justement plus
   * suivre. La liste se défait ici, là où elle se lit.
   */
  onUnwatch?: (assetId: string) => void;
}) {
  const rows = useMemo(
    () =>
      // `filter` rend déjà un tableau neuf : le trier sur place ne touche pas
      // la liste d'origine, et la copie préalable des centaines de positions
      // n'avait plus lieu d'être.
      holdings
        .filter((h) => h.watchlisted)
        .sort((a, b) => Number(b.marketValueBase) - Number(a.marketValueBase))
        .slice(0, limit),
    [holdings, limit]
  );

  return (
    <section
      className={cn("panel", className)}
      data-testid="watchlist-card"
      aria-labelledby="watchlist-heading"
    >
      <div className="panel-head">
        <h3 id="watchlist-heading" className="text-title">
          Watchlist
        </h3>
      </div>

      <div className="panel-body">
        {rows.length === 0 ? (
          /* L'état vide dit comment le remplir : sans cela, une carte vide se
             lit comme une panne plutôt que comme une liste à composer. */
          <p
            className="text-meta py-[var(--space-5)] text-center"
            data-testid="watchlist-empty"
          >
            Aucun actif suivi. Ouvrez une ligne du portefeuille et cliquez
            l&apos;étoile pour l&apos;épingler ici.
          </p>
        ) : (
          <table className="term-table">
            <thead>
              <tr>
                <th scope="col">Actif</th>
                <th scope="col" className="col-num">
                  Cours
                </th>
                <th scope="col" className="col-num">
                  Var.
                </th>
                {onUnwatch && (
                  <th scope="col" className="w-[1.75rem]">
                    <span className="sr-only">Retirer du suivi</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const pct = Number(h.unrealizedPnlPct);
                const known = Number.isFinite(pct);
                const up = known && pct >= 0;
                return (
                  <tr key={h.assetId} data-testid={`watchlist-${h.assetId}`}>
                    <td>
                      <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                        <AssetLogo
                          src={h.assetLogoUrl || h.logoUrl}
                          name={h.name}
                          ticker={h.ticker}
                          isin={h.isin}
                          assetClass={h.assetClass}
                          size={DASHBOARD_LOGO_SIZE}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-[length:var(--text-sm)] text-[var(--foreground)]">
                            {h.name}
                          </div>
                          <div className="num truncate text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                            {h.ticker || h.assetClass}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="col-num text-[var(--foreground)]">
                      {formatCurrency(h.currentPriceEur, h.currency)}
                    </td>
                    <td
                      className={cn(
                        "col-num",
                        !known
                          ? "val-neutral"
                          : up
                            ? "val-positive"
                            : "val-negative"
                      )}
                    >
                      {known
                        ? `${up ? "+" : "−"}${Math.abs(pct).toFixed(1)} %`
                        : "—"}
                    </td>
                    {onUnwatch && (
                      <td>
                        <button
                          type="button"
                          onClick={() => onUnwatch(h.assetId)}
                          data-testid={`watchlist-unpin-${h.assetId}`}
                          title={`Retirer ${h.name} de la watchlist`}
                          aria-label={`Retirer ${h.name} de la watchlist`}
                          className={cn(
                            "flex h-[1.25rem] w-[1.25rem] items-center justify-center",
                            "rounded-[var(--radius-xs)] text-[var(--warning)]",
                            "transition-colors duration-[var(--duration-fast)]",
                            "hover:bg-[var(--surface-hover)]",
                            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                          )}
                        >
                          <Star size={12} fill="currentColor" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {onOpenPositions && rows.length > 0 && (
          <button
            type="button"
            onClick={onOpenPositions}
            data-testid="watchlist-see-all"
            className={cn(
              "mt-[var(--space-3)] text-[length:var(--text-xs)] font-medium",
              "text-[var(--primary-text)] transition-colors duration-[var(--duration-fast)]",
              "hover:text-[var(--foreground)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            )}
          >
            Voir tout le portefeuille →
          </button>
        )}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   ACTIVITÉ RÉCENTE
   ══════════════════════════════════════════════════════════════════════════ */

type TxRow = {
  id: string;
  type: string;
  occurredAt: string;
  quantity: string | number | null;
  unitPrice: string | number | null;
  grossAmountEur: string | number | null;
  netCashImpactEur: string | number | null;
  currency: string | null;
  asset: {
    name: string | null;
    ticker: string | null;
    isin?: string | null;
    assetClass?: string | null;
    logoUrl?: string | null;
  } | null;
};

/**
 * Type d'opération → libellé, icône, teinte. Table unique, pas de `switch`.
 *
 * ## Le sens des flèches
 *
 * Achat vers le haut, vente vers le bas : la lecture est celle de la
 * **position**, pas celle de la trésorerie. Un achat fait entrer une ligne au
 * portefeuille, une vente l'en fait sortir — c'est ce que l'œil cherche dans
 * un journal d'activité. Les deux icônes étaient inversées, parce qu'elles
 * décrivaient le mouvement du cash.
 *
 * ## Le sens des couleurs
 *
 * Vert et rouge disent un **sens** — ce qui entre, ce qui sort. Orange, cyan
 * et violet distinguent des **natures** de revenu, qui n'ont pas de sens
 * opposé : un dividende, un loyer et un coupon sont trois façons différentes
 * d'encaisser. Les leur donner des teintes distinctes rend le journal lisible
 * d'un coup d'œil sans rien affirmer sur leur signe.
 *
 * La couleur ne porte jamais seule l'information : le libellé reste affiché.
 */
const TX_PRESENTATION: Record<
  string,
  { label: string; icon: LucideIcon; tone: string }
> = {
  ACHAT: { label: "Achat", icon: ArrowUpRight, tone: "val-positive" },
  VENTE: { label: "Vente", icon: ArrowDownLeft, tone: "val-negative" },
  DIVIDENDE: { label: "Dividende", icon: Coins, tone: "val-warning" },
  LOYER: { label: "Loyer", icon: Coins, tone: "val-info" },
  COUPON: { label: "Coupon", icon: Coins, tone: "val-accent" },
  INTERET: { label: "Intérêts", icon: Coins, tone: "val-positive" },
  REWARD: { label: "Récompense", icon: Coins, tone: "val-positive" },
  AIRDROP: { label: "Airdrop", icon: Coins, tone: "val-positive" },
  FRAIS: { label: "Frais", icon: Receipt, tone: "val-negative" },
  DEPOT: { label: "Dépôt", icon: ArrowDownLeft, tone: "val-positive" },
  RETRAIT: { label: "Retrait", icon: ArrowUpRight, tone: "val-negative" },
  TRANSFERT: { label: "Transfert", icon: ArrowLeftRight, tone: "val-neutral" },
};

function presentTx(type: string) {
  return (
    TX_PRESENTATION[type] ?? {
      label: type.charAt(0) + type.slice(1).toLowerCase(),
      icon: ArrowLeftRight,
      tone: "val-neutral",
    }
  );
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) return "Aujourd'hui";
  const yesterday = new Date(today.getTime() - 864e5);
  if (d.toDateString() === yesterday.toDateString()) return "Hier";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
  }).format(d);
}

function formatQty(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "—";
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 8 });
}

export function RecentActivityCard({
  baseCurrency,
  limit = 6,
  className,
  onOpenJournal,
}: {
  baseCurrency: string;
  limit?: number;
  className?: string;
  onOpenJournal?: () => void;
}) {
  const q = useQuery({
    queryKey: ["recent-activity", limit],
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<{ transactions: TxRow[] }>(
        `/api/transactions?page=1&pageSize=${limit}&sort=occurredAt&dir=desc`
      ),
  });

  const rows = q.data?.transactions ?? [];

  return (
    <section
      className={cn("panel", className)}
      data-testid="recent-activity-card"
      aria-labelledby="activity-heading"
    >
      <div className="panel-head">
        <h3 id="activity-heading" className="text-title">
          Activité récente
        </h3>
        {onOpenJournal && (
          <button
            type="button"
            onClick={onOpenJournal}
            data-testid="activity-see-all"
            className={cn(
              "shrink-0 text-[length:var(--text-xs)] font-medium",
              "text-[var(--primary-text)] transition-colors duration-[var(--duration-fast)]",
              "hover:text-[var(--foreground)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            )}
          >
            Voir le journal →
          </button>
        )}
      </div>

      <div className="panel-body">
        {q.isLoading ? (
          <p className="text-meta py-[var(--space-5)] text-center" aria-busy>
            Chargement des opérations…
          </p>
        ) : q.isError ? (
          <p className="py-[var(--space-5)] text-center text-[length:var(--text-sm)] text-[var(--warning)]">
            Opérations momentanément indisponibles.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-meta py-[var(--space-5)] text-center">
            Aucune opération enregistrée.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="term-table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Actif</th>
                  <th scope="col" className="col-num">
                    Qté
                  </th>
                  <th scope="col" className="col-num">
                    Prix
                  </th>
                  <th scope="col" className="col-num">
                    Montant
                  </th>
                  <th scope="col" className="col-num">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => {
                  const p = presentTx(tx.type);
                  const Icon = p.icon;
                  const amount = Number(
                    tx.grossAmountEur ?? tx.netCashImpactEur ?? 0
                  );
                  return (
                    <tr key={tx.id} data-testid={`activity-${tx.id}`}>
                      <td>
                        <span className="flex items-center gap-[var(--space-2)]">
                          <Icon
                            className={cn("h-[0.875rem] w-[0.875rem]", p.tone)}
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          {/*
                            La teinte porte sur le **libellé**, pas seulement
                            sur l'icône : c'est le mot que l'œil lit, et une
                            pastille colorée à côté d'un texte gris se remarque
                            moins qu'un mot coloré. Le libellé reste écrit —
                            la couleur ne porte jamais l'information seule.
                          */}
                          <span
                            className={p.tone}
                            data-testid={`activity-type-${tx.type}`}
                          >
                            {p.label}
                          </span>
                        </span>
                      </td>
                      <td className="max-w-[12rem]">
                        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                          {tx.asset && (
                            <AssetLogo
                              src={tx.asset.logoUrl}
                              name={tx.asset.name || tx.asset.ticker || "?"}
                              ticker={tx.asset.ticker}
                              isin={tx.asset.isin}
                              assetClass={tx.asset.assetClass}
                              size={DASHBOARD_LOGO_SIZE}
                            />
                          )}
                          <span className="truncate text-[var(--foreground)]">
                            {tx.asset?.name || tx.asset?.ticker || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="col-num text-[var(--foreground-secondary)]">
                        {formatQty(tx.quantity)}
                      </td>
                      <td className="col-num text-[var(--foreground-secondary)]">
                        {Number(tx.unitPrice) > 0
                          ? formatCurrency(
                              Number(tx.unitPrice),
                              tx.currency || baseCurrency
                            )
                          : "—"}
                      </td>
                      <td className="col-num text-[var(--foreground)]">
                        {amount !== 0
                          ? formatCurrency(amount, baseCurrency)
                          : "—"}
                      </td>
                      <td className="col-num text-[var(--foreground-faint)]">
                        {formatDay(tx.occurredAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
