"use client";

/**
 * Ligne sélectionnable d'une table de module.
 *
 * ## Ce qu'elle factorise
 *
 * Huit tables — Immobilier, Épargne salariale, Alternatifs, Passifs,
 * Transactions, Plateformes, Fiscalité, Trading — ouvrent leur fiche de détail
 * au clic sur une ligne. Toutes huit avaient recopié la même mécanique :
 * `cursor`, classe de sélection, `aria-current`, `tabIndex`, et le même
 * gestionnaire Entrée/Espace. Aucune n'en avait dévié d'un caractère, et
 * l'oubli du clavier dans la neuvième aurait été indétectable à la relecture.
 *
 * ## Ce qu'elle ne factorise pas
 *
 * Rien du métier. Les cellules restent chez l'appelant, qui reste aussi
 * responsable de son `data-testid`, de ses attributs de sélection E2E
 * (`data-platform-row`, `data-fiscal-row`, `data-trade-row`) et de ses
 * gestes propres — le double-clic d'édition du journal, par exemple. Ils
 * passent par les propriétés natives de `<tr>`, sans qu'une prop soit
 * inventée pour chacun.
 */

import { cn } from "@/app/lib/utils";

export function DataRow({
  selected,
  onSelect,
  className,
  children,
  ...rest
}: {
  selected: boolean;
  /**
   * Sélection de la ligne — au clic, et au clavier par Entrée ou Espace.
   *
   * La ligne n'est pas un `<button>` : elle porte des cellules. Le clavier y
   * est donc rendu à la main, et c'est précisément la partie que les huit
   * copies risquaient de perdre.
   */
  onSelect: () => void;
} & Omit<React.ComponentPropsWithoutRef<"tr">, "onSelect">) {
  return (
    <tr
      className={cn("data-row", selected && "is-selected", className)}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      {...rest}
    >
      {children}
    </tr>
  );
}
