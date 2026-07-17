"use client";

import { FileUp, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyPlaceholder } from "@/components/ui/panel";

/**
 * État vide Positions — message court + 1–2 CTA, sans faux contrôles de table.
 * `data-testid=holdings-empty` et `data-empty-kind` sur le même nœud (e2e).
 */
export function HoldingsEmptyState({
  kind,
  envelopeLabel,
  searchQuery,
  onClearSearch,
  onAddTransaction,
  onImport,
}: {
  kind: "source" | "filter" | "envelope";
  envelopeLabel?: string;
  searchQuery?: string;
  onClearSearch?: () => void;
  onAddTransaction?: () => void;
  onImport?: () => void;
}) {
  if (kind === "filter") {
    return (
      <EmptyPlaceholder
        testId="holdings-empty"
        emptyKind="filter"
        title={
          searchQuery
            ? `Aucun résultat pour « ${searchQuery} »`
            : "Aucun résultat pour ces filtres"
        }
        description="Modifiez la recherche ou l’enveloppe, ou effacez les filtres."
        action={
          onClearSearch ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearSearch}
              data-testid="holdings-empty-clear-search"
            >
              Effacer la recherche
            </Button>
          ) : undefined
        }
      />
    );
  }

  if (kind === "envelope") {
    return (
      <EmptyPlaceholder
        testId="holdings-empty"
        emptyKind="envelope"
        title={`Aucune position en ${envelopeLabel || "cette enveloppe"}`}
        description="Changez d’enveloppe ou enregistrez un achat sur ce type de compte."
      />
    );
  }

  return (
    <EmptyPlaceholder
      testId="holdings-empty"
      emptyKind="source"
      title="Aucune position pour l’instant"
      description="Les positions se calculent à partir du journal (achats, ventes, transferts). Importez un CSV ou saisissez un premier achat."
      action={
        <>
          {onAddTransaction && (
            <Button
              type="button"
              size="sm"
              onClick={onAddTransaction}
              data-testid="holdings-empty-add-tx"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouvel achat
            </Button>
          )}
          {onImport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onImport}
              data-testid="holdings-empty-import"
            >
              <FileUp className="h-3.5 w-3.5" />
              Importer un CSV
            </Button>
          )}
        </>
      }
    />
  );
}
