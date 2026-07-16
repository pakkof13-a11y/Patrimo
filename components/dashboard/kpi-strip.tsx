"use client";

import { useEffect, useState } from "react";
import {
  Wallet,
  TrendingUp,
  Landmark,
  Coins,
  Scale,
  Gem,
  PiggyBank,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Kpi } from "@/components/ui/kpi";
import { formatCurrency, cn } from "@/app/lib/utils";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import {
  KPI_VISIBLE_KEY,
  loadUiPref,
  saveUiPref,
} from "@/app/lib/ui-preferences";

/**
 * Grille fluide des 8 KPI (CSS Grid auto-fit) :
 * - min ~11.5rem par tuile → wrap élégant (2+ lignes) si l’espace manque
 * - 1fr → les tuiles se partagent l’espace restant sans écrasement
 * - largeur suffisante (≈ 8×11.5rem) → une seule ligne sur desktop XL
 * - min(100%, …) → une colonne pleine largeur sur très petit écran
 */
const KPI_GRID_CLASS =
  "grid w-full min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]";

/**
 * Bandeau des 8 indicateurs — même grille / taille de tuiles sur tous les onglets.
 * Toggle au-dessus des tuiles : masque ou affiche l’intégralité des indicateurs.
 */
export function KpiStrip({
  summary,
  baseCurrency,
}: {
  summary?: Record<string, string | number | unknown>;
  baseCurrency: string;
}) {
  /** true = afficher les 8 KPI (défaut) */
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(loadUiPref(KPI_VISIBLE_KEY, true));
  }, []);

  function toggleVisible() {
    setVisible((v) => {
      const next = !v;
      saveUiPref(KPI_VISIBLE_KEY, next);
      return next;
    });
  }

  return (
    <div className="w-full min-w-0 space-y-2" data-testid="kpi-strip">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={toggleVisible}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-500 transition hover:bg-[var(--muted)] hover:text-slate-800 dark:hover:text-slate-200",
            "motion-reduce:transition-none"
          )}
          data-testid="kpi-toggle-extra"
          aria-expanded={visible}
        >
          {visible ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Masquer les indicateurs
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Voir les indicateurs
            </>
          )}
        </button>
      </div>

      {visible && (
        <div className={KPI_GRID_CLASS} data-testid="kpi-strip-grid">
          <Kpi
            icon={<Wallet className="h-4 w-4" />}
            label="Cotés (positions)"
            value={formatCurrency(
              String(
                summary?.totalMarketValueBase ??
                  summary?.totalMarketValueEur ??
                  0
              ),
              baseCurrency
            )}
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={
              <span className="inline-flex items-center gap-1">
                P&amp;L latent
                <FinanceTip term="P&L latent" />
              </span>
            }
            value={formatCurrency(
              String(
                summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur ?? 0
              ),
              baseCurrency
            )}
            tone={Number(summary?.unrealizedPnlEur ?? 0) >= 0 ? "up" : "down"}
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={
              <span className="inline-flex items-center gap-1">
                P&amp;L réalisé + revenus
                <FinanceTip term="P&L réalisé" />
              </span>
            }
            value={formatCurrency(
              Number(summary?.realizedPnlBase ?? summary?.realizedPnlEur ?? 0) +
                Number(summary?.cashIncomeBase ?? summary?.cashIncomeEur ?? 0),
              baseCurrency
            )}
            testId="kpi-realized"
          />
          <Kpi
            icon={<Landmark className="h-4 w-4" />}
            label="Cash (poches &gt; 0)"
            value={formatCurrency(
              String(summary?.totalCashBase ?? summary?.totalCashEur ?? 0),
              baseCurrency
            )}
            testId="kpi-cash"
          />
          <Kpi
            icon={<Gem className="h-4 w-4" />}
            label="Alternatifs"
            value={formatCurrency(
              String(
                summary?.totalAlternativesBase ??
                  summary?.totalAlternativesEur ??
                  0
              ),
              baseCurrency
            )}
            testId="kpi-alternatives"
          />
          <Kpi
            icon={<PiggyBank className="h-4 w-4" />}
            label="Épargne salariale"
            value={formatCurrency(
              String(
                summary?.totalEmployeeSavingsBase ??
                  summary?.totalEmployeeSavingsEur ??
                  0
              ),
              baseCurrency
            )}
            testId="kpi-employee-savings"
          />
          <Kpi
            icon={<Scale className="h-4 w-4" />}
            label="Passifs"
            value={formatCurrency(
              String(
                summary?.totalLiabilitiesBase ??
                  summary?.totalLiabilitiesEur ??
                  0
              ),
              baseCurrency
            )}
          />
          <Kpi
            icon={<Coins className="h-4 w-4" />}
            label="Patrimoine net"
            value={formatCurrency(
              String(summary?.netWorthBase ?? summary?.netWorthEur ?? 0),
              baseCurrency
            )}
            tone={Number(summary?.netWorthEur ?? 0) >= 0 ? "up" : "down"}
          />
        </div>
      )}
    </div>
  );
}
