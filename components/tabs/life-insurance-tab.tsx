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
import {
  annualAllowanceEur,
  checkPremiumsSplit,
  contractAgeLabel,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  PREMIUMS_PFU_CUTOFF_ISO,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";
import { RedemptionSimulatorPanel } from "@/components/life-insurance/redemption-simulator-panel";
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
  premiumsBefore2017Eur: string;
  premiumsAfter2017Eur: string;
  premiumsTotalEur: string;
  outstandingEur: string;
  products: Array<{ id: string; name: string; currentValue: string }>;
};

type LifeInsuranceResponse = {
  policies: Policy[];
  taxHousehold: TaxHousehold;
  totalOutstandingEur: string;
  /** Primes tous contrats — base du seuil de 150 k€ (pas l'encours). */
  totalPremiumsBefore2017Eur?: string;
  totalPremiumsAfter2017Eur?: string;
  exceedsPfuThreshold: boolean;
};

function moneyInputValue(raw: string | undefined): string {
  if (!raw) return "";
  const n = Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n === 0) return raw === "0" || raw === "0.0" ? "0" : raw;
  // Affichage compact pour la saisie (évite 12 décimales Prisma).
  return String(n);
}

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
    queryFn: () => fetchJson<LifeInsuranceResponse>("/api/life-insurance"),
  });

  const [insurer, setInsurer] = useState("");
  const [openDate, setOpenDate] = useState("");
  const [premiumsBefore, setPremiumsBefore] = useState("");
  const [premiumsAfter, setPremiumsAfter] = useState("");

  const avOptions = useMemo(() => assuranceVieComboboxOptions(), []);

  const supportsTotal = useMemo(
    () =>
      avHoldings.reduce((sum, h) => sum + Number(h.marketValueEur || 0), 0),
    [avHoldings]
  );

  const newSplit = useMemo(
    () =>
      checkPremiumsSplit({
        premiumsBefore2017Eur: premiumsBefore || "0",
        premiumsAfter2017Eur: premiumsAfter || "0",
      }),
    [premiumsBefore, premiumsAfter]
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["life-insurance"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const addPolicy = useMutation({
    mutationFn: () => {
      if (!newSplit.ok) {
        throw new Error(newSplit.error || "Répartition des versements invalide");
      }
      return fetchJson("/api/life-insurance", {
        method: "POST",
        body: JSON.stringify({
          insurer,
          openDate: openDate || null,
          cashEuro: "0",
          currency: "EUR",
          premiumsBefore2017Eur: newSplit.premiumsBefore2017Eur,
          premiumsAfter2017Eur: newSplit.premiumsAfter2017Eur,
          totalPremiumsEur: newSplit.totalPremiumsEur,
        }),
      });
    },
    onSuccess: async () => {
      toast.success("Contrat ajouté");
      setInsurer("");
      setOpenDate("");
      setPremiumsBefore("");
      setPremiumsAfter("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveTaxHousehold = useMutation({
    mutationFn: (taxHousehold: TaxHousehold) =>
      fetchJson("/api/life-insurance", {
        method: "PUT",
        body: JSON.stringify({ kind: "tax-profile", taxHousehold }),
      }),
    onSuccess: async () => {
      toast.success("Situation fiscale enregistrée");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const policies = q.data?.policies ?? [];
  const taxHousehold: TaxHousehold = q.data?.taxHousehold ?? "SINGLE";
  const totalOutstandingEur = q.data?.totalOutstandingEur ?? "0";
  const exceedsPfuThreshold = q.data?.exceedsPfuThreshold ?? false;

  /**
   * Reliquats de l'ancienne saisie : un contrat peut encore porter une
   * valorisation si la migration vers le journal n'a pas été lancée. On le
   * signale plutôt que de l'ignorer — ces montants ne sont plus comptés dans le
   * patrimoine, et un chiffre affiché nulle part ailleurs passerait pour perdu.
   */
  const legacy = policies.filter(
    (p) => Number(p.cashEuro || 0) > 0 || p.products.length > 0
  );

  const simSupports = useMemo(
    () =>
      avHoldings.map((h) => ({
        assetId: h.assetId,
        lifeInsuranceId: null as string | null,
        name: h.name,
        currentValueEur: h.marketValueEur,
        costBasisEur: h.costBasisEur,
        unrealizedPnlEur: h.unrealizedPnlEur,
      })),
    [avHoldings]
  );

  const simOutstanding = useMemo(() => {
    const fromHoldings = avHoldings.reduce(
      (s, h) => s + Number(h.marketValueEur || 0),
      0
    );
    return String(Math.max(fromHoldings, Number(totalOutstandingEur || 0)));
  }, [avHoldings, totalOutstandingEur]);

  return (
    <div className="space-y-4">
      <RedemptionSimulatorPanel
        policies={policies}
        supports={simSupports}
        taxHousehold={taxHousehold}
        totalOutstandingEur={simOutstanding}
        totalPremiumsBefore2017Eur={q.data?.totalPremiumsBefore2017Eur ?? "0"}
        totalPremiumsAfter2017Eur={q.data?.totalPremiumsAfter2017Eur ?? "0"}
      />

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

      <section className="card p-4" data-testid="av-tax-profile">
        <h2 className="mb-1 text-base font-semibold">Situation fiscale</h2>
        <p className="text-meta mb-3">
          Une seule fois pour tout le foyer : l&apos;abattement annuel sur les
          gains d&apos;un rachat après 8 ans vaut{" "}
          {formatCurrency(String(annualAllowanceEur("SINGLE")), "EUR")} (seul)
          ou {formatCurrency(String(annualAllowanceEur("COUPLE")), "EUR")}{" "}
          (couple). Le seuil de{" "}
          {formatCurrency(String(PFU_OUTSTANDING_THRESHOLD_EUR), "EUR")}{" "}
          d&apos;encours s&apos;apprécie sur{" "}
          <strong>tous</strong> les contrats.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            Foyer fiscal
            <select
              className="input mt-1 w-full"
              value={taxHousehold}
              data-testid="av-tax-household"
              onChange={(e) =>
                saveTaxHousehold.mutate(e.target.value as TaxHousehold)
              }
            >
              <option value="SINGLE">Personne seule</option>
              <option value="COUPLE">Couple (imposition commune)</option>
            </select>
          </label>
          <div className="text-meta" data-testid="av-total-outstanding">
            Encours tous contrats (legacy) :{" "}
            {formatCurrency(totalOutstandingEur, "EUR")}
            {exceedsPfuThreshold ? " · au-dessus du seuil PFU" : " · sous le seuil PFU"}
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h2 className="mb-1 text-base font-semibold">Contrats d&apos;assurance-vie</h2>
        <p className="text-meta mb-3">
          L&apos;enveloppe, sa date d&apos;ouverture (antériorité des 8 ans) et
          la répartition des versements avant / après le{" "}
          {PREMIUMS_PFU_CUTOFF_ISO.split("-").reverse().join("/")} (taux PFU).
          Les supports se saisissent comme toute position, par une transaction.
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
              className="input mt-1 w-full"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
              data-testid="av-open-date"
            />
          </label>
          <label className="text-xs">
            Versé avant le 27/09/2017 (€)
            <input
              type="text"
              inputMode="decimal"
              className="input mt-1 w-36"
              placeholder="0"
              value={premiumsBefore}
              onChange={(e) => setPremiumsBefore(e.target.value)}
              data-testid="av-premiums-before"
            />
          </label>
          <label className="text-xs">
            Versé à partir du 27/09/2017 (€)
            <input
              type="text"
              inputMode="decimal"
              className="input mt-1 w-36"
              placeholder="0"
              value={premiumsAfter}
              onChange={(e) => setPremiumsAfter(e.target.value)}
              data-testid="av-premiums-after"
            />
          </label>
          <div className="text-meta" data-testid="av-premiums-total-preview">
            Total versé :{" "}
            {newSplit.ok
              ? formatCurrency(newSplit.totalPremiumsEur, "EUR")
              : "—"}
          </div>
          <Button
            size="sm"
            onClick={() => addPolicy.mutate()}
            disabled={!insurer || !newSplit.ok}
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter
          </Button>
        </div>
        {!newSplit.ok && (premiumsBefore || premiumsAfter) && (
          <p className="mt-2 text-xs text-red-500">{newSplit.error}</p>
        )}
      </section>

      {policies.map((p) => (
        <PolicyCard key={p.id} policy={p} onChanged={refresh} />
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

function PolicyCard({
  policy: p,
  onChanged,
}: {
  policy: Policy;
  onChanged: () => Promise<void>;
}) {
  const split = checkPremiumsSplit({
    premiumsBefore2017Eur: p.premiumsBefore2017Eur ?? "0",
    premiumsAfter2017Eur: p.premiumsAfter2017Eur ?? "0",
    totalPremiumsEur: p.premiumsTotalEur,
  });

  const savePremiums = async (before: string, after: string) => {
    const next = checkPremiumsSplit({
      premiumsBefore2017Eur: before || "0",
      premiumsAfter2017Eur: after || "0",
    });
    if (!next.ok) {
      toast.error(next.error || "Répartition invalide");
      return;
    }
    try {
      await fetchJson("/api/life-insurance", {
        method: "PUT",
        body: JSON.stringify({
          id: p.id,
          premiumsBefore2017Eur: next.premiumsBefore2017Eur,
          premiumsAfter2017Eur: next.premiumsAfter2017Eur,
          totalPremiumsEur: next.totalPremiumsEur,
        }),
      });
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible");
    }
  };

  return (
    <section className="card overflow-hidden" data-testid="av-policy">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0">
          <input
            className="input w-auto font-semibold"
            defaultValue={p.insurer}
            onBlur={(e) => {
              if (e.target.value !== p.insurer) {
                fetchJson("/api/life-insurance", {
                  method: "PUT",
                  body: JSON.stringify({ id: p.id, insurer: e.target.value }),
                }).then(onChanged);
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
            className="input mt-1 w-full"
            defaultValue={p.openDate ? p.openDate.slice(0, 10) : ""}
            onBlur={(e) => {
              const next = e.target.value || null;
              const current = p.openDate ? p.openDate.slice(0, 10) : "";
              if ((next ?? "") !== current) {
                fetchJson("/api/life-insurance", {
                  method: "PUT",
                  body: JSON.stringify({ id: p.id, openDate: next }),
                }).then(onChanged);
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
            }).then(onChanged)
          }
        >
          <Trash2 className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>

      <div className="space-y-2 px-4 py-3" data-testid="av-policy-premiums">
        <p className="text-xs font-medium">Versements (répartition PFU)</p>
        <p className="text-meta">
          Pivot fiscal : {PREMIUMS_PFU_CUTOFF_ISO}. Total versé = avant + après
          (pas de saisie manuelle du total).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            Avant le 27/09/2017 (€)
            <input
              type="text"
              inputMode="decimal"
              className="input mt-1 w-36"
              defaultValue={moneyInputValue(p.premiumsBefore2017Eur)}
              key={`${p.id}-before-${p.premiumsBefore2017Eur}`}
              data-testid="av-policy-premiums-before"
              onBlur={(e) => {
                const before = e.target.value;
                const after = moneyInputValue(p.premiumsAfter2017Eur) || "0";
                if (
                  moneyInputValue(before) ===
                  moneyInputValue(p.premiumsBefore2017Eur)
                ) {
                  return;
                }
                void savePremiums(before, after);
              }}
            />
          </label>
          <label className="text-xs">
            À partir du 27/09/2017 (€)
            <input
              type="text"
              inputMode="decimal"
              className="input mt-1 w-36"
              defaultValue={moneyInputValue(p.premiumsAfter2017Eur)}
              key={`${p.id}-after-${p.premiumsAfter2017Eur}`}
              data-testid="av-policy-premiums-after"
              onBlur={(e) => {
                const after = e.target.value;
                const before = moneyInputValue(p.premiumsBefore2017Eur) || "0";
                if (
                  moneyInputValue(after) ===
                  moneyInputValue(p.premiumsAfter2017Eur)
                ) {
                  return;
                }
                void savePremiums(before, after);
              }}
            />
          </label>
          <div className="text-meta" data-testid="av-policy-premiums-total">
            Total versé :{" "}
            {split.ok
              ? formatCurrency(split.totalPremiumsEur, "EUR")
              : "—"}
            {split.ok && Number(split.totalPremiumsEur) > 0
              ? ` · ${(split.beforeShare * 100).toFixed(1)} % avant / ${(split.afterShare * 100).toFixed(1)} % après`
              : ""}
          </div>
        </div>
      </div>
    </section>
  );
}
