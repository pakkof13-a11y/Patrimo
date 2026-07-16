"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PlatformCombobox,
  type PlatformComboboxOption,
} from "@/components/ui/platform-combobox";
import {
  ASSURANCE_VIE_SUBTYPES,
  PLATFORM_PRESETS,
} from "@/app/lib/platforms/presets";
import { formatDate } from "@/app/lib/utils";
import { toast } from "sonner";

const AV_SUBTYPE_RANK = new Map(
  ASSURANCE_VIE_SUBTYPES.map((s, i) => [s, i] as const)
);

/** Presets « Courtier en assurance vie » triés par sous-catégorie puis A–Z */
function assuranceVieComboboxOptions(): PlatformComboboxOption[] {
  return PLATFORM_PRESETS.filter((p) => p.type === "ASSURANCE_VIE")
    .slice()
    .sort((a, b) => {
      const ra =
        AV_SUBTYPE_RANK.get(a.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ??
        99;
      const rb =
        AV_SUBTYPE_RANK.get(b.subtype as (typeof ASSURANCE_VIE_SUBTYPES)[number]) ??
        99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    })
    .map((p) => ({
      value: p.key,
      label: p.name,
      subtitle: p.subtype || "Assurance-vie",
      logoUrl: p.logoUrl,
      preset: p,
    }));
}

export function LifeInsuranceTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["life-insurance"],
    queryFn: () =>
      fetchJson<{
        policies: Array<{
          id: string;
          insurer: string;
          openDate: string | null;
          cashEuro: string;
          currency: string;
          cashCounts: boolean;
          products: Array<{
            id: string;
            name: string;
            currentValue: string;
            currency: string;
          }>;
        }>;
      }>("/api/life-insurance"),
  });

  const [insurer, setInsurer] = useState("");
  const [openDate, setOpenDate] = useState("");
  const [cashEuro, setCashEuro] = useState("0");
  const [productName, setProductName] = useState("");
  const [productValue, setProductValue] = useState("0");
  const [productParent, setProductParent] = useState("");

  const avOptions = useMemo(() => assuranceVieComboboxOptions(), []);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["life-insurance"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const addPolicy = useMutation({
    mutationFn: () =>
      fetchJson("/api/life-insurance", {
        method: "POST",
        body: JSON.stringify({
          insurer,
          openDate: openDate || null,
          cashEuro: cashEuro || "0",
          currency: "EUR",
        }),
      }),
    onSuccess: async () => {
      toast.success("Contrat ajouté");
      setInsurer("");
      setCashEuro("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addProduct = useMutation({
    mutationFn: () =>
      fetchJson("/api/life-insurance", {
        method: "POST",
        body: JSON.stringify({
          kind: "product",
          lifeInsuranceId: productParent,
          name: productName,
          currentValue: productValue || "0",
          currency: "EUR",
        }),
      }),
    onSuccess: async () => {
      toast.success("Produit structuré ajouté");
      setProductName("");
      setProductValue("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <section className="card p-4">
        <h2 className="mb-3 text-base font-semibold">Nouveau contrat</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs min-w-[16rem] flex-1 sm:max-w-sm">
            Courtier / Assureur
            <div className="mt-1">
              <PlatformCombobox
                value={insurer}
                options={avOptions}
                allowCustom
                placeholder="Linxea, Generali, Yomoni…"
                testId="av-insurer"
                onValueChange={setInsurer}
                onSelect={(sel) => {
                  if ("custom" in sel && sel.custom) {
                    setInsurer(sel.label);
                    return;
                  }
                  if ("label" in sel) setInsurer(sel.label);
                }}
              />
            </div>
            <span className="mt-0.5 block text-[10px] text-zinc-400">
              Liste des courtiers AV (sous-catégories) · saisie libre possible
            </span>
          </label>
          <label className="text-xs">
            Date d&apos;ouverture
            <input
              type="date"
              className="input mt-1"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Cash / Fonds euro
            <input
              className="input mt-1 !w-32"
              value={cashEuro}
              onChange={(e) => setCashEuro(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={() => addPolicy.mutate()} disabled={!insurer}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
      </section>

      {(q.data?.policies || []).map((p) => (
        <section key={p.id} className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div>
              <input
                className="input !w-auto font-semibold"
                defaultValue={p.insurer}
                onBlur={(e) => {
                  if (e.target.value !== p.insurer) {
                    fetchJson("/api/life-insurance", {
                      method: "PUT",
                      body: JSON.stringify({ id: p.id, insurer: e.target.value }),
                    }).then(refresh);
                  }
                }}
              />
              <div className="mt-1 text-xs text-zinc-500">
                Ouverture : {p.openDate ? formatDate(p.openDate) : "—"}
              </div>
            </div>
            <div className="text-right text-sm">
              <div className="text-xs text-zinc-500">Cash / Fonds euro</div>
              <input
                className="input !w-32 text-right font-semibold"
                defaultValue={p.cashEuro}
                onBlur={(e) => {
                  if (e.target.value !== p.cashEuro) {
                    fetchJson("/api/life-insurance", {
                      method: "PUT",
                      body: JSON.stringify({ id: p.id, cashEuro: e.target.value }),
                    }).then(refresh);
                  }
                }}
              />
              <div className="text-[10px] text-zinc-400">
                {p.cashCounts ? "Inclus patrimoine" : "Ignoré (0)"}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                fetchJson(`/api/life-insurance?id=${p.id}`, { method: "DELETE" }).then(refresh)
              }
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>

          <div className="px-4 py-3">
            <h3 className="mb-2 text-sm font-semibold">Produits structurés</h3>
            <table className="mb-3 w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 text-left">Nom</th>
                  <th className="py-1 text-right">Valorisation</th>
                  <th className="py-1 text-right" />
                </tr>
              </thead>
              <tbody>
                {p.products.map((pr) => (
                  <tr key={pr.id} className="border-t border-[var(--border)]">
                    <td className="py-2">
                      <input
                        className="input !py-1"
                        defaultValue={pr.name}
                        onBlur={(e) => {
                          if (e.target.value !== pr.name) {
                            fetchJson("/api/life-insurance", {
                              method: "PUT",
                              body: JSON.stringify({
                                kind: "product",
                                id: pr.id,
                                name: e.target.value,
                              }),
                            }).then(refresh);
                          }
                        }}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <input
                        className="input !w-28 !py-1 text-right"
                        defaultValue={pr.currentValue}
                        onBlur={(e) => {
                          if (e.target.value !== pr.currentValue) {
                            fetchJson("/api/life-insurance", {
                              method: "PUT",
                              body: JSON.stringify({
                                kind: "product",
                                id: pr.id,
                                currentValue: e.target.value,
                              }),
                            }).then(refresh);
                          }
                        }}
                      />
                    </td>
                    <td className="py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          fetchJson(`/api/life-insurance?id=${pr.id}&kind=product`, {
                            method: "DELETE",
                          }).then(refresh)
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {p.products.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-center text-xs text-zinc-400">
                      Aucun produit structuré
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Ajouter un produit structuré</h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            Contrat
            <select
              className="input mt-1"
              value={productParent}
              onChange={(e) => setProductParent(e.target.value)}
            >
              <option value="">—</option>
              {(q.data?.policies || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.insurer}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            Nom
            <input
              className="input mt-1"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
            />
          </label>
          <label className="text-xs">
            Valorisation
            <input
              className="input mt-1 !w-28"
              value={productValue}
              onChange={(e) => setProductValue(e.target.value)}
            />
          </label>
          <Button
            size="sm"
            disabled={!productParent || !productName}
            onClick={() => addProduct.mutate()}
          >
            <Plus className="h-3.5 w-3.5" /> Produit
          </Button>
        </div>
      </section>
    </div>
  );
}
