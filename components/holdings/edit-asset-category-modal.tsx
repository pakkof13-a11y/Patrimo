"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  ASSET_CATEGORY_LABELS,
  categoriesForEnvelope,
  parseAssetCategory,
  type AssetCategory,
} from "@/app/lib/assets/categories";
import type { AccountType } from "@/app/lib/constants";
import { cn } from "@/app/lib/utils";

export function EditAssetCategoryModal({
  open,
  onClose,
  assetId,
  assetName,
  ticker,
  accountType,
  currentCategory,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  assetId: string;
  assetName: string;
  ticker?: string | null;
  accountType?: string | null;
  currentCategory?: string | null;
  onSaved: (category: AssetCategory) => void;
}) {
  const envelope = (accountType || "CTO") as AccountType;
  const { suggested, other } = categoriesForEnvelope(envelope);
  const [value, setValue] = useState<AssetCategory>(
    parseAssetCategory(currentCategory)
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(`${open}:${assetId}:${currentCategory}`);
  const nextKey = `${open}:${assetId}:${currentCategory}`;

  // Reset à l’ouverture / changement d’actif (adjust state while rendering)
  if (open && nextKey !== resetKey) {
    setResetKey(nextKey);
    setValue(parseAssetCategory(currentCategory));
    setError(null);
    setPending(false);
  }

  async function save() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/${assetId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: value }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        asset?: { category?: string };
      };
      if (!res.ok) {
        throw new Error(
          typeof body.error === "string" && body.error
            ? body.error
            : "Échec de l’enregistrement"
        );
      }
      onSaved(parseAssetCategory(body.asset?.category ?? value));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setPending(false);
    }
  }

  if (!open) return null;

  return (
    <Modal onClose={onClose} title="Catégorie de l’actif">
      <div className="space-y-4" data-testid="edit-category-modal">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2.5">
          <p className="text-sm font-semibold text-[var(--foreground)]">
            {assetName}
            {ticker ? (
              <span className="ml-1.5 font-mono text-xs font-normal text-[var(--muted-foreground)]">
                {ticker}
              </span>
            ) : null}
          </p>
          <p className="text-meta mt-1">
            Classification d&apos;affichage uniquement — sans effet sur quantités,
            CUMP ou P&amp;L.
          </p>
        </div>

        <label className="block text-xs font-medium text-[var(--muted-foreground)]">
          Sous-catégorie
          <select
            className="input mt-1.5 w-full"
            value={value}
            onChange={(e) => setValue(parseAssetCategory(e.target.value))}
            data-testid="edit-category-select"
            disabled={pending}
          >
            <optgroup label="Suggestions pour cette enveloppe">
              {suggested.map((c) => (
                <option key={c} value={c}>
                  {ASSET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </optgroup>
            {other.length > 0 && (
              <optgroup label="Autres catégories">
                {other.map((c) => (
                  <option key={c} value={c}>
                    {ASSET_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {error && (
          <p
            className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Annuler
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void save()}
            disabled={pending}
            data-testid="edit-category-save"
            className={cn(pending && "opacity-70")}
          >
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
