"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/app/lib/utils";
import { GettingStartedPanel } from "@/components/onboarding/getting-started";

/**
 * Aide bienvenue — uniquement Tableau de bord.
 * Toggle style « Voir / Masquer les indicateurs » au-dessus du panneau.
 */
export function DashboardHelp({
  visible,
  onToggle,
  hasPlatforms,
  hasHoldings,
  hasTransactions,
  showEveryStart,
  onShowEveryStartChange,
  onAddPlatform,
  onImport,
  onAddTransaction,
}: {
  visible: boolean;
  onToggle: () => void;
  hasPlatforms: boolean;
  hasHoldings: boolean;
  hasTransactions: boolean;
  showEveryStart: boolean;
  onShowEveryStartChange: (v: boolean) => void;
  onAddPlatform: () => void;
  onImport: () => void;
  onAddTransaction: () => void;
}) {
  return (
    <div className="space-y-2" data-testid="dashboard-help">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-[var(--muted)] hover:text-slate-800 dark:hover:text-slate-200"
          )}
          data-testid="onboarding-toggle"
          aria-expanded={visible}
        >
          {visible ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Masquer l&apos;aide
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Voir l&apos;aide
            </>
          )}
        </button>
      </div>

      {visible && (
        <GettingStartedPanel
          compact={false}
          hasPlatforms={hasPlatforms}
          hasHoldings={hasHoldings}
          hasTransactions={hasTransactions}
          showEveryStart={showEveryStart}
          onShowEveryStartChange={onShowEveryStartChange}
          onAddPlatform={onAddPlatform}
          onImport={onImport}
          onAddTransaction={onAddTransaction}
          // Masquer via le chevron au-dessus, pas un second bouton dans le panneau
          onDismiss={undefined}
        />
      )}
    </div>
  );
}
