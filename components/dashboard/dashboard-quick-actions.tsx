"use client";

import {
  ArrowRight,
  FileUp,
  Layers,
  ListOrdered,
  Plus,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";

export type DashboardNavTarget =
  | "positions"
  | "transactions"
  | "platforms"
  | "import"
  | "transaction";

/**
 * Bandeau d’actions pour compte mature — remplace l’onboarding lourd.
 * Relie le cockpit aux vues détaillées sans surcharge.
 */
export function DashboardQuickActions({
  onNavigate,
  className,
}: {
  onNavigate: (target: DashboardNavTarget) => void;
  className?: string;
}) {
  const items: {
    id: DashboardNavTarget;
    label: string;
    hint: string;
    icon: typeof Plus;
    primary?: boolean;
  }[] = [
    {
      id: "transaction",
      label: "Transaction",
      hint: "Acheter, vendre, dividende…",
      icon: Plus,
      primary: true,
    },
    {
      id: "positions",
      label: "Positions",
      hint: "Tableau des actifs",
      icon: Layers,
    },
    {
      id: "transactions",
      label: "Journal",
      hint: "Toutes les opérations",
      icon: ListOrdered,
    },
    {
      id: "import",
      label: "Importer",
      hint: "CSV courtier",
      icon: FileUp,
    },
    {
      id: "platforms",
      label: "Plateformes",
      hint: "Comptes & sources",
      icon: Wallet,
    },
  ];

  return (
    <section
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] px-3 py-2.5 shadow-[var(--shadow-xs)]",
        className
      )}
      data-testid="dashboard-quick-actions"
      aria-label="Actions rapides"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-heading">Cockpit</h2>
          <p className="text-meta">Accès rapide aux vues essentielles</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 sm:gap-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={item.primary ? "default" : "outline"}
              className={cn(
                "h-8 gap-1.5",
                !item.primary && "border-[var(--border)]"
              )}
              data-testid={`dashboard-action-${item.id}`}
              title={item.hint}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {item.label}
              {item.primary && (
                <ArrowRight className="h-3 w-3 opacity-70" aria-hidden />
              )}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
