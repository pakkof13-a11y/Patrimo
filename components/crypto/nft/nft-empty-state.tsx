"use client";

import { EmptyPlaceholder } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { getNftEmptyStateConfig, type NftEmptyStateKind } from "@/app/lib/crypto/nft-ui-rules";

/**
 * États vides du module NFT — un message et un CTA par cas, jamais une
 * formulation vague (règle absolue du cahier des charges).
 */
export function NftEmptyState({
  kind,
  onAdd,
  onSync,
  onResetFilters,
  onShowHidden,
}: {
  kind: NftEmptyStateKind;
  onAdd?: () => void;
  onSync?: () => void;
  onResetFilters?: () => void;
  onShowHidden?: () => void;
}) {
  const cfg = getNftEmptyStateConfig(kind);

  return (
    <EmptyPlaceholder
      title={cfg.title}
      description={cfg.description}
      emptyKind={kind}
      testId={`nft-empty-${kind}`}
      action={
        cfg.primaryCta === "sync" && (onSync || onAdd) ? (
          <div className="flex flex-wrap justify-center gap-2">
            {onSync && (
              <Button type="button" onClick={onSync} data-testid="nft-empty-sync">
                Synchroniser un wallet
              </Button>
            )}
            {onAdd && (
              <Button type="button" variant="outline" onClick={onAdd} data-testid="nft-empty-add">
                Ajouter un NFT
              </Button>
            )}
          </div>
        ) : cfg.primaryCta === "add" && onAdd ? (
          <Button type="button" onClick={onAdd} data-testid="nft-empty-add">
            Ajouter un NFT
          </Button>
        ) : cfg.primaryCta === "reset-filters" && onResetFilters ? (
          <Button
            type="button"
            variant="outline"
            onClick={onResetFilters}
            data-testid="nft-empty-reset-filters"
          >
            Réinitialiser les filtres
          </Button>
        ) : cfg.primaryCta === "show-hidden" && onShowHidden ? (
          <Button
            type="button"
            variant="outline"
            onClick={onShowHidden}
            data-testid="nft-empty-show-hidden"
          >
            Afficher masqués, ignorés et spam
          </Button>
        ) : null
      }
    />
  );
}
