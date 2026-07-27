"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Layers, PieChart, Search } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { cn } from "@/app/lib/utils";
import { PropertyPanel } from "@/components/real-estate/property-panel";
import { RentSchedulePanel } from "@/components/real-estate/rent-schedule-panel";
import { RealEstateTaxPanel } from "@/components/real-estate/tax-panel";
import { CapitalGainSimulator } from "@/components/real-estate/capital-gain-simulator";
import { AddressEstimatePanel } from "@/components/real-estate/address-estimate-panel";
import { IndirectPanel } from "@/components/real-estate/indirect-panel";
import type { Holding } from "@/app/lib/types/ui";

type SubTab = "PARC" | "INDIRECT" | "ESTIMATION" | "FISCALITE";

const SUB_NAV: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: "PARC", label: "Parc & exploitation", icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: "INDIRECT", label: "SCPI & sociétés", icon: <Layers className="h-3.5 w-3.5" /> },
  { id: "ESTIMATION", label: "Estimation", icon: <Search className="h-3.5 w-3.5" /> },
  { id: "FISCALITE", label: "Fiscalité", icon: <PieChart className="h-3.5 w-3.5" /> },
];

type TaxProperty = {
  assetId: string;
  label: string;
  purchasePriceEur: string | null;
  purchaseDate: string | null;
  shareValueEur: string;
  isPrimaryResidence: boolean;
};

/**
 * Onglet Immobilier.
 *
 * Deux vues seulement, parce que les biens se lisent à deux échelles
 * différentes et qu'il n'y en a pas de troisième :
 *
 * - **Parc & exploitation** — bien par bien : valeur, dette, rendement,
 *   échéancier de loyers. C'est la vue de gestion courante.
 * - **Fiscalité** — sur l'ensemble : l'IFI s'apprécie au niveau du patrimoine,
 *   et l'arbitrage de régime dépend du total des recettes. Aucun de ces deux
 *   calculs n'a de sens sur une fiche isolée, d'où leur regroupement.
 *
 * Le simulateur de plus-value vit dans la vue fiscale bien qu'il porte sur un
 * bien : ce qu'on y cherche est une décision de cession, pas une donnée de
 * gestion.
 */
export function RealEstateTab({
  holdings,
  className,
}: {
  holdings: Holding[];
  className?: string;
}) {
  const [sub, setSub] = useState<SubTab>("PARC");

  // Chargé uniquement pour le simulateur, qui a besoin du prix de revient et
  // de la date d'acquisition — deux données que `holdings` ne porte pas.
  const taxQ = useQuery({
    queryKey: ["real-estate-tax", 30, false],
    queryFn: () =>
      fetchJson<{ properties: TaxProperty[] }>(
        "/api/real-estate/tax?tmi=30&furnished=false"
      ),
    enabled: sub === "FISCALITE",
  });

  return (
    <div className={cn("space-y-3", className)} data-testid="real-estate-tab">
      <nav
        className="flex flex-wrap gap-1.5"
        aria-label="Vues du module immobilier"
      >
        {SUB_NAV.map((item) => {
          const active = item.id === sub;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSub(item.id)}
              aria-current={active ? "page" : undefined}
              data-testid={`re-subtab-${item.id}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                active
                  ? "border-[var(--primary)]/40 bg-[var(--primary-soft)] text-[var(--foreground)]"
                  : "border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          );
        })}
      </nav>

      {sub === "PARC" ? (
        <>
          <RentSchedulePanel />
          <PropertyPanel holdings={holdings} />
        </>
      ) : sub === "INDIRECT" ? (
        <IndirectPanel />
      ) : sub === "ESTIMATION" ? (
        <AddressEstimatePanel />
      ) : (
        <>
          <RealEstateTaxPanel />
          <CapitalGainSimulator properties={taxQ.data?.properties ?? []} />
        </>
      )}
    </div>
  );
}
