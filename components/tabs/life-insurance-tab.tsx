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
import { formatCurrency, formatDate } from "@/app/lib/utils";
import { contractAgeLabel } from "@/app/lib/life-insurance/fiscal";
import type { Holding } from "@/app/lib/types/ui";
import { toast } from "sonner";

const AV_SUBTYPE_RANK = new Map(
  ASSURANCE_VIE_SUBTYPES.map((s, i) => [s, i] as const)
);

/** Presets « Courtier en assurance vie » triés par sous-catégorie puis A–Z */
function assuranceVieComboboxOptions(): PlatformComboboxOption[] {
  return PLATFORM_PRESETS.filter((p) => p.types.includes("ASSURANCE_VIE"))
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

type Policy = {
  id: string;
  insurer: string;
  openDate: string | null;
  cashEuro: string;
  currency: string;
  products: Array<{ id: string; name: string; currentValue: string }>;
};

/**
 * Contrats d'assurance-vie — enveloppe et antériorité fiscale.
 *
 * Ce panneau ne porte **plus** de valorisation. Elle y était saisie à la main,
 * en parallèle du journal de transactions, et alimentait le patrimoine net par
 * le cash : un support saisi ici et au journal comptait deux fois, et une UC
 * actions se retrouvait rangée dans « Cash ». Les supports sont désormais des
 * positions du journal comme les autres, listées ci-dessous en lecture seule.
 *
 * Ce qui reste ici n'a pas d'équivalent dans le journal : l'assureur et la
 * **date d'ouverture**, dont dépend l'antériorité des huit ans qui commande la
 * fiscalité des rachats.
 */
export function LifeInsuranceTab({
  avHoldings = [],
}: {
  /** Positions de l'enveloppe AV, déjà calculées par le parent. */
  avHoldings?: Holding[];
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["life-insurance"],
    queryFn: () => fetchJson<{ policies: Policy[] }>("/api/life-insurance"),
  });

  const [insurer, setInsurer] = useState("");
  const [openDate, setOpenDate] = useState("");

  const avOptions = useMemo(() => assuranceVieComboboxOptions(), []);

  const supportsTotal = useMemo(
    () =>
      avHoldings.reduce((sum, h) => sum + Number(h.marketValueEur || 0), 0),
    [avHoldings]
  );

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
          cashEuro: "0",
          currency: "EUR",
        }),
      }),
    onSuccess: async () => {
      toast.success("Contrat ajouté");
      setInsurer("");
      setOpenDate("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const policies = q.data?.policies ?? [];

  /**
   * Reliquats de l'ancienne saisie : un contrat peut encore porter une
   * valorisation si la migration vers le journal n'a pas été lancée. On le
   * signale plutôt que de l'ignorer — ces montants ne sont plus comptés dans le
   * patrimoine, et un chiffre affiché nulle part ailleurs passerait pour perdu.
   */
  const legacy = policies.filter(
    (p) => Number(p.cashEuro || 0) > 0 || p.products.length > 0
  );

  return (
    <div className="space-y-4">
      {legacy.length > 0 && (
        <section
          className="card border-amber-500/40 bg-amber-500/5 p-3.5"
          data-testid="av-legacy-warning"
        >
          <p className="text-sm font-semibold">
            Valorisations à reprendre au journal
          </p>
          <p className="text-meta mt-1">
            {legacy.length} contrat{legacy.length > 1 ? "s" : ""} porte
            {legacy.length > 1 ? "nt" : ""} encore des montants saisis à la main.
            Ils ne sont <strong>plus comptés</strong>{" "}
            dans le patrimoine net :
            les supports d&apos;assurance-vie sont désormais des positions du
            journal, au même titre qu&apos;une action. Lancez{" "}
            <code className="rounded bg-[var(--muted)] px-1 py-0.5 text-[11px]">
              npx tsx scripts/migrate-life-insurance.ts --apply
            </code>{" "}
            pour les reprendre automatiquement, ou saisissez-les via
            « Transaction ».
          </p>
          <ul className="text-meta mt-2 space-y-0.5">
            {legacy.map((p) => (
              <li key={p.id}>
                {p.insurer} —{" "}
                {Number(p.cashEuro || 0) > 0
                  ? `fonds euro ${formatCurrency(p.cashEuro, "EUR")}`
                  : ""}
                {p.products.length > 0
                  ? `${Number(p.cashEuro || 0) > 0 ? " · " : ""}${p.products.length} support(s)`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-1 text-base font-semibold">Contrats d&apos;assurance-vie</h2>
        <p className="text-meta mb-3">
          L&apos;enveloppe et sa date d&apos;ouverture — c&apos;est elle qui
          commande l&apos;antériorité des 8 ans. Les supports se saisissent comme
          toute position, par une transaction.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-xs sm:max-w-sm">
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
          </label>
          <label className="text-xs">
            Date d&apos;ouverture
            <input
              type="date"
              className="input mt-1"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
              data-testid="av-open-date"
            />
          </label>
          <Button size="sm" onClick={() => addPolicy.mutate()} disabled={!insurer}>
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
      </section>

      {policies.map((p) => (
        <section key={p.id} className="card overflow-hidden" data-testid="av-policy">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
            <div className="min-w-0">
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
              <div className="text-meta mt-1">
                Ouverture : {p.openDate ? formatDate(p.openDate) : "—"}
                {p.openDate ? ` · ${contractAgeLabel(p.openDate)}` : ""}
              </div>
            </div>
            <label className="text-xs">
              Date d&apos;ouverture
              <input
                type="date"
                className="input mt-1"
                defaultValue={p.openDate ? p.openDate.slice(0, 10) : ""}
                onBlur={(e) => {
                  const next = e.target.value || null;
                  const current = p.openDate ? p.openDate.slice(0, 10) : "";
                  if ((next ?? "") !== current) {
                    fetchJson("/api/life-insurance", {
                      method: "PUT",
                      body: JSON.stringify({ id: p.id, openDate: next }),
                    }).then(refresh);
                  }
                }}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Supprimer le contrat"
              onClick={() =>
                fetchJson(`/api/life-insurance?id=${p.id}`, {
                  method: "DELETE",
                }).then(refresh)
              }
            >
              <Trash2 className="h-3.5 w-3.5 text-red-500" />
            </Button>
          </div>
        </section>
      ))}

      <section className="card p-4" data-testid="av-supports">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Supports détenus</h3>
          <span className="text-meta">
            {avHoldings.length} support{avHoldings.length > 1 ? "s" : ""} ·{" "}
            {formatCurrency(String(supportsTotal), "EUR")}
          </span>
        </div>
        {avHoldings.length === 0 ? (
          <p className="text-meta">
            Aucun support dans l&apos;enveloppe AV. Ajoutez-en un par
            « Transaction », en choisissant une plateforme d&apos;assurance-vie.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {avHoldings.map((h) => (
              <li
                key={h.assetId}
                className="flex items-center gap-3 py-1.5 text-xs"
              >
                <span className="min-w-0 flex-1 truncate" title={h.name}>
                  {h.name}
                </span>
                <span className="text-[var(--muted-foreground)]">
                  {h.platformName}
                </span>
                <span className="tabular-nums font-medium">
                  {formatCurrency(h.marketValueEur, "EUR")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-meta mt-2">
          Ces lignes viennent du journal — elles portent donc un prix de revient
          et une plus-value, ce qu&apos;une valorisation saisie à la main ne
          permettait pas.
        </p>
      </section>
    </div>
  );
}
