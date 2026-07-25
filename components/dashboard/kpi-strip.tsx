"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  computePeriodLatentFromHistory,
  LATENT_PNL_RANGE_LABELS,
  loadLatentPnlRange,
  type LatentPnlRange,
} from "@/app/lib/portfolio/latent-pnl-prefs";
import type { HistoryPoint } from "@/app/lib/types/ui";

/**
 * Grille du bandeau d'indicateurs — nombre de colonnes fixé par palier
 * (2 → 4 → 8) plutôt que dérivé d'un `auto-fit`.
 *
 * `auto-fit` calait le nombre de colonnes sur la largeur disponible, sans
 * rapport avec le nombre de tuiles : 9 colonnes pour 8 tuiles à 1920 px (une
 * colonne fantôme), et 6 colonnes à 1440 px, donc 2 tuiles orphelines sur une
 * seconde ligne aux quatre cinquièmes vide. Un déséquilibre bien visible sur le
 * bandeau le plus regardé de l'application.
 *
 * Les paliers divisent exactement les 8 tuiles du cas nominal (4 × 2 ou 8 × 1).
 * `smartFilter` peut en masquer jusqu'à trois ; la dernière ligne est alors
 * partiellement remplie, ce qui reste lisible — l'important est qu'on ne se
 * retrouve plus avec une ligne quasi vide alors que la place ne manque pas.
 */
const KPI_GRID_CLASS =
  "grid w-full min-w-0 gap-2.5 sm:gap-3 " +
  "grid-cols-2 md:grid-cols-4 2xl:grid-cols-8"

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
  history,
  /** Masque alternatifs / épargne / passifs à zéro pour alléger le bandeau */
  smartFilter = false,
}: {
  summary?: Record<string, string | number | unknown>;
  baseCurrency: string;
  /** Points d’évolution pour P&L latent de période */
  history?: HistoryPoint[];
  smartFilter?: boolean;
}) {
  /** true = afficher les KPI (défaut) — seed client via lazy + sync event */
  const [visible, setVisible] = useState(() =>
    typeof window !== "undefined" ? loadUiPref(KPI_VISIBLE_KEY, true) : true
  );
  const [latentRange, setLatentRange] = useState<LatentPnlRange>(() =>
    typeof window !== "undefined" ? loadLatentPnlRange() : "all"
  );

  // Écoute changements de préférence (autres onglets / settings) — pas de setState sync init
  useEffect(() => {
    function onPref() {
      setLatentRange(loadLatentPnlRange());
    }
    window.addEventListener("patrimo:latent-pnl-range", onPref);
    window.addEventListener("storage", onPref);
    return () => {
      window.removeEventListener("patrimo:latent-pnl-range", onPref);
      window.removeEventListener("storage", onPref);
    };
  }, []);

  const totalLatent = num(
    summary?.unrealizedPnlBase ?? summary?.unrealizedPnlEur
  );
  const periodLatent = useMemo(() => {
    if (!history?.length) return null;
    return computePeriodLatentFromHistory(history, latentRange);
  }, [history, latentRange]);
  const latentValue =
    latentRange === "all" || periodLatent == null ? totalLatent : periodLatent;
  const latentLabel =
    latentRange === "all"
      ? "P&L latent"
      : `P&L latent (${LATENT_PNL_RANGE_LABELS[latentRange]})`;

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
    <div
      className="w-full min-w-0 space-y-2.5 pb-0.5"
      data-testid="kpi-strip"
    >
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
                {latentLabel}
                <FinanceTip term="P&L latent" />
              </span>
            }
            value={formatCurrency(String(latentValue), baseCurrency)}
            tone={latentValue >= 0 ? "up" : "down"}
            testId="kpi-latent"
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
            accent
            testId="kpi-net-worth"
          />
        </div>
      )}
    </div>
  );
}
