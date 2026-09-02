"use client";

import { EmptyPlaceholder } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { getDefiEmptyStateConfig, type EmptyStateKind } from "@/app/lib/crypto/defi-ui-rules";

/**
 * États vides du module DeFi — un message et un CTA par cas, jamais une
 * formulation vague. La config vient de `defi-ui-rules.ts` : ce composant ne
 * fait que la traduire en boutons concrets.
 */
export function DefiEmptyState({
  kind,
  onAdd,
  onSync,
  onResetFilters,
  onShowHidden,
}: {
  kind: EmptyStateKind;
  onAdd?: () => void;
  onSync?: () => void;
  onResetFilters?: () => void;
  onShowHidden?: () => void;
}) {
  const cfg = getDefiEmptyStateConfig(kind);

  return (
    <EmptyPlaceholder
      title={cfg.title}
      description={cfg.description}
      emptyKind={kind}
      testId={`defi-empty-${kind}`}
      action={
        cfg.primaryCta === "add" && (onAdd || onSync) ? (
          <div className="flex flex-wrap justify-center gap-2">
            {onAdd && (
              <Button type="button" onClick={onAdd} data-testid="defi-empty-add">
                Ajouter une position
              </Button>
            )}
            {onSync && (
              <Button
                type="button"
                variant="outline"
                onClick={onSync}
                data-testid="defi-empty-sync"
              >
                Synchroniser un wallet
              </Button>
            )}
          </div>
        ) : cfg.primaryCta === "reset-filters" && onResetFilters ? (
          <Button
            type="button"
            variant="outline"
            onClick={onResetFilters}
            data-testid="defi-empty-reset-filters"
          >
            Réinitialiser les filtres
          </Button>
        ) : cfg.primaryCta === "show-hidden" && onShowHidden ? (
          <Button
            type="button"
            variant="outline"
            onClick={onShowHidden}
            data-testid="defi-empty-show-hidden"
          >
            Afficher masquées et ignorées
          </Button>
        ) : null
      }
    />
  );
}
