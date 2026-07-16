"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, getChangeColor } from "@/app/lib/utils";
import {
  TANGIBLE_CATEGORIES,
  TANGIBLE_CATEGORY_LABELS,
  type TangibleAssetDto,
  type TangibleAssetsSummary,
} from "@/app/lib/alternatives/types";

type FormState = {
  category: string;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage: string;
  purchasePrice: string;
  estimatedValue: string;
  currency: string;
  hasCertificate: boolean;
  notes: string;
};

const empty = (): FormState => ({
  category: "WATCHES",
  brandOrArtist: "",
  modelName: "",
  yearOrVintage: "",
  purchasePrice: "",
  estimatedValue: "",
  currency: "EUR",
  hasCertificate: false,
  notes: "",
});

function toForm(l: TangibleAssetDto): FormState {
  return {
    category: l.category,
    brandOrArtist: l.brandOrArtist,
    modelName: l.modelName,
    yearOrVintage: l.yearOrVintage || "",
    purchasePrice: l.purchasePrice,
    estimatedValue: l.estimatedValue,
    currency: l.currency,
    hasCertificate: l.hasCertificate,
    notes: l.notes || "",
  };
}

export function AlternativesTangibles({
  baseCurrency = "EUR",
}: {
  baseCurrency?: string;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["tangibles"],
    queryFn: () =>
      fetchJson<{ lines: TangibleAssetDto[]; summary: TangibleAssetsSummary }>(
        "/api/tangibles"
      ),
  });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty());

  const lines = q.data?.lines ?? [];
  const summary = q.data?.summary;

  const saveMut = useMutation({
    mutationFn: async () => {
      const body = {
        category: form.category,
        brandOrArtist: form.brandOrArtist,
        modelName: form.modelName,
        yearOrVintage: form.yearOrVintage || null,
        purchasePrice: form.purchasePrice || "0",
        estimatedValue: form.estimatedValue || "0",
        currency: form.currency || "EUR",
        hasCertificate: form.hasCertificate,
        notes: form.notes || null,
      };
      if (editingId) {
        return fetchJson("/api/tangibles", {
          method: "PUT",
          body: JSON.stringify({ id: editingId, ...body }),
        });
      }
      return fetchJson("/api/tangibles", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      toast.success(editingId ? "Actif mis à jour" : "Actif ajouté");
      setEditingId(null);
      setForm(empty());
      setShowForm(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tangibles"] }),
        qc.invalidateQueries({ queryKey: ["holdings"] }),
        qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/tangibles?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Actif supprimé");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["tangibles"] }),
        qc.invalidateQueries({ queryKey: ["holdings"] }),
        qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
      ]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="card overflow-hidden" data-testid="tangibles-section">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">Actifs tangibles & Collection</h2>
          <p className="text-xs text-zinc-500">
            Montres, vins, art, auto… · valeur estimée manuelle
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setEditingId(null);
            setForm(empty());
            setShowForm(true);
          }}
          data-testid="tangible-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvel actif
        </Button>
      </div>

      <div className="grid gap-2 border-b border-[var(--border)] px-4 py-3 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Valeur estimée</div>
          <div className="text-sm font-semibold tabular-nums">
            {formatCurrency(summary?.totalValue || "0", baseCurrency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Coût d&apos;achat</div>
          <div className="text-sm font-semibold tabular-nums">
            {formatCurrency(summary?.totalCost || "0", baseCurrency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Plus-value</div>
          <div
            className={cn(
              "text-sm font-semibold tabular-nums",
              getChangeColor(summary?.totalPnl || "0")
            )}
          >
            {formatCurrency(summary?.totalPnl || "0", baseCurrency)}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Objets</div>
          <div className="text-sm font-semibold">{summary?.lineCount ?? 0}</div>
        </div>
      </div>

      {showForm && (
        <div className="border-b border-[var(--border)] bg-[var(--muted)]/40 px-4 py-4">
          <h3 className="mb-3 text-sm font-semibold">
            {editingId ? "Modifier" : "Ajouter"} — Tangible
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs">
              Catégorie
              <select
                className="input mt-1"
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {TANGIBLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TANGIBLE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Marque / Artiste
              <input
                className="input mt-1"
                value={form.brandOrArtist}
                onChange={(e) =>
                  setForm((f) => ({ ...f, brandOrArtist: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Modèle / Nom
              <input
                className="input mt-1"
                value={form.modelName}
                onChange={(e) => setForm((f) => ({ ...f, modelName: e.target.value }))}
              />
            </label>
            <label className="text-xs">
              Année / Millésime
              <input
                className="input mt-1"
                value={form.yearOrVintage}
                onChange={(e) =>
                  setForm((f) => ({ ...f, yearOrVintage: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Prix d&apos;achat
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.purchasePrice}
                onChange={(e) =>
                  setForm((f) => ({ ...f, purchasePrice: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Valeur estimée actuelle
              <input
                className="input mt-1"
                inputMode="decimal"
                value={form.estimatedValue}
                onChange={(e) =>
                  setForm((f) => ({ ...f, estimatedValue: e.target.value }))
                }
              />
            </label>
            <label className="text-xs">
              Devise
              <input
                className="input mt-1"
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              />
            </label>
            <label className="flex items-center gap-2 text-xs pt-5">
              <input
                type="checkbox"
                className="accent-teal-700"
                checked={form.hasCertificate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, hasCertificate: e.target.checked }))
                }
              />
              Certificat d&apos;authenticité
            </label>
            <label className="text-xs sm:col-span-2 lg:col-span-3">
              Notes
              <input
                className="input mt-1"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                saveMut.isPending ||
                !form.brandOrArtist.trim() ||
                !form.modelName.trim()
              }
              onClick={() => saveMut.mutate()}
            >
              {editingId ? "Enregistrer" : "Créer"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}

      <div className="table-container-responsive table-fluid-wrap">
        <table className="table-fluid text-sm" data-testid="tangibles-table">
          <thead className="table-head text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Catégorie</th>
              <th className="px-3 py-2 text-left">Marque / Artiste</th>
              <th className="px-3 py-2 text-left">Modèle</th>
              <th className="px-3 py-2 text-left">Année</th>
              <th className="px-3 py-2 text-right">Achat</th>
              <th className="px-3 py-2 text-right">Valeur est.</th>
              <th className="px-3 py-2 text-right">+/- €</th>
              <th className="px-3 py-2 text-right">+/- %</th>
              <th className="px-3 py-2 text-center">Certif.</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-zinc-400">
                  Chargement…
                </td>
              </tr>
            )}
            {!q.isLoading && lines.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-zinc-400">
                  Aucun objet — ajoutez une montre, un vin, une œuvre…
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 text-xs">
                  {TANGIBLE_CATEGORY_LABELS[l.category]}
                </td>
                <td className="px-3 py-2 font-medium">{l.brandOrArtist}</td>
                <td className="px-3 py-2">{l.modelName}</td>
                <td className="px-3 py-2 text-xs">{l.yearOrVintage || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatCurrency(l.purchasePrice, l.currency)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {formatCurrency(l.estimatedValue, l.currency)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums font-medium",
                    getChangeColor(l.unrealizedPnl)
                  )}
                >
                  {formatCurrency(l.unrealizedPnl, l.currency)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums",
                    getChangeColor(l.unrealizedPnlPct)
                  )}
                >
                  {Number(l.unrealizedPnlPct).toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  %
                </td>
                <td className="px-3 py-2 text-center text-xs">
                  {l.hasCertificate ? "Oui" : "Non"}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(l.id);
                        setForm(toForm(l));
                        setShowForm(true);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (
                          confirm(
                            `Supprimer « ${l.brandOrArtist} ${l.modelName} » ?`
                          )
                        ) {
                          delMut.mutate(l.id);
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
