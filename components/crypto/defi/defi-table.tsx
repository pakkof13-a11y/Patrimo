"use client";

import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import { defiPositionTypeLabel } from "@/app/lib/crypto/constants";
import { getDefiStatusBadges, type ClientDefiPosition } from "@/app/lib/crypto/defi-ui-rules";
import { DefiBadgeList } from "./defi-badges";

/**
 * Tableau analytique principal — dense mais lisible.
 *
 * `overflow-x-auto` plutôt qu'une bascule vers des cartes sur mobile : le
 * cahier des charges accepte les deux patterns (« liste de cartes ou tableau
 * scrollable maîtrisé »), et un second layout de cartes dupliquerait chaque
 * règle d'affichage sans rien apporter de plus qu'un défilement horizontal
 * déjà accessible au clavier. Colonnes les moins critiques (chaîne, dernière
 * MàJ) masquées sous `sm`/`lg` plutôt que supprimées : l'information reste
 * disponible dans le panneau détail.
 */
export function DefiTable({
  positions,
  onOpenDetail,
}: {
  positions: ClientDefiPosition[];
  onOpenDetail: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto" data-testid="defi-table-wrap">
      <table className="w-full text-xs" data-testid="defi-table">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <th className="py-1.5 pr-2">Position</th>
            <th className="py-1.5 pr-2">Type</th>
            <th className="hidden py-1.5 pr-2 sm:table-cell">Mode</th>
            <th className="hidden py-1.5 pr-2 lg:table-cell">Chaîne</th>
            <th className="py-1.5 pr-2">Protocole / plateforme</th>
            <th className="py-1.5 pr-2">Actif</th>
            <th className="py-1.5 pr-2 text-right">Brute</th>
            <th className="py-1.5 pr-2 text-right">Dette</th>
            <th className="hidden py-1.5 pr-2 text-right sm:table-cell">Collatéral</th>
            <th className="py-1.5 pr-2 text-right">Nette</th>
            <th className="hidden py-1.5 pr-2 text-right sm:table-cell">Rewards</th>
            <th className="hidden py-1.5 pr-2 lg:table-cell">Dernière MàJ</th>
            <th className="py-1.5 pr-2">Statut &amp; alertes</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <DefiTableRow key={p.id} p={p} onOpen={() => onOpenDetail(p.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DefiTableRow({
  p,
  onOpen,
}: {
  p: ClientDefiPosition;
  onOpen: () => void;
}) {
  const badges = getDefiStatusBadges(p);
  const isDebtLine = Number(p.valuation.debtEur) > 0;

  return (
    <tr
      className="cursor-pointer border-b border-[var(--border)]/50 transition hover:bg-[var(--muted)]/20 focus-within:bg-[var(--muted)]/20"
      data-testid="defi-row"
      data-position-id={p.id}
    >
      <td className="py-1.5 pr-2">
        <button
          type="button"
          onClick={onOpen}
          className="max-w-[10rem] truncate text-left font-medium underline decoration-dotted decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--foreground)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] sm:max-w-none"
          data-testid="defi-row-open"
        >
          {p.assetName}
        </button>
      </td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{defiPositionTypeLabel(p.positionType)}</td>
      <td className="hidden py-1.5 pr-2 sm:table-cell">{accessModeShort(p.accessMode)}</td>
      <td className="hidden py-1.5 pr-2 lg:table-cell">{p.chain ?? "—"}</td>
      <td className="py-1.5 pr-2">
        <span className="max-w-[8rem] truncate sm:max-w-none">{p.protocol || "—"}</span>
        <span className="text-meta ml-1">· {p.platformName}</span>
      </td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{p.assetSymbol}</td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {formatCurrency(p.valuation.grossEur, "EUR")}
      </td>
      <td
        className={cn(
          "py-1.5 pr-2 text-right tabular-nums",
          isDebtLine && "text-[var(--danger)]"
        )}
      >
        {isDebtLine ? `− ${formatCurrency(p.valuation.debtEur, "EUR")}` : "—"}
      </td>
      <td className="hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell">
        {Number(p.valuation.collateralEur) > 0 ? formatCurrency(p.valuation.collateralEur, "EUR") : "—"}
      </td>
      <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
        {formatCurrency(p.valuation.netEur, "EUR")}
      </td>
      <td className="hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell">
        {Number(p.valuation.rewardsEur) > 0 ? formatCurrency(p.valuation.rewardsEur, "EUR") : "—"}
      </td>
      <td className="hidden py-1.5 pr-2 whitespace-nowrap lg:table-cell">
        {p.valuation.lastValuationAt ? formatDate(p.valuation.lastValuationAt) : "—"}
      </td>
      <td className="py-1.5 pr-2">
        <DefiBadgeList badges={badges} />
      </td>
    </tr>
  );
}

function accessModeShort(mode: string): string {
  if (mode === "DEFI") return "DeFi";
  if (mode === "HYBRID") return "Hybride";
  if (mode === "CEFI") return "CeFi";
  return mode;
}
