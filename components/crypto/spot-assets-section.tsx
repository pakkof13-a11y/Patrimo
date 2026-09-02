"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Rows3, Search } from "lucide-react";
import { AssetLogo } from "@/components/ui/platform-logo";
import { Sparkline } from "@/components/ui/sparkline";
import { SpotAssetCard } from "@/components/crypto/spot-asset-card";
import { cn, formatCurrency, formatQuantity } from "@/app/lib/utils";
import {
  defaultAssetView,
  type AssetRow,
} from "@/app/lib/crypto/spot-overview";

/**
 * « Mes actifs » — le détail de la poche, en cartes ou en tableau.
 *
 * La vue par défaut dépend du nombre de lignes : en cartes tant que le
 * portefeuille se compte sur les doigts, en tableau au-delà (`defaultAssetView`).
 * Le choix reste celui de l'utilisateur — la bascule est là, et une fois qu'il
 * l'a touchée, l'écran ne revient plus sur sa décision.
 *
 * Ce tableau ne remplace pas Portefeuille : là-bas chaque ligne est un couple
 * actif × plateforme, avec son PRU et ses lots fiscaux. Ici les jambes sont
 * consolidées par coin, et la question posée est celle du poids dans la poche.
 */

type View = "cards" | "table";

function formatSignedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

function formatSignedCurrency(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), "EUR")}`;
}

export function SpotAssetsSection({
  rows,
  baseCurrency = "EUR",
  onOpenAsset,
  loading,
  className,
}: {
  rows: AssetRow[];
  baseCurrency?: string;
  onOpenAsset?: (symbol: string) => void;
  loading?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>(() => defaultAssetView(rows.length));
  const [chosen, setChosen] = useState(false);
  const [seenCount, setSeenCount] = useState(rows.length);

  /*
    Tant que l'utilisateur n'a pas tranché, la vue suit la taille du
    portefeuille : une position ajoutée peut faire franchir le seuil, et rester
    en cartes deviendrait un mur. Dès qu'il a choisi, on ne le contredit plus.

    Le recalage se fait pendant le rendu, et non dans un effet : React redémarre
    alors le rendu avec le bon état avant de peindre, là où un effet aurait
    d'abord affiché la mauvaise vue puis l'aurait remplacée.
  */
  if (rows.length !== seenCount) {
    setSeenCount(rows.length);
    if (!chosen) setView(defaultAssetView(rows.length));
  }

  function choose(next: View) {
    setChosen(true);
    setView(next);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.card.symbol.toLowerCase().includes(q) ||
        r.card.name.toLowerCase().includes(q)
    );
  }, [rows, query]);

  return (
    <section className={cn("min-w-0", className)} data-testid="spot-assets">
      <div className="mb-[var(--space-3)] flex flex-wrap items-center justify-between gap-[var(--space-3)]">
        <h2 className="text-title">Mes actifs</h2>

        <div className="flex flex-wrap items-center gap-[var(--space-2)]">
          <label className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-[var(--space-2)] h-3.5 w-3.5 text-[var(--foreground-faint)]"
              aria-hidden
            />
            <span className="sr-only">Rechercher un actif</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un actif…"
              data-testid="spot-asset-search"
              className="h-[1.9rem] w-[12rem] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-raised)] pl-[calc(var(--space-2)*2+0.875rem)] pr-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground)] placeholder:text-[var(--foreground-faint)]"
            />
          </label>

          <div className="term-seg" role="group" aria-label="Affichage des actifs">
            <button
              type="button"
              className="term-seg-item"
              data-active={view === "cards" ? "true" : "false"}
              aria-pressed={view === "cards"}
              data-testid="spot-view-cards"
              onClick={() => choose("cards")}
            >
              <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">Cartes</span>
            </button>
            <button
              type="button"
              className="term-seg-item"
              data-active={view === "table" ? "true" : "false"}
              aria-pressed={view === "table"}
              data-testid="spot-view-table"
              onClick={() => choose("table")}
            >
              <Rows3 className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only sm:not-sr-only">Tableau</span>
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-[var(--gap-card)] lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="panel h-[14rem] animate-pulse" aria-busy="true" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="panel p-[var(--pad-card)]" data-testid="spot-no-asset">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucune crypto en comptant
          </p>
          <p className="text-meta mt-[var(--space-1)]">
            Les soldes détenus sur un exchange ou en auto-conservation
            apparaîtront ici, consolidés par coin. Saisissez un achat depuis
            Opérations, importez un relevé CSV, ou synchronisez un wallet depuis
            vos plateformes.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel p-[var(--pad-card)]" data-testid="spot-search-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun actif ne correspond à « {query} »
          </p>
        </div>
      ) : view === "cards" ? (
        <div
          className="grid min-w-0 gap-[var(--gap-card)] sm:grid-cols-2 2xl:grid-cols-3"
          data-testid="spot-asset-cards"
        >
          {filtered.map((row) => (
            <SpotAssetCard
              key={row.card.symbol}
              row={row}
              baseCurrency={baseCurrency}
              onOpen={
                onOpenAsset ? () => onOpenAsset(row.card.symbol) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <div className="panel overflow-x-auto" data-testid="spot-asset-table">
          <table className="w-full min-w-[52rem] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-left">
                  Actif
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  Quantité
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  PRU
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  Cours
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  Valeur
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  Poids
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  30 jours
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  24 h
                </th>
                <th className="text-label px-[var(--space-3)] py-[var(--space-2)] text-right">
                  Gains / Pertes
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const c = row.card;
                const dayUp = (row.change24hPct ?? 0) >= 0;
                const pnlUp = c.unrealizedPnlEur >= 0;
                return (
                  <tr
                    key={c.symbol}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-raised)]"
                    data-testid={`spot-asset-row-${c.symbol}`}
                  >
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                        <AssetLogo
                          src={c.logoUrl}
                          name={c.name}
                          ticker={c.symbol}
                          assetClass="CRYPTO"
                          size={24}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                            {onOpenAsset ? (
                              <button
                                type="button"
                                className="hover:underline"
                                onClick={() => onOpenAsset(c.symbol)}
                                data-testid={`spot-asset-open-row-${c.symbol}`}
                              >
                                {c.name}
                              </button>
                            ) : (
                              c.name
                            )}
                          </span>
                          <span className="text-meta block">{c.symbol}</span>
                        </span>
                      </div>
                    </td>
                    <td className="num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-xs)]">
                      {formatQuantity(c.quantity)}
                    </td>
                    <td className="num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-xs)]">
                      {c.avgCostEur != null
                        ? formatCurrency(c.avgCostEur, baseCurrency)
                        : "—"}
                    </td>
                    <td className="num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-xs)]">
                      {c.currentPriceEur != null
                        ? formatCurrency(c.currentPriceEur, baseCurrency)
                        : "—"}
                    </td>
                    <td className="num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                      {formatCurrency(c.marketValueEur, baseCurrency)}
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="flex items-center justify-end gap-[var(--space-2)]">
                        <div className="h-[0.3rem] w-[3.5rem] overflow-hidden rounded-full bg-[var(--surface-raised)]">
                          <div
                            className="h-full rounded-full bg-[var(--chart-gold)]"
                            style={{
                              width: `${Math.min(100, c.allocationPct)}%`,
                            }}
                          />
                        </div>
                        <span className="num text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                          {c.allocationPct.toLocaleString("fr-FR", {
                            maximumFractionDigits: 1,
                          })}{" "}
                          %
                        </span>
                      </div>
                    </td>
                    <td className="px-[var(--space-3)] py-[var(--space-2)]">
                      <div className="ml-auto h-[1.5rem] w-[5rem]">
                        {row.spark.length >= 2 && (
                          <Sparkline
                            values={row.spark}
                            stroke={
                              dayUp
                                ? "var(--chart-positive)"
                                : "var(--chart-negative)"
                            }
                            width={80}
                            height={24}
                            className="h-full w-full"
                          />
                        )}
                      </div>
                    </td>
                    <td
                      className={cn(
                        "num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-xs)]",
                        row.change24hPct == null
                          ? "text-[var(--foreground-faint)]"
                          : dayUp
                            ? "val-positive"
                            : "val-negative"
                      )}
                    >
                      {row.change24hPct != null
                        ? formatSignedPct(row.change24hPct)
                        : "—"}
                    </td>
                    <td
                      className={cn(
                        "num px-[var(--space-3)] py-[var(--space-2)] text-right text-[length:var(--text-xs)]",
                        pnlUp ? "val-positive" : "val-negative"
                      )}
                    >
                      {formatSignedCurrency(c.unrealizedPnlEur)}
                      {c.unrealizedPnlPct != null && (
                        <span className="block text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                          {formatSignedPct(c.unrealizedPnlPct)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
