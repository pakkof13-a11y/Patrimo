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
 *
 * Responsive : wrap mobile (cibles tactiles), rangée horizontale desktop.
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
      label: "Portefeuille",
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
      hint: "Établissements connectés",
      icon: Wallet,
    },
  ];

  return (
    <section
      className={cn(
        "cockpit-panel relative z-[1] rounded-[var(--radius-xl)] border border-[var(--border)]",
        "px-3 py-3",
        "transition-[border-color,box-shadow,background-color] duration-300 ease-in-out",
        "sm:px-4 sm:py-3.5",
        className
      )}
      data-testid="dashboard-quick-actions"
      aria-label="Actions rapides"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 sm:mb-3">
        <div className="min-w-0">
          <h2 className="section-heading section-heading--gold">Cockpit</h2>
          <p className="text-meta">Accès rapide aux vues essentielles</p>
        </div>
      </div>
      <div
        className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-stretch sm:gap-2"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              type="button"
              size="sm"
              variant={item.primary ? "gold" : "outline"}
              className={cn(
                "h-10 min-h-10 w-full justify-center gap-1.5 px-3 text-xs sm:h-9 sm:w-auto sm:min-w-0",
                "rounded-[var(--radius-md)] transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-in-out",
                "active:scale-[0.98] motion-reduce:active:scale-100",
                item.primary
                  ? "cockpit-btn-primary"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--border-strong)] hover:bg-[var(--gold-muted)]"
              )}
              data-testid={`dashboard-action-${item.id}`}
              title={item.hint}
              onClick={() => onNavigate(item.id)}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{item.label}</span>
              {item.primary && (
                <ArrowRight
                  className="hidden h-3 w-3 opacity-70 sm:inline"
                  aria-hidden
                />
              )}
            </Button>
          );
        })}
      </div>
    </section>
  );
}
