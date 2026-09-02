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
  Building2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
} from "lucide-react";
import { Kpi } from "@/components/ui/kpi";
import { formatCurrency, cn, MONTANT_INCONNU } from "@/app/lib/utils";
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
import {
  maskAmount,
  useAmountsHidden,
} from "@/app/lib/ui/privacy-prefs";
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
 * 10 tuiles au cas nominal (4 × 2 + 2, ou 8 × 1 + 2) : `smartFilter` ne
 * masque plus les tuiles à ~0 (alt / ES / passifs / immo / AV) — il les
 * garde montées et les efface visuellement (`muted`), pour ne pas faire
 * varier le nombre de tuiles au fil des chargements.
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
  loading = false,
  /** Variante terminal (Dashboard uniquement) : flèche de tendance sur les tuiles */
  dashboardStyle = false,
}: {
  summary?: Record<string, string | number | unknown>;
  baseCurrency: string;
  /** Points d’évolution pour P&L latent de période */
  history?: HistoryPoint[];
  smartFilter?: boolean;
  /**
   * Données du bandeau pas encore arrivées.
   *
   * Sans cette information, `summary` absent produisait `0,00 €` sur les dix
   * tuiles — dont le patrimoine net — parce que le formatage retombait sur
   * zéro. Un montant nul affiché comme un fait alors que la requête est encore
   * en vol est faux, et c'est le chiffre que l'on vient lire en premier.
   *
   * Distinct d'un zéro réel : une fois les données arrivées, un patrimoine
   * réellement nul s'affiche bien `0,00 €`.
   */
  loading?: boolean;
  dashboardStyle?: boolean;
}) {
  /** true = afficher les KPI (défaut) — seed client via lazy + sync event */
  const [visible, setVisible] = useState(() =>
    typeof window !== "undefined" ? loadUiPref(KPI_VISIBLE_KEY, true) : true
  );
  const [latentRange, setLatentRange] = useState<LatentPnlRange>(() =>
    typeof window !== "undefined" ? loadLatentPnlRange() : "all"
  );
  const [amountsHidden, setAmountsHidden] = useAmountsHidden();

  /**
   * Formatage des montants du bandeau, masque compris.
   *
   * Le masque s'applique après le formatage et jamais sur la valeur : la
   * substitution garde une longueur fixe, sinon la largeur de la tuile
   * laisserait deviner l'ordre de grandeur qu'on cherche à cacher.
   */
  /** Placeholder d'un montant inconnu — partagé avec les autres bandes. */
  const zeroValue = MONTANT_INCONNU;

  /**
   * Absence de données, une fois le chargement terminé.
   *
   * Ce n'est pas la même chose qu'un zéro : si `summary` manque encore après
   * la requête — erreur réseau, réponse vide — aucun montant n'est connu, et
   * l'afficher à zéro serait une affirmation. On reprend le placeholder que le
   * bandeau utilise déjà pour ses tuiles sans contenu.
   */
  const hasSummary = summary != null;

  /*
    `?? 0` reste, mais n'est plus jamais atteint avec une donnée manquante :
    les deux gardes ci-dessus interceptent le cas avant le formatage. Il ne
    couvre plus qu'un champ absent d'un `summary` par ailleurs présent, où
    zéro est la bonne réponse.
  */
  const money = (value: unknown) =>
    hasSummary
      ? maskAmount(formatCurrency(String(value ?? 0), baseCurrency), amountsHidden)
      : zeroValue;

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
  const realEstate = num(
    summary?.totalRealEstateBase ?? summary?.totalRealEstateEur
  );
  const lifeInsurance = num(
    summary?.totalLifeInsuranceBase ?? summary?.totalLifeInsuranceEur
  );
  // smartFilter n'unmount plus les tuiles à ~0 (évite le va-et-vient de la
  // grille au fil des chargements) — elles restent visibles, effacées via
  // `muted` sur la tuile (voir Kpi).
  /*
    `smartFilter` estompe les tuiles à ~0. Pendant le chargement, toutes les
    valeurs valent 0 : sans cette garde, la moitié du bandeau apparaîtrait
    effacée avant de reprendre vie — exactement le va-et-vient que le maintien
    des tuiles montées cherche à éviter.
  */
  const mutedAlt = !loading && smartFilter && Math.abs(alt) <= 1e-6;
  const mutedEs = !loading && smartFilter && Math.abs(es) <= 1e-6;
  const mutedLiab = !loading && smartFilter && Math.abs(liab) <= 1e-6;
  const mutedRealEstate = !loading && smartFilter && Math.abs(realEstate) <= 1e-6;
  const mutedLifeInsurance = !loading && smartFilter && Math.abs(lifeInsurance) <= 1e-6;

  return (
    <div
      className="w-full min-w-0 space-y-2.5 pb-0.5"
      data-testid="kpi-strip"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-label hidden sm:block">Indicateurs patrimoniaux</p>

        {/*
          Confidentialité : un clic masque tous les montants, un clic les
          rend. Placé au-dessus des tuiles, là où se pose le regard avant de
          tourner l'écran vers quelqu'un — un réglage enfoui dans les
          préférences arriverait toujours trop tard.
        */}
        <button
          type="button"
          onClick={() => setAmountsHidden(!amountsHidden)}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-[11px] font-medium",
            "transition hover:bg-[var(--muted)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            "motion-reduce:transition-none",
            amountsHidden
              ? "text-[var(--primary-text)]"
              : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
          )}
          data-testid="kpi-privacy-toggle"
          aria-pressed={amountsHidden}
          title={
            amountsHidden
              ? "Afficher les montants"
              : "Masquer les montants (confidentialité)"
          }
          aria-label={
            amountsHidden ? "Afficher les montants" : "Masquer les montants"
          }
        >
          {amountsHidden ? (
            <EyeOff className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Eye className="h-3.5 w-3.5" aria-hidden />
          )}
          <span className="hidden sm:inline">
            {amountsHidden ? "Montants masqués" : "Masquer les montants"}
          </span>
        </button>

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
            value={money(
              summary?.totalMarketValueBase ?? summary?.totalMarketValueEur
            )}
            loading={loading}
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={
              <span className="inline-flex items-center gap-1">
                {latentLabel}
                <FinanceTip term="P&L latent" />
              </span>
            }
            value={money(latentValue)}
            tone={latentValue >= 0 ? "up" : "down"}
            testId="kpi-latent"
            loading={loading}
            variant={dashboardStyle ? "terminal" : "default"}
          />
          <Kpi
            icon={<TrendingUp className="h-4 w-4" />}
            label={
              <span className="inline-flex items-center gap-1">
                Réalisé + revenus
                <FinanceTip term="P&L réalisé" />
              </span>
            }
            value={money(
              num(summary?.realizedPnlBase ?? summary?.realizedPnlEur) +
                num(summary?.cashIncomeBase ?? summary?.cashIncomeEur)
            )}
            testId="kpi-realized"
            loading={loading}
          />
          <Kpi
            icon={<Landmark className="h-4 w-4" />}
            label="Cash"
            value={money(summary?.totalCashBase ?? summary?.totalCashEur)}
            testId="kpi-cash"
            loading={loading}
          />
          <Kpi
            icon={<Gem className="h-4 w-4" />}
            label="Alternatifs"
            value={mutedAlt ? zeroValue : money(alt)}
            muted={mutedAlt}
            testId="kpi-alternatives"
            loading={loading}
          />
          <Kpi
            icon={<PiggyBank className="h-4 w-4" />}
            label="Épargne salariale"
            value={mutedEs ? zeroValue : money(es)}
            muted={mutedEs}
            testId="kpi-employee-savings"
            loading={loading}
          />
          <Kpi
            icon={<Building2 className="h-4 w-4" />}
            label="Immobilier"
            value={
              mutedRealEstate
                ? zeroValue
                : money(realEstate)
            }
            muted={mutedRealEstate}
            testId="kpi-real-estate"
            loading={loading}
          />
          <Kpi
            icon={<ShieldCheck className="h-4 w-4" />}
            label="Assurance-vie"
            value={
              mutedLifeInsurance
                ? zeroValue
                : money(lifeInsurance)
            }
            muted={mutedLifeInsurance}
            testId="kpi-life-insurance"
            loading={loading}
          />
          <Kpi
            icon={<Scale className="h-4 w-4" />}
            label="Passifs"
            value={mutedLiab ? zeroValue : money(liab)}
            muted={mutedLiab}
            testId="kpi-liabilities"
            loading={loading}
          />
          <Kpi
            icon={<Coins className="h-4 w-4" />}
            label="Patrimoine net"
            value={money(summary?.netWorthBase ?? summary?.netWorthEur)}
            tone={
              num(summary?.netWorthBase ?? summary?.netWorthEur) >= 0
                ? "up"
                : "down"
            }
            accent
            testId="kpi-net-worth"
            loading={loading}
            variant={dashboardStyle ? "terminal" : "default"}
          />
        </div>
      )}
    </div>
  );
}
