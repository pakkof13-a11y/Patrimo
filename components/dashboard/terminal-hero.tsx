"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import { maskAmount, useAmountsHidden } from "@/app/lib/ui/privacy-prefs";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { Sparkline } from "@/components/ui/sparkline";
import type { EvolutionRange } from "@/app/lib/portfolio/evolution-aggregate";
import {
  grossAssetsAt,
  kpiSeries,
  netWorthAt,
} from "@/app/lib/portfolio/kpi-series";

/**
 * Montant sans symbole ni décimales — réservé au chiffre de tête.
 *
 * Le code devise est affiché à côté comme libellé (mockup), et les centimes
 * n'apportent rien à 60 px : sur un patrimoine à six chiffres, ils ajoutent du
 * bruit là où on cherche un ordre de grandeur.
 */
function formatHeadline(v: number): string {
  return Math.round(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 });
}

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

type HeroMode = "net" | "gross";

/** Ce que chaque mode désigne — libellé du contrôle, pas du titre. */
const HERO_MODE_LABEL: Record<HeroMode, string> = {
  net: "Net",
  gross: "Brut",
};

const HERO_MODE_TITLE: Record<HeroMode, string> = {
  net: "Actifs moins passifs",
  gross: "Total des actifs, passifs non déduits",
};

/**
 * Carte de tête — le patrimoine total, net ou brut selon le sélecteur.
 *
 * C'est le seul chiffre de l'écran qui a droit à `--text-5xl` : la hiérarchie
 * du tableau de bord tient entièrement à ce qu'aucun autre nombre ne vienne
 * lui disputer le premier regard.
 *
 * Net/Brut ne recalcule rien : les deux valeurs viennent telles quelles du
 * même `summary` que le reste du tableau de bord (`netWorthBase`,
 * `totalGrossAssetsBase`), et les deux courbes des champs que le moteur publie
 * pour ces mêmes grandeurs (`netWorthBase`, `grossAssetsBase`). Le mode change
 * donc la valeur **et** la courbe ensemble — afficher un montant net au-dessus
 * d'une trajectoire brute était le défaut de la version précédente.
 *
 * **Cette carte ignore délibérément le sélecteur de période du tableau de
 * bord.** Elle répond à « où en est le patrimoine, et d'où vient-il », qui n'a
 * pas de fenêtre : la courbe part du premier point disponible, toujours. Les
 * questions à horizon — sur un mois, sur un an — sont celles du bandeau
 * d'indicateurs et du graphique d'évolution, qui, eux, suivent le sélecteur.
 * C'est aussi pourquoi la carte n'affiche aucune variation : une variation sans
 * période affichée ne veut rien dire, et en remettre une ici rouvrirait la
 * question de la fenêtre.
 *
 * Le graphique de droite est délibérément sans axe ni graduation. Il ne sert
 * pas à lire une valeur — la carte « Évolution du portefeuille », plus bas,
 * s'en charge — mais à donner la forme du trajet en moins d'une seconde.
 */
export function TerminalHero({
  netWorth,
  grossAssets,
  history,
  baseCurrency,
  loading,
}: {
  netWorth: number | null;
  /** Somme des actifs, sans déduction des passifs. */
  grossAssets: number | null;
  history: HistoryPoint[];
  baseCurrency: string;
  loading?: boolean;
}) {
  const [mode, setMode] = useState<HeroMode>("net");
  const [amountsHidden] = useAmountsHidden();

  const displayValue = mode === "net" ? netWorth : grossAssets;

  /*
    L'historique entier, sans fenêtrage d'aucune sorte.

    Aucun `range`, aucun `slice`, aucun nombre de points : la série est
    l'historique tel qu'il arrive, du premier point disponible à aujourd'hui.
    C'est ce qui rend la carte insensible au sélecteur global, et un test le
    vérifie plutôt que de s'en remettre à la lecture du code.

    `kpiSeries` porte la même règle qu'ailleurs : si un point ne contient pas la
    grandeur, la série est déclarée inconnue au lieu d'être comblée par des
    zéros. Une carte sans courbe vaut mieux qu'une courbe qui ne décrit rien.
  */
  const values = useMemo(
    () => kpiSeries(history, mode === "net" ? netWorthAt : grossAssetsAt),
    [history, mode]
  );

  const stroke =
    mode === "net" ? "var(--chart-gold)" : "var(--chart-cyan)";

  return (
    <section
      className="panel px-[var(--pad-card-lg)] py-[var(--pad-card-lg)]"
      data-testid="terminal-hero"
      aria-labelledby="hero-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-5)]">
        {/* ── Chiffre de tête ── */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            {/*
              Le titre ne change plus avec le mode : « Patrimoine net » puis
              « Patrimoine brut » faisaient croire à deux cartes selon le
              bouton pressé. Ce qu'on regarde est le patrimoine total ; net ou
              brut n'en est qu'une lecture, et c'est le sélecteur qui la porte.
            */}
            <h2 id="hero-heading" className="text-label">
              Patrimoine total
            </h2>

            <div
              className="term-seg"
              role="tablist"
              aria-label="Patrimoine net ou brut"
              data-testid="hero-mode-toggle"
            >
              {(["net", "gross"] as HeroMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  data-active={mode === m}
                  title={HERO_MODE_TITLE[m]}
                  className="term-seg-item"
                  data-testid={`hero-mode-${m}`}
                  onClick={() => setMode(m)}
                >
                  {HERO_MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-[var(--space-3)] flex flex-wrap items-baseline gap-[var(--space-3)]">
            {loading && displayValue === null ? (
              <span
                className="num block h-[var(--text-4xl)] w-[14rem] rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]"
                aria-hidden
              />
            ) : (
              <span
                className={cn(
                  "num text-[length:var(--text-4xl)] font-semibold leading-none",
                  "tracking-[var(--tracking-tighter)] text-[var(--foreground)]",
                  "sm:text-[length:var(--text-5xl)]"
                )}
                data-testid="hero-net-worth"
              >
                {displayValue === null
                  ? "—"
                  : maskAmount(formatHeadline(displayValue), amountsHidden)}
              </span>
            )}
            <span className="text-label">{baseCurrency}</span>
          </div>

          {/*
            Ce qu'on lit, dit en toutes lettres.

            Remplace la variation de période, qui n'a plus d'objet ici : la
            courbe n'a pas de fenêtre, donc aucune variation ne peut en être
            rapportée sans inventer un horizon. Ce que la carte doit annoncer,
            c'est l'étendue de ce qu'elle montre.
          */}
          <p
            className="mt-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--foreground-secondary)]"
            data-testid="hero-scope"
          >
            {HERO_MODE_TITLE[mode]}
            {values && (
              <>
                <span className="mx-[var(--space-2)] text-[var(--foreground-faint)]">
                  ·
                </span>
                depuis l&apos;origine de l&apos;historique
              </>
            )}
          </p>
        </div>

        {/* ── Graphique — historique entier, sans sélecteur ── */}
        <div className="flex min-w-0 flex-1 flex-col items-end gap-[var(--space-3)]">
          <div className="h-[5.5rem] w-full min-w-0 sm:h-[6.5rem]">
            {values && values.length >= 2 ? (
              <Sparkline
                values={values}
                stroke={stroke}
                fill
                width={640}
                height={104}
                strokeWidth={2}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full items-center justify-end text-[length:var(--text-xs)] text-[var(--foreground-faint)]">
                Pas encore de courbe
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Un indicateur de la rangée KPI. */
export type TerminalKpi = {
  key: string;
  label: string;
  value: number;
  /** Série d'historique — omise quand aucune donnée réelle n'existe. */
  spark?: number[];
  /** Teinte du trait ; par défaut dérivée du signe de la variation. */
  tone?: "gold" | "positive" | "negative" | "cyan" | "neutral";
  /**
   * Variation en montant sur la période, si calculable.
   *
   * `null` — et non zéro — quand la série manque ou ne porte qu'un point :
   * « on ne sait pas » et « rien n'a bougé » ne s'affichent pas pareil.
   */
  changeAbs?: number | null;
  /** Variation en % sur la période, si calculable. */
  changePct?: number | null;
};

const TONE_STROKE: Record<string, string> = {
  gold: "var(--chart-gold)",
  positive: "var(--chart-positive)",
  negative: "var(--chart-negative)",
  cyan: "var(--chart-cyan)",
  neutral: "var(--chart-neutral)",
};

/**
 * Rangée d'indicateurs.
 *
 * Toutes les tuiles partagent la même hauteur, y compris celles qui n'ont pas
 * de sparkline : la zone du graphique est réservée en toutes circonstances.
 * Sans cela, les trois indicateurs sans historique (alternatifs, épargne
 * salariale, passifs) créeraient un décrochement dans la grille.
 *
 * La rangée ne choisit pas sa période : elle la reçoit du tableau de bord, la
 * même que celle de la courbe d'évolution, et se contente de l'annoncer.
 */
export function TerminalKpiRow({
  items,
  baseCurrency,
  range,
}: {
  items: TerminalKpi[];
  baseCurrency: string;
  /**
   * Période sur laquelle les séries et les variations ont été construites.
   *
   * Requise, et non optionnelle : c'est le contrat de ce composant depuis que
   * la période est partagée. Un appelant qui l'oublierait afficherait des
   * variations dont personne ne saurait dire sur quelle tranche de temps elles
   * portent — ce que ce chantier vient précisément de corriger.
   *
   * Reportée en `data-range` : c'est la seule façon de vérifier de l'extérieur
   * que les tuiles et la courbe parlent bien de la même période, les deux blocs
   * ne partageant aucun texte à l'écran.
   */
  range: EvolutionRange;
}) {
  const [amountsHidden, setAmountsHidden] = useAmountsHidden();

  return (
    <div className="min-w-0 space-y-[var(--space-2)]">
      {/*
        Bascule de confidentialité, au-dessus des indicateurs : c'est là que
        se pose le regard juste avant de tourner l'écran vers quelqu'un. Un
        réglage rangé dans les préférences arriverait toujours trop tard.
      */}
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <p className="text-label hidden sm:block">Indicateurs</p>
        <button
          type="button"
          onClick={() => setAmountsHidden(!amountsHidden)}
          data-testid="privacy-toggle"
          aria-pressed={amountsHidden}
          title={
            amountsHidden
              ? "Afficher les montants"
              : "Masquer les montants (confidentialité)"
          }
          aria-label={
            amountsHidden ? "Afficher les montants" : "Masquer les montants"
          }
          className={cn(
            "ml-auto inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-md)]",
            "px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-2xs)] font-medium",
            "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)]",
            "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
            amountsHidden
              ? "text-[var(--primary-text)]"
              : "text-[var(--foreground-faint)] hover:text-[var(--foreground)]"
          )}
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
      </div>

      <div
        className={cn(
          "grid min-w-0 gap-[var(--gap-card)]",
          "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
        )}
        data-testid="terminal-kpi-row"
        data-range={range}
      >
      {items.map((item) => {
        /*
          Montant et pourcentage décrivent la même variation, sur la même
          période et la même série. L'un peut manquer sans l'autre : un
          pourcentage n'est pas définissable sur une série partie de zéro,
          alors que l'écart en euros, lui, l'est toujours.
        */
        const abs =
          typeof item.changeAbs === "number" && Number.isFinite(item.changeAbs)
            ? item.changeAbs
            : null;
        const pct =
          typeof item.changePct === "number" && Number.isFinite(item.changePct)
            ? item.changePct
            : null;
        const signed = abs !== null || pct !== null;
        // Le sens du mouvement se lit d'abord sur le montant : il est défini
        // même là où le pourcentage ne l'est pas.
        const up = abs !== null ? abs >= 0 : pct !== null ? pct >= 0 : false;
        const tone =
          item.tone ?? (signed ? (up ? "positive" : "negative") : "neutral");
        return (
          <article
            key={item.key}
            className="kpi-tile flex flex-col gap-[var(--space-2)] p-[var(--pad-card)]"
            data-testid={`kpi-${item.key}`}
          >
            <h3 className="text-label truncate" title={item.label}>
              {item.label}
            </h3>

            <p
              className={cn(
                "num text-[length:var(--text-xl)] font-semibold leading-none",
                item.tone === "gold"
                  ? "text-[var(--primary-text)]"
                  : "text-[var(--foreground)]"
              )}
            >
              {maskAmount(
                formatCurrency(item.value, baseCurrency),
                amountsHidden
              )}
            </p>

            <p
              className={cn(
                "flex min-w-0 items-baseline gap-[var(--space-1)]",
                "text-[length:var(--text-xs)] leading-none"
              )}
              data-testid={`kpi-${item.key}-change`}
            >
              {signed ? (
                <>
                  {abs !== null && (
                    <span
                      className={cn(
                        "num truncate",
                        up ? "val-positive" : "val-negative"
                      )}
                    >
                      {abs >= 0 ? "+" : "−"}
                      {maskAmount(
                        formatCurrency(Math.abs(abs), baseCurrency),
                        amountsHidden
                      )}
                    </span>
                  )}
                  {abs !== null && pct !== null && (
                    <span className="text-[var(--foreground-faint)]">·</span>
                  )}
                  {pct !== null && (
                    <span
                      className={cn(
                        "num shrink-0",
                        up ? "val-positive" : "val-negative"
                      )}
                    >
                      {formatPct(pct)}
                    </span>
                  )}
                </>
              ) : (
                /*
                  Ni montant ni pourcentage : l'historique ne porte pas cette
                  grandeur sur la période. Un tiret le dit ; « 0 % » l'aurait
                  nié.
                */
                <span className="text-[var(--foreground-faint)]">—</span>
              )}
            </p>

            {/* Hauteur réservée même sans série : garde la grille d'aplomb. */}
            <div className="mt-auto h-[1.75rem] w-full pt-[var(--space-1)]">
              {item.spark && item.spark.length >= 2 && (
                <Sparkline
                  values={item.spark}
                  stroke={TONE_STROKE[tone] ?? TONE_STROKE.neutral!}
                  width={180}
                  height={28}
                  className="h-full w-full"
                />
              )}
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}
