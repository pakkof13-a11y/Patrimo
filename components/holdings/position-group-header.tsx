"use client";

import { useMemo } from "react";
import {
  Bitcoin,
  Building2,
  ChevronRight,
  Coins,
  Landmark,
  LineChart,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";
import {
  HOLDINGS_EXPAND_COL_PX,
  HOLDINGS_SELECT_COL_PX,
} from "@/components/holdings/holding-table-row";
import type { AssetClass } from "@/app/lib/constants";

/**
 * Une icône par classe, fixe et non générée : un pictogramme tiré d'un hachage
 * change de sens dès qu'on renomme un libellé, et l'utilisateur apprend la
 * forme avant de lire le mot.
 */
const ICON_BY_CLASS: Record<AssetClass, LucideIcon> = {
  ACTIONS: LineChart,
  OBLIGATIONS: Landmark,
  CRYPTO: Bitcoin,
  IMMOBILIER: Building2,
  CASH: Coins,
  AUTRE: Shapes,
};

function signedCurrency(v: number, currency: string): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), currency)}`;
}

function signedPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} %`;
}

export type GroupHeaderColumn = { id: string; size: number };

/**
 * Colonnes pour lesquelles un total de classe a un sens. Les autres — ticker,
 * quantité, cours, enveloppe — restent vides : additionner les quantités
 * d'actifs différents ou moyenner leurs cours ne produirait pas un nombre,
 * juste un chiffre.
 */
const VALUE_COLUMNS = new Set([
  "marketValueBase",
  "costBasisEur",
  "unrealizedPnlBase",
  "unrealizedPnlPct",
  "allocationPct",
]);

/**
 * En-tête de groupe du portefeuille : une classe d'actifs repliable.
 *
 * Rend **une cellule par colonne visible** plutôt qu'un unique `colSpan` : un
 * total de classe qui ne tombe pas sous la colonne qu'il totalise oblige à
 * relire l'en-tête pour savoir ce qu'on regarde, et se décale un peu plus à
 * chaque colonne déplacée ou masquée. Les colonnes sans total de groupe
 * possible (ticker, quantité, cours…) restent vides — additionner des
 * quantités d'actifs différents ne voudrait rien dire.
 *
 * Tous les totaux viennent du parent ; aucun calcul métier ici. `spark` et
 * `dayChange` sont facultatifs : ils viennent du P&L journalier par classe,
 * qui n'est pas toujours chargé et qui n'existe pas pour une classe sans
 * historique de cours. Leur place est réservée pour que leur arrivée ne fasse
 * pas sauter la ligne.
 */
export function PositionGroupHeader({
  label,
  assetClass,
  count,
  totalMarketValue,
  totalCostBasis,
  totalUnrealizedPnl,
  unrealizedPnlPct,
  weightPct,
  spark,
  dayChange,
  estimated,
  baseCurrency,
  expanded,
  onToggle,
  columns,
}: {
  label: string;
  assetClass: AssetClass;
  count: number;
  totalMarketValue: number;
  totalCostBasis: number;
  totalUnrealizedPnl: number;
  unrealizedPnlPct: number | null;
  weightPct: number | null;
  /** Valeur de marché de la classe, jour par jour. */
  spark?: number[];
  /** P&L de la dernière journée connue, en devise de base. */
  dayChange?: number | null;
  /** Au moins un jour de la fenêtre manque de cours pour cette classe. */
  estimated?: boolean;
  baseCurrency: string;
  expanded: boolean;
  onToggle: () => void;
  /** Colonnes visibles, dans l'ordre et à la largeur du tableau. */
  columns: GroupHeaderColumn[];
}) {
  const Icon = ICON_BY_CLASS[assetClass];
  const pnlUp = totalUnrealizedPnl >= 0;
  const dayUp = (dayChange ?? 0) >= 0;

  /**
   * Seule la cellule du libellé absorbe les colonnes vides qui la suivent
   * (ticker, cours, enveloppe…) : elle y gagne de quoi afficher « Actions /
   * ETF », son nombre de lignes et sa courbe au lieu de « Acti… ».
   *
   * Ailleurs, chaque colonne garde sa cellule. Étendre un total sur les
   * colonnes vides qui le suivent paraît économe, mais son contenu est aligné
   * à droite : il finirait collé au bord de la fusion, c'est-à-dire sous une
   * tout autre colonne que celle qu'il totalise.
   */
  const cells = useMemo(() => {
    const out: { id: string; colSpan: number; width: number }[] = [];
    let absorbing = false;
    for (const c of columns) {
      const isEmpty = !VALUE_COLUMNS.has(c.id) && c.id !== "name";
      const prev = out[out.length - 1];
      if (isEmpty && absorbing && prev) {
        prev.colSpan += 1;
        prev.width += c.size;
        continue;
      }
      absorbing = c.id === "name";
      out.push({ id: c.id, colSpan: 1, width: c.size });
    }
    return out;
  }, [columns]);

  function cellContent(id: string) {
    switch (id) {
      case "name":
        return (
          <div className="flex min-w-0 items-center gap-[var(--space-2)]">
            <Icon
              className="h-4 w-4 shrink-0 text-[var(--primary-text)]"
              aria-hidden
            />
            <span className="min-w-0 truncate font-medium text-[var(--foreground)]">
              {label}
            </span>
            <span className="text-label shrink-0 tabular-nums">
              {count} {count === 1 ? "ligne" : "lignes"}
            </span>
            {spark && spark.length >= 2 && (
              <span className="ml-auto hidden h-[1.25rem] w-[4.5rem] shrink-0 lg:block">
                <Sparkline
                  values={spark}
                  stroke={
                    spark[spark.length - 1]! >= spark[0]!
                      ? "var(--chart-positive)"
                      : "var(--chart-negative)"
                  }
                  width={72}
                  height={20}
                  className="h-full w-full"
                />
              </span>
            )}
          </div>
        );

      case "marketValueBase":
        return (
          <div className="text-right">
            <div className="num font-semibold text-[var(--foreground)]">
              {formatCurrency(totalMarketValue, baseCurrency)}
            </div>
            {/* Variation du jour : sous le total, comme « qté × cours » sous
                la valeur d'une ligne — même grammaire, même place. */}
            <div
              className={cn(
                "num text-[length:var(--text-2xs)]",
                dayChange == null
                  ? "text-[var(--foreground-faint)]"
                  : dayUp
                    ? "val-positive"
                    : "val-negative"
              )}
              title={
                estimated
                  ? "Estimation : des cours manquent sur la période"
                  : "Variation de la dernière journée connue"
              }
            >
              {dayChange == null
                ? "—"
                : `${estimated ? "≈ " : ""}${signedCurrency(dayChange, baseCurrency)}`}
            </div>
          </div>
        );

      case "costBasisEur":
        return (
          <div className="num text-right text-[var(--foreground-secondary)]">
            {formatCurrency(totalCostBasis, baseCurrency)}
          </div>
        );

      case "unrealizedPnlBase":
        return (
          <div
            className={cn(
              "num text-right font-medium",
              pnlUp ? "val-positive" : "val-negative"
            )}
          >
            {signedCurrency(totalUnrealizedPnl, baseCurrency)}
          </div>
        );

      case "unrealizedPnlPct":
        return unrealizedPnlPct == null ? null : (
          <div
            className={cn(
              "num text-right font-medium",
              pnlUp ? "val-positive" : "val-negative"
            )}
          >
            {signedPct(unrealizedPnlPct)}
          </div>
        );

      case "allocationPct":
        return (
          <div className="num text-right text-[var(--foreground-secondary)]">
            {weightPct != null
              ? `${weightPct.toLocaleString("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })} %`
              : "—"}
          </div>
        );

      default:
        return null;
    }
  }

  return (
    <tr
      className="group-row"
      data-testid={`class-group-header-${assetClass}`}
      onClick={onToggle}
    >
      <td
        className="p-0"
        style={{ width: HOLDINGS_SELECT_COL_PX }}
        aria-hidden
      />
      <td className="p-0" style={{ width: HOLDINGS_EXPAND_COL_PX }}>
        <button
          type="button"
          className="group-row-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Replier" : "Déplier"} ${label}`}
          data-testid={`class-group-toggle-${assetClass}`}
          onClick={(e) => {
            // La ligne porte déjà le clic : sans cela, un clic sur le chevron
            // déclencherait la bascule deux fois et n'aurait aucun effet.
            e.stopPropagation();
            onToggle();
          }}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              expanded && "rotate-90"
            )}
            aria-hidden
          />
        </button>
      </td>
      {cells.map((cell) => (
        <td
          key={cell.id}
          colSpan={cell.colSpan}
          className="px-3 py-2 align-middle sm:px-4"
          style={{ width: cell.width }}
        >
          {cellContent(cell.id)}
        </td>
      ))}
    </tr>
  );
}
