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
  "grid w-full min-w-0 gap-2.5 sm:gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,11.25rem),1fr))]";

/**
 * Bandeau des 8 indicateurs — même grille / taille de tuiles sur tous les onglets.
 * Toggle au-dessus des tuiles : masque ou affiche l’intégralité des indicateurs.
 */
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function KpiStrip({
  summary,
  baseCurrency,
  /** Masque alternatifs / épargne / passifs à zéro pour alléger le bandeau */
  smartFilter = false,
}: {
  summary?: Record<string, string | number | unknown>;
  baseCurrency: string;
  smartFilter?: boolean;
}) {
  /** true = afficher les KPI (défaut) */
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

  const alt = num(
    summary?.totalAlternativesBase ?? summary?.totalAlternativesEur
  );
  const es = num(
    summary?.totalEmployeeSavingsBase ?? summary?.totalEmployeeSavingsEur
  );
  const liab = num(
    summary?.totalLiabilitiesBase ?? summary?.totalLiabilitiesEur
  );
  const showAlt = !smartFilter || Math.abs(alt) > 1e-6;
  const showEs = !smartFilter || Math.abs(es) > 1e-6;
  const showLiab = !smartFilter || Math.abs(liab) > 1e-6;

  return (
    <div className="w-full min-w-0 space-y-2" data-testid="kpi-strip">
      <div className="flex items-center justify-between gap-2">
        <p className="text-label hidden sm:block">Indicateurs patrimoniaux</p>
        <button
          type="button"
          onClick={toggleVisible}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium",
            "text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            "motion-reduce:transition-none"
          )}
          data-testid="kpi-toggle-extra"
          aria-expanded={visible}
        >
          {visible ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Masquer
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Afficher les indicateurs
            </>
          )}
        </button>
      </div>

      {visible && (
        <div className={KPI_GRID_CLASS} data-testid="kpi-strip-grid">
          <Kpi
            icon={<Wallet className="h-4 w-4" />}
            label="Cotés"
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
            tone={
              num(summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur) >= 0
                ? "up"
                : "down"
            }
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={
              <span className="inline-flex items-center gap-1">
                Réalisé + revenus
                <FinanceTip term="P&L réalisé" />
              </span>
            }
            value={formatCurrency(
              num(summary?.realizedPnlBase ?? summary?.realizedPnlEur) +
                num(summary?.cashIncomeBase ?? summary?.cashIncomeEur),
              baseCurrency
            )}
            testId="kpi-realized"
          />
          <Kpi
            icon={<Landmark className="h-4 w-4" />}
            label="Cash"
            value={formatCurrency(
              String(summary?.totalCashBase ?? summary?.totalCashEur ?? 0),
              baseCurrency
            )}
            testId="kpi-cash"
          />
          {showAlt && (
            <Kpi
              icon={<Gem className="h-4 w-4" />}
              label="Alternatifs"
              value={formatCurrency(String(alt), baseCurrency)}
              testId="kpi-alternatives"
            />
          )}
          {showEs && (
            <Kpi
              icon={<PiggyBank className="h-4 w-4" />}
              label="Épargne salariale"
              value={formatCurrency(String(es), baseCurrency)}
              testId="kpi-employee-savings"
            />
          )}
          {showLiab && (
            <Kpi
              icon={<Scale className="h-4 w-4" />}
              label="Passifs"
              value={formatCurrency(String(liab), baseCurrency)}
            />
          )}
          <Kpi
            icon={<Coins className="h-4 w-4" />}
            label="Patrimoine net"
            value={formatCurrency(
              String(summary?.netWorthBase ?? summary?.netWorthEur ?? 0),
              baseCurrency
            )}
            tone={
              num(summary?.netWorthBase ?? summary?.netWorthEur) >= 0
                ? "up"
                : "down"
            }
          />
        </div>
      )}
    </div>
  );
}
