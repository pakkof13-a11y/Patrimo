"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
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
import {
  AltEmptyState,
  AltField,
  AltFormPanel,
  AltFormSection,
  AltMiniKpi,
  AltModuleShell,
} from "@/components/tabs/alternatives-shell";

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
  const hasLines = lines.length > 0;

  const pnlPreview = useMemo(() => {
    const cost = Number(String(form.purchasePrice).replace(",", ".")) || 0;
    const est = Number(String(form.estimatedValue).replace(",", ".")) || 0;
    return est - cost;
  }, [form.purchasePrice, form.estimatedValue]);

  async function invalidate() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["tangibles"] }),
      qc.invalidateQueries({ queryKey: ["holdings"] }),
      qc.invalidateQueries({ queryKey: ["alternatives-summary"] }),
    ]);
  }

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
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/tangibles?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: async () => {
      toast.success("Actif supprimé");
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startCreate() {
    setEditingId(null);
    setForm(empty());
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(empty());
  }

  return (
    <AltModuleShell
      testId="tangibles-section"
      title="Tangibles & collection"
      subtitle="Montres, vins, art, automobiles… — prix d’achat et valeur estimée manuelle (hors cotation marché)"
      action={
        <Button
          type="button"
          size="sm"
          onClick={startCreate}
          data-testid="tangible-add"
        >
          <Plus className="h-3.5 w-3.5" />
          Nouvel actif
        </Button>
      }
      kpis={
        <>
          <AltMiniKpi
            label="Valeur estimée"
            value={formatCurrency(summary?.totalValue || "0", baseCurrency)}
            hint="Somme des estimations"
          />
          <AltMiniKpi
            label="Coût d’achat"
            value={formatCurrency(summary?.totalCost || "0", baseCurrency)}
            hint="Capital engagé"
          />
          <AltMiniKpi
            label="Plus-value latente"
            value={formatCurrency(summary?.totalPnl || "0", baseCurrency)}
            tone={Number(summary?.totalPnl || 0)}
            hint="Estimé − achat (calculé)"
          />
          <AltMiniKpi
            label="Objets"
            value={String(summary?.lineCount ?? 0)}
            hint="Lignes de collection"
          />
        </>
      }
      formOpen={showForm}
      form={
        <AltFormPanel
          title={editingId ? "Modifier l’actif" : "Nouvel actif tangible"}
          hint="« Nouvel actif » ouvre ce panneau. La plus-value est calculée (valeur estimée − prix d’achat)."
          testId="tangible-form"
          actions={
            <>
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
                {saveMut.isPending
                  ? "…"
                  : editingId
                    ? "Enregistrer"
                    : "Créer l’actif"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={cancelForm}>
                Annuler
              </Button>
            </>
          }
        >
          <AltFormSection title="Identité" hint="Catégorie et description de l’objet.">
            <AltField label="Catégorie">
              <select
                className="input"
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
              >
                {TANGIBLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TANGIBLE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </AltField>
            <AltField label="Marque / Artiste">
              <input
                className="input"
                value={form.brandOrArtist}
                onChange={(e) =>
                  setForm((f) => ({ ...f, brandOrArtist: e.target.value }))
                }
                data-testid="tangible-brand"
              />
            </AltField>
            <AltField label="Modèle / Nom">
              <input
                className="input"
                value={form.modelName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, modelName: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Année / Millésime">
              <input
                className="input"
                value={form.yearOrVintage}
                onChange={(e) =>
                  setForm((f) => ({ ...f, yearOrVintage: e.target.value }))
                }
              />
            </AltField>
          </AltFormSection>

          <AltFormSection
            title="Valorisation"
            hint="Achat saisi · estimation manuelle · plus-value calculée."
          >
            <AltField label="Prix d’achat">
              <input
                className="input"
                inputMode="decimal"
                value={form.purchasePrice}
                onChange={(e) =>
                  setForm((f) => ({ ...f, purchasePrice: e.target.value }))
                }
              />
            </AltField>
            <AltField
              label="Valeur estimée actuelle"
              hint={
                form.purchasePrice || form.estimatedValue ? (
                  <>
                    Plus-value estimée :{" "}
                    <strong>
                      {formatCurrency(String(pnlPreview), form.currency)}
                    </strong>
                  </>
                ) : undefined
              }
            >
              <input
                className="input"
                inputMode="decimal"
                value={form.estimatedValue}
                onChange={(e) =>
                  setForm((f) => ({ ...f, estimatedValue: e.target.value }))
                }
              />
            </AltField>
            <AltField label="Devise">
              <input
                className="input uppercase"
                maxLength={3}
                value={form.currency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    currency: e.target.value.toUpperCase(),
                  }))
                }
              />
            </AltField>
            <label className="flex items-center gap-2 pt-5 text-xs font-medium text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="accent-teal-700"
                checked={form.hasCertificate}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    hasCertificate: e.target.checked,
                  }))
                }
              />
              Certificat d’authenticité
            </label>
            <AltField label="Notes" className="sm:col-span-2 lg:col-span-3">
              <input
                className="input"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Provenance, état, assurance…"
              />
            </AltField>
          </AltFormSection>
        </AltFormPanel>
      }
    >
      {!q.isLoading && !hasLines && !showForm ? (
        <AltEmptyState
          title="Aucun actif de collection"
          description="Inventoriez montres, vins, œuvres ou véhicules et suivez l’écart entre prix d’achat et valeur estimée."
          bullets={[
            "Catégorie, marque / artiste, modèle",
            "Prix d’achat et estimation actuelle (manuelle)",
            "Plus-value latente calculée automatiquement",
          ]}
          primaryLabel="Nouvel actif"
          onPrimary={startCreate}
          primaryTestId="tangible-empty-add"
        />
      ) : (
        <div className="table-container-responsive table-fluid-wrap">
          <table className="table-fluid text-sm" data-testid="tangibles-table">
            <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2.5 text-left">Catégorie</th>
                <th className="px-3 py-2.5 text-left">Marque / Artiste</th>
                <th className="px-3 py-2.5 text-left">Modèle</th>
                <th className="px-3 py-2.5 text-left">Année</th>
                <th className="px-3 py-2.5 text-right">Achat</th>
                <th className="px-3 py-2.5 text-right">Valeur est.</th>
                <th className="px-3 py-2.5 text-right">+/- €</th>
                <th className="px-3 py-2.5 text-right">+/- %</th>
                <th className="px-3 py-2.5 text-center">Certif.</th>
                <th className="px-3 py-2.5 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm text-slate-400"
                  >
                    Chargement…
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <tr
                  key={l.id}
                  className="border-t border-[var(--border)] transition-colors hover:bg-[var(--muted)]/35"
                >
                  <td className="px-3 py-2 text-xs">
                    {TANGIBLE_CATEGORY_LABELS[l.category]}
                  </td>
                  <td className="px-3 py-2 font-medium">{l.brandOrArtist}</td>
                  <td className="px-3 py-2">{l.modelName}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {l.yearOrVintage || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(l.purchasePrice, l.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {formatCurrency(l.estimatedValue, l.currency)}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium tabular-nums",
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
                  <td className="px-3 py-2 text-center text-xs text-slate-500">
                    {l.hasCertificate ? "Oui" : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="inline-flex gap-0.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                        onClick={() => {
                          setEditingId(l.id);
                          setForm(toForm(l));
                          setShowForm(true);
                        }}
                        aria-label="Modifier"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                        onClick={() => {
                          if (
                            confirm(
                              `Supprimer « ${l.brandOrArtist} ${l.modelName} » ?`
                            )
                          ) {
                            delMut.mutate(l.id);
                          }
                        }}
                        aria-label="Supprimer"
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
      )}
    </AltModuleShell>
  );
}
