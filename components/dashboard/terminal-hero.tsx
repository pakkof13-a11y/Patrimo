"use client";

import { useMemo, useState } from "react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { endOfParisDay } from "@/app/lib/dates/paris";
import { Eye, EyeOff, ChevronDown, ChevronUp } from "lucide-react";
import { maskAmount, useAmountsHidden } from "@/app/lib/ui/privacy-prefs";
import { loadUiPref, saveUiPref } from "@/app/lib/ui-preferences";
import type { HistoryPoint } from "@/app/lib/types/ui";
import { Sparkline } from "@/components/ui/sparkline";
import { RangeChips } from "@/components/dashboard/range-chips";
import {
  financierAt,
  grossAssetsAt,
  kpiSeries,
  netWorthAt,
} from "@/app/lib/portfolio/kpi-series";
import { buildHeroSeries, type HeroMode } from "@/app/lib/portfolio/hero-series";
import {
  isEvolutionRangeEnabled,
  windowForRange,
  type EvolutionRange,
} from "@/app/lib/portfolio/evolution-aggregate";
import {
  heroPeriodLabel,
  heroWindowChange,
  heroWindowReference,
} from "@/app/lib/portfolio/hero-range";
import {
  EVOLUTION_RANGE_CHIPS as RANGES,
  evolutionRangePeriodLabel,
} from "@/app/lib/ui/evolution-ranges";
import {
  heroAttribution,
  heroEventMarkers,
} from "@/app/lib/portfolio/hero-attribution";
import { useHeroChartHover } from "@/app/hooks/use-hero-chart-hover";
import { HeroChart } from "@/components/dashboard/hero-chart";
import {
  formatDayMonthParis,
  formatHeroAmount,
  formatLongDateParis,
  formatShortDateParis,
  formatSignedAmount,
  formatSignedPct,
  formatValuationTimeParis,
} from "@/app/lib/ui/hero-format";
import {
  HERO_NAV_SCOPE_HEADING,
  HERO_NAV_SCOPE_LABEL,
  HERO_NAV_SCOPE_TITLE,
  heroModeHelpLine,
} from "@/app/lib/portfolio/daily-nav-view";

function formatPct(v: number): string {
  return formatSignedPct(v);
}

function pickerFor(mode: HeroMode) {
  if (mode === "financier") return financierAt;
  if (mode === "net") return netWorthAt;
  return grossAssetsAt;
}

/**
 * Les deux cartes que la carte de tête montre désormais — Financier a quitté
 * l'écran (D19). `scope=financier` reste lisible côté données
 * (`daily-nav-view.ts`, `hero-series.ts`) ; ce tableau ne pilote que l'affichage.
 */
const HERO_CARD_MODES = ["net", "brut"] as const;
type HeroCardMode = (typeof HERO_CARD_MODES)[number];

/**
 * Ramène une carte disparue vers un mode encore affiché.
 *
 * Une préférence enregistrée avant D19 peut encore valoir `financier` — c'est
 * la seule provenance possible, plus aucun contrôle ne l'écrit. La rejouer
 * telle quelle pointerait le hero sur une carte qui n'existe plus : ni bouton
 * actif dans le sélecteur, ni titre à afficher. On retombe sur `net`, le
 * défaut le plus sûr, plutôt que de laisser l'écran vide.
 */
function toDisplayedMode(mode: HeroMode): HeroCardMode {
  return mode === "financier" ? "net" : mode;
}

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
 * ## Période
 *
 * S2 : un **seul** sélecteur (panneau Évolution), partagé avec le hero et
 * les KPI. Les trois lisent `getDailyNav` sur la même fenêtre — changer de
 * période recoupe la série dense, sans changer sa texture quotidienne.
 *
 * ## Ce que la carte affiche, et quand
 *
 * - **Hors survol** : le chiffre est la valorisation courante, et la ligne en
 *   dessous porte le Δ de la fenêtre — montant, pourcentage, libellé de
 *   période. Si `heroAttribution` aboutit, deux pastilles disent d'où vient ce
 *   Δ : Marché et Flux. Elles disparaissent ensemble quand l'historique ne
 *   publie pas les flux, plutôt que d'annoncer un « Flux 0 € » qui affirmerait
 *   qu'aucun capital n'est entré.
 * - **Au survol** : le chiffre suit le point désigné, et le Δ de fenêtre est
 *   **caché sans être démonté** — sa boîte reste réservée, faute de quoi la
 *   carte se contracte sous le curseur et le survol se perd. Le Δ d'un jour à
 *   l'autre, lui, vit dans l'info-bulle : les deux ne répondent pas à la même
 *   question et les réunir sous le même chiffre les rendrait illisibles.
 *
 * Le graphique reste sans axe ni graduation : il ne sert pas à lire une valeur
 * — l'info-bulle s'en charge, et la carte « Évolution du portefeuille » plus
 * bas également — mais à donner la forme du trajet en moins d'une seconde. Son
 * échelle verticale est cadrée sur la fenêtre par `sparklineGeometry`, sans
 * base zéro imposée : sur un mois, quinze mille euros de mouvement sur deux
 * millions doivent rester visibles.
 */
export function TerminalHero({
  netWorth,
  grossAssets,
  // Non lu ici depuis D19 (Financier a quitté le hero) ; conservé côté
  // signature, `dashboard-tab.tsx` continue de le calculer pour d'autres
  // usages de `scope=financier`.
  financier: _financier,
  history,
  baseCurrency,
  loading,
  scope,
  onScopeChange,
  range,
  onRangeChange,
  firstHistoryDate,
  servedNavFrom,
}: {
  netWorth: number | null;
  /** Somme des actifs, sans déduction des passifs. */
  grossAssets: number | null;
  /**
   * Agrégat T-01 Financier.
   *
   * N'alimente plus aucune carte à l'écran depuis D19 : Financier a quitté le
   * hero. Le prop reste dans la signature parce que `dashboard-tab.tsx`
   * continue de le calculer pour d'autres lecteurs de `scope=financier` — pas
   * pour être rendu ici.
   */
  financier: number | null;
  history: HistoryPoint[];
  baseCurrency: string;
  loading?: boolean;
  /**
   * Carte active — net ou brut. Peut encore valoir `financier` si une
   * préférence antérieure à D19 est rejouée telle quelle ; `toDisplayedMode`
   * la retombe alors sur `net`.
   */
  scope: HeroMode;
  onScopeChange: (scope: HeroMode) => void;
  /**
   * Période partagée avec l'évolution et les KPI.
   * Un seul sélecteur (panneau Évolution) ; la carte de tête fenêtre la
   * même série `getDailyNav`.
   */
  range: EvolutionRange;
  /**
   * Change la période partagée. Même setter que le panneau Évolution
   * (`changeRange` dans `dashboard-tab.tsx`) — un clic ici déplace aussi le
   * sélecteur du bas, et persiste sous `evolutionPrefs.v5`.
   */
  onRangeChange: (range: EvolutionRange) => void;
  /**
   * Première date de l'historique complet (non fenêtré), pour désactiver
   * les chips que la profondeur disponible ne couvre pas encore. Même
   * source et même règle que le panneau (`isEvolutionRangeEnabled`).
   */
  firstHistoryDate: string | null;
  /**
   * Borne `from` **servie** par daily-nav. Le libellé de période la lit,
   * jamais la borne demandée ni une réponse 1A encore en vol.
   */
  servedNavFrom?: string;
}) {
  /*
    Financier a quitté l'écran (D19) : la carte, le chip et tout ce qui les
    exposait à l'utilisateur ont disparu. `scope` peut malgré tout encore
    valoir `financier` — une préférence enregistrée avant ce chantier — et
    `toDisplayedMode` la ramène alors sur `net` plutôt que de laisser le hero
    pointer une carte qu'on ne rend plus.
  */
  const mode = toDisplayedMode(scope);
  const [amountsHidden] = useAmountsHidden();

  const currentValue = mode === "net" ? netWorth : grossAssets;

  /*
    L'historique, coupé à la période partagée.

    Le fenêtrage est celui du tableau de bord (`windowForRange`) : même
    série `getDailyNav`, même fenêtre que l'évolution et les KPI. Le point
    qui précède la fenêtre reste en tête pour le Δ.
  */
  const windowed = useMemo(
    () => windowForRange(history, range, heroWindowReference(history)),
    [history, range]
  );

  /*
    `kpiSeries` porte la même règle qu'ailleurs : si un point ne contient pas la
    grandeur, la série est déclarée inconnue au lieu d'être comblée par des
    zéros. Une carte sans courbe vaut mieux qu'une courbe qui ne décrit rien.
  */
  const values = useMemo(
    () => kpiSeries(windowed, pickerFor(mode)),
    [windowed, mode]
  );

  /*
    Chips de période — même règle d'activation que le panneau Évolution
    (`isEvolutionRangeEnabled`), sur la profondeur réelle de l'historique et
    non sur la fenêtre déjà découpée.
  */
  const rangeEnabled = useMemo(() => {
    const map = {} as Record<EvolutionRange, boolean>;
    for (const r of RANGES) {
      map[r.id] = isEvolutionRangeEnabled(r.id, firstHistoryDate);
    }
    return map;
  }, [firstHistoryDate]);

  /*
    Net et Brut partagent désormais le même vert (D19) : la couleur portait
    jusqu'ici une distinction de périmètre (or pour Financier, cyan pour
    Brut) que la disparition de la carte Financier rend caduque. Une seule
    teinte, la verte du projet — celle qu'on lisait déjà sur les tuiles KPI
    positives.
  */
  const stroke = "var(--chart-positive)";

  /*
    Série lisible — la même que celle tracée, augmentée de quoi la décrire.

    Reconstruite au changement de mode : le sélecteur ne change pas seulement
    la couleur du trait, il change la grandeur, donc les montants, les écarts
    et la décomposition que l'info-bulle rapporte.
  */
  const series = useMemo(
    () => buildHeroSeries(windowed, values, mode),
    [windowed, values, mode]
  );

  /*
    Variation de la période affichée — la ligne sous le chiffre.

    Elle décrit toujours la fenêtre courante : changer de chip recoupe la
    série, donc la recalcule. Le Δ face au point précédent reste dans
    l'info-bulle ; les deux répondent à deux questions, et les réunir sous le
    même chiffre les rendrait illisibles.
  */
  const windowChange = useMemo(
    () => (values ? heroWindowChange(values) : null),
    [values]
  );

  /** Passifs en fin de fenêtre — « dont passifs », en mode net seulement. */
  const liabilitiesNow = useMemo(() => {
    if (mode !== "net") return undefined;
    const v = windowed[windowed.length - 1]?.liabilitiesBase;
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  }, [windowed, mode]);

  /*
    Origine affichée : `from` servi, pas `history[0]` (fenêtre 1A encore
    à l'écran) ni la borne demandée. Absent tant que la réponse n'est pas
    posée — mieux qu'un flash « sept. 2025 » puis « oct. 2022 ».
  */
  const periodOriginIso = servedNavFrom
    ? endOfParisDay(servedNavFrom).toISOString()
    : undefined;
  /*
    Une seule chaîne : `daily-nav.from` servi / `points[0].day`. Vide tant
    que « Tout » n'a pas sa réponse — pas le from 1A encore en vol.
  */
  const periodLabel = heroPeriodLabel(range, periodOriginIso);

  /*
    D'où vient la variation : du marché, ou des capitaux apportés.

    Calculée hors du composant, dans un utilitaire pur qui porte la définition
    et ses cas limites. `null` quand l'historique ne publie pas les flux — les
    deux pastilles disparaissent alors, et seule la variation reste. « Flux
    0 € » affirmerait qu'aucun capital n'est entré, ce qu'on ne sait pas.
  */
  const attribution = useMemo(
    () => heroAttribution(windowed, mode),
    [windowed, mode]
  );

  /*
    Repères des mouvements de capitaux, au plus cinq.

    Ils expliquent les marches que la courbe montre sans les justifier. Les
    autres journées à flux restent atteignables au survol, où l'info-bulle les
    nomme — c'est ce qui évite deux cents pastilles sur dix ans d'historique.
  */
  const markers = useMemo(
    () =>
      heroEventMarkers(
        series.map((p) => ({ index: p.index, amount: p.externalFlow }))
      ),
    [series]
  );

  const hover = useHeroChartHover(series);
  const active = hover.activePoint;

  /*
    Le chiffre de tête suit le curseur, et rien d'autre ne bouge.

    Hors survol il reprend la valorisation courante — celle du résumé, pas le
    dernier point de la courbe : les deux coïncident presque toujours, mais
    c'est le résumé qui fait foi pour « aujourd'hui », et c'est lui que le reste
    du tableau de bord affiche.
  */
  const headlineValue = active ? active.value : currentValue;

  /** Montant du survol : deux décimales, comme dans l'info-bulle. */
  const money = (v: number) =>
    maskAmount(formatCurrency(v, baseCurrency), amountsHidden);

  /*
    Sous-titre : la date de ce qu'on regarde.

    Au survol, la date longue du point désigné. Hors survol, la date du dernier
    point — précédée de « valo au », qui dit qu'il s'agit d'une valorisation
    arrêtée et non d'un instant. L'heure n'apparaît que si elle en est
    réellement une (cf. `formatValuationTimeParis`).
  */
  const lastPoint = series.length > 0 ? series[series.length - 1] : undefined;
  const lastTime = lastPoint ? formatValuationTimeParis(lastPoint.date) : null;
  const dateLabel = active
    ? formatLongDateParis(active.date)
    : lastPoint
      ? `valo au ${formatShortDateParis(lastPoint.date)}${
          lastTime ? ` · ${lastTime}` : ""
        }`
      : null;

  const tooltip = active ? (
    <div className="space-y-[var(--space-1)] text-[length:var(--text-xs)]">
      {/* 1. Date longue */}
      <p className="text-[var(--foreground-secondary)]">
        {formatLongDateParis(active.date)}
      </p>

      {/* 2. Montant */}
      <p
        className="num text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]"
        data-testid="hero-tooltip-amount"
      >
        {money(active.value)}
      </p>

      {/* 3. Marché / Flux — pas le Δ NAV brut. Flux masqué si inconnu ou 0. */}
      {active.market !== undefined && (
        <p
          className={cn(
            "num flex flex-wrap items-baseline gap-[var(--space-1)]",
            active.market >= 0 ? "val-positive" : "val-negative"
          )}
          data-testid="hero-tooltip-market"
        >
          Marché {formatSignedAmount(active.market, (v) => money(v))}
        </p>
      )}
      {active.flow !== undefined && active.flow !== 0 && (
        <p
          className={cn(
            "num flex flex-wrap items-baseline gap-[var(--space-1)]",
            "text-[var(--primary-text)]"
          )}
          data-testid="hero-tooltip-flow"
        >
          Flux {formatSignedAmount(active.flow, (v) => money(v))}
        </p>
      )}

      {/* 4. Décomposition — en net seulement, et seulement si elle est portée */}
      {mode === "net" &&
        active.grossAssets !== undefined &&
        active.liabilities !== undefined && (
          <p
            className="num text-[var(--foreground-secondary)]"
            data-testid="hero-tooltip-split"
          >
            Actifs {money(active.grossAssets)}
            <span className="mx-[var(--space-1)] text-[var(--foreground-faint)]">
              ·
            </span>
            Passifs {money(active.liabilities)}
          </p>
        )}

      {/* 5. Pastille tx — journal coté, distincte de Marché/Flux */}
      {active.externalFlow !== undefined && (
        <p
          className={cn(
            "flex items-center gap-[var(--space-1)]",
            active.externalFlow >= 0 ? "val-positive" : "val-negative"
          )}
          data-testid="hero-tooltip-tx"
        >
          <span
            aria-hidden
            className={cn(
              "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
              active.externalFlow >= 0
                ? "bg-[var(--chart-positive)]"
                : "bg-[var(--chart-negative)]"
            )}
          />
          <span className="num">
            {formatSignedAmount(active.externalFlow, (v) => money(v))}
          </span>
        </p>
      )}

      {/* 6. LOCF : dire que la valeur est reportée, pas mesurée ce jour-là */}
      {active.carried && (
        <p
          className="text-[var(--foreground-faint)]"
          data-testid="hero-tooltip-carried"
        >
          Reporté
          {active.lastObservedDate
            ? ` · ${formatDayMonthParis(active.lastObservedDate)}`
            : ""}
        </p>
      )}
    </div>
  ) : null;

  return (
    <section
      className="panel px-[var(--pad-card-lg)] py-[var(--pad-card-lg)]"
      data-testid="terminal-hero"
      data-nav-scope={mode}
      aria-labelledby="hero-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-[var(--space-5)]">
        {/* ── Chiffre de tête ── */}
        {/*
          Colonne élastique, et non dimensionnée par son contenu.

          Sans `flex-1`, cette colonne prenait la largeur de sa plus longue
          ligne — celle de la variation, que les deux pastilles ont allongée à
          504 px. Ajoutée aux 55 % du graphique, la somme dépassait de peu la
          carte, et la colonne de droite passait à la ligne : le graphique se
          retrouvait sous le chiffre, et la carte gagnait 151 pixels. Élastique,
          elle prend ce qui reste et replie son texte plutôt que la mise en page.
        */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[var(--space-2)]">
            {/*
              Le titre reste pour qui lit l'écran sans le voir, mais il ne
              prend plus la place : la bascule Net / Brut dit déjà le périmètre
              affiché, et l'avoir en toutes lettres à côté d'un bouton qui le
              répète était redondant. Le libellé n'est pas supprimé — un
              document sans titre de section perd sa structure — il cesse
              seulement d'occuper la ligne.
            */}
            <h2 id="hero-heading" className="sr-only">
              {HERO_NAV_SCOPE_HEADING[mode]}
            </h2>
            <span
              className={cn(
                "inline-flex h-4 w-4 cursor-help select-none items-center justify-center",
                "rounded-full border border-[var(--border-strong)]",
                "text-[10px] leading-none text-[var(--foreground-faint)]"
              )}
              tabIndex={0}
              role="note"
              data-testid="hero-mode-help"
              title={heroModeHelpLine(mode)}
              aria-label={heroModeHelpLine(mode)}
            >
              ?
            </span>

            {/*
              Bascule Net / Brut — même motif que `kpi-pnl-toggle` (deux
              pastilles côte à côte, la sélection en fond plein) plutôt qu'un
              second système : la carte de tête n'a plus qu'un chiffre, un
              graphique et un Δ, et le mode qui les pilote tous les trois se
              choisit ici, pas dans deux mini-cartes qui dupliquaient déjà
              presque tout ce que le corps de la carte affiche.
            */}
            <div
              className="flex shrink-0 gap-0.5"
              role="tablist"
              aria-label="Lecture Net ou Brut"
              data-testid="hero-mode-toggle"
            >
              {HERO_CARD_MODES.map((m) => {
                const selected = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-active={selected}
                    title={HERO_NAV_SCOPE_TITLE[m]}
                    data-testid={`hero-mode-${m}`}
                    onClick={() => {
                      onScopeChange(m);
                      hover.reset();
                    }}
                    className={cn(
                      "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium leading-none transition",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      selected
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-[var(--shadow-xs)]"
                        : "bg-[var(--muted)]/70 text-[var(--foreground)] hover:bg-[var(--muted)]"
                    )}
                  >
                    {HERO_NAV_SCOPE_LABEL[m]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-[var(--space-3)] flex flex-wrap items-baseline gap-[var(--space-3)]">
            {loading && headlineValue === null ? (
              <span
                className="num block h-[var(--text-4xl)] w-[14rem] rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]"
                aria-hidden
              />
            ) : (
              /*
                `aria-live` sur le montant, et non sur la carte entière : un
                lecteur d'écran doit annoncer la valeur du point atteint à la
                flèche, pas relire le titre et le sélecteur à chaque
                déplacement. L'annonce ne part qu'au changement de point, le
                survol ne provoquant aucun rendu tant que le rang ne change pas.
              */
              <span
                className={cn(
                  "num text-[length:var(--text-4xl)] font-semibold leading-none",
                  "tracking-[var(--tracking-tighter)] text-[var(--foreground)]",
                  "sm:text-[length:var(--text-5xl)]"
                )}
                data-testid="hero-net-worth"
                data-hovering={active ? "true" : undefined}
                aria-live="polite"
                aria-atomic="true"
              >
                {headlineValue === null
                  ? "—"
                  : maskAmount(formatHeroAmount(headlineValue), amountsHidden)}
              </span>
            )}
            <span className="text-label">{baseCurrency}</span>
          </div>

          {/*
            Variation de la période affichée.

            Masquée pendant le survol : le chiffre au-dessus n'est plus celui
            d'aujourd'hui mais celui du point visé, et lui accoler une variation
            de période ferait lire un écart qui ne part pas de ce montant.
            L'info-bulle prend le relais avec l'écart au point précédent.

            La hauteur est réservée en toutes circonstances : sans elle, la
            carte se contracterait au premier survol et se rouvrirait à la
            sortie, sous le curseur.
          */}
          {/*
            Hauteur réservée pour deux lignes, et non pour une.

            Le survol n'est pas le seul à faire varier cette ligne : les
            pastilles Marché/Flux ne sont montées que lorsque `heroAttribution`
            aboutit, et leur arrivée la replie en deux lignes. Mesuré à la
            largeur des tests : la ligne passe de 12 à 32 pixels entre 3M — où
            l'attribution est indisponible — et YTD, où elle l'est, et la carte
            entière suivait de 248 à 268. Un chip changeait donc la taille du
            bloc, ce que le test « changer de période ne fait pas sauter la
            carte » interdit à juste titre : tout ce qui est en dessous
            sursautait à chaque clic.

            Réserver le cas le plus haut plutôt que masquer les pastilles : les
            cacher aurait stabilisé la carte en taisant une information vraie,
            et afficher « 0 € » à leur place aurait été un mensonge. Ici on ne
            montre rien de plus, on garde seulement la place.
          */}
          <div className="mt-[var(--space-2)] min-h-[2rem]">
            {windowChange && (
              <p
                className={cn(
                  "flex flex-wrap items-baseline gap-[var(--space-2)] text-[length:var(--text-sm)] leading-none",
                  /*
                    Cachée pendant le survol, mais jamais démontée.

                    La démonter faisait disparaître sa hauteur — et cette ligne
                    se replie en plusieurs lignes dès que la carte est étroite.
                    Mesuré à 1 280 px : la carte passait de 347 à 188 pixels au
                    premier survol, le graphique remontait de 166 pixels sous un
                    curseur immobile, le navigateur émettait `pointerleave`, et
                    le survol se perdait aussitôt — pour recommencer. Le
                    `min-height` d'une ligne que j'avais posé ne réservait que
                    le cas où la ligne ne se replie pas.

                    `invisible` conserve exactement la boîte, quel que soit le
                    nombre de lignes : la carte ne bouge plus d'un pixel, et il
                    n'y a plus de hauteur à deviner.
                  */
                  active && "invisible"
                )}
                aria-hidden={active ? true : undefined}
                data-testid="hero-window-change"
                data-direction={windowChange.abs >= 0 ? "up" : "down"}
              >
                <span
                  className={cn(
                    "num font-medium",
                    windowChange.abs >= 0 ? "val-positive" : "val-negative"
                  )}
                  data-testid="hero-window-change-abs"
                >
                  {formatSignedAmount(windowChange.abs, (v) => money(v))}
                </span>
                <span className="text-[var(--foreground-faint)]">·</span>
                <span
                  className={cn(
                    "num",
                    windowChange.pct === null
                      ? "text-[var(--foreground-faint)]"
                      : windowChange.abs >= 0
                        ? "val-positive"
                        : "val-negative"
                  )}
                  data-testid="hero-window-change-pct"
                >
                  {/*
                    Une fenêtre partie de zéro n'a pas de pourcentage — ni petit
                    ni grand : aucun. « n/a » le dit ; « +100 % » l'inventerait.
                  */}
                  {windowChange.pct === null
                    ? "n/a"
                    : formatSignedPct(windowChange.pct)}
                </span>
                <span
                  className="text-[var(--foreground-secondary)]"
                  data-testid="hero-window-label"
                >
                  {periodLabel}
                </span>

                {/*
                  D'où vient cette variation.

                  Sur la même ligne, à droite du libellé de période : les trois
                  chiffres décrivent le même écart et se lisent d'un seul
                  regard. Les poser sur une ligne à part ferait grandir la
                  carte pour une information qui tient ici.

                  Le flux ne prend pas la couleur du marché : un apport de
                  50 k€ n'est ni une bonne ni une mauvaise nouvelle, c'est un
                  déplacement d'argent. Le teinter en vert le ferait lire comme
                  une réussite.
                */}
                {attribution && (
                  <>
                    <span className="text-[var(--foreground-faint)]">·</span>
                    <span
                      className={cn(
                        "num rounded-[var(--radius-sm)] px-[var(--space-1)]",
                        "bg-[var(--surface-sunken)]",
                        attribution.market >= 0
                          ? "val-positive"
                          : "val-negative"
                      )}
                      data-testid="hero-pill-market"
                      title="Ce que la valeur des actifs a produit, capital investi retiré"
                    >
                      Performance{" "}
                      {formatSignedAmount(attribution.market, (v) => money(v))}
                    </span>
                    <span
                      className={cn(
                        "num rounded-[var(--radius-sm)] px-[var(--space-1)]",
                        "bg-[var(--surface-sunken)] text-[var(--primary-text)]"
                      )}
                      data-testid="hero-pill-flow"
                      title="Capital entré ou sorti du périmètre sur la période — achats, ventes, versements sur les poches, emprunts"
                    >
                      Capital investi{" "}
                      {formatSignedAmount(attribution.flow, (v) => money(v))}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>

          {/*
            La date lue, la part des dettes, et la profondeur de l'historique
            complet — laquelle ne dépend pas de la période choisie.

            Le libellé du mode n'y figure plus : le repère « ? » au-dessus le
            porte désormais, et la ligne doit tenir sur une seule ligne pour ne
            pas faire grandir la carte.
          */}
          <p
            className="mt-[var(--space-2)] text-[length:var(--text-xs)] leading-none text-[var(--foreground-secondary)]"
            data-testid="hero-scope"
          >
            {dateLabel && <span data-testid="hero-date">{dateLabel}</span>}
            {liabilitiesNow !== undefined && (
              <>
                <span className="mx-[var(--space-2)] text-[var(--foreground-faint)]">
                  ·
                </span>
                <span data-testid="hero-liabilities">
                  dont passifs{" "}
                  <span className="num">{money(liabilitiesNow)}</span>
                </span>
              </>
            )}
            {servedNavFrom && periodOriginIso && (
              <>
                <span className="mx-[var(--space-2)] text-[var(--foreground-faint)]">
                  ·
                </span>
                <span
                  className="text-[var(--foreground-faint)]"
                  data-testid="hero-history-start"
                  data-from={servedNavFrom}
                >
                  depuis {formatShortDateParis(periodOriginIso)}
                </span>
              </>
            )}
          </p>
        </div>

        {/* ── Graphique — historique entier, sans sélecteur ── */}
        {/*
          Largeur arrêtée, et non déduite de la place restante.

          Le chiffre de tête suit désormais le curseur, donc sa largeur change
          en cours de survol : « 240,00 » n'occupe pas la place de « 918 073 ».
          Tant que le graphique prenait ce qui restait, il s'élargissait à
          chaque changement de valeur — c'est-à-dire sous le curseur, pendant le
          geste. Le point visé se dérobait : mesuré, le même pixel désignait le
          rang 661 en net et le rang 606 en brut.

          Une base fixe rend la colonne insensible à son voisin. Sur mobile elle
          reprend toute la largeur, comme avant, le bloc passant à la ligne.
        */}
        <div className="flex w-full min-w-0 flex-col items-end gap-[var(--space-2)] sm:w-[55%] sm:flex-none">
          <RangeChips
            range={range}
            onRangeChange={onRangeChange}
            rangeEnabled={rangeEnabled}
            testIdPrefix="hero-range"
            className="justify-end"
          />
          <p
            className="text-[length:var(--text-2xs)] text-[var(--foreground-faint)]"
            data-testid="hero-range-subtitle"
          >
            {periodLabel}
          </p>

          <div className="h-[5.5rem] w-full min-w-0 sm:h-[6.5rem]">
            {values && values.length >= 2 ? (
              <HeroChart
                values={values}
                dates={windowed.map((p) => p.date)}
                stroke={stroke}
                activeIndex={hover.activeIndex}
                setContainer={hover.setContainer}
                handlers={hover.handlers}
                carriedActive={active?.carried ?? false}
                eventMarkers={markers}
                tooltip={tooltip}
                ariaLabel={`Courbe du patrimoine ${HERO_NAV_SCOPE_LABEL[mode]} — flèches gauche et droite pour parcourir les points, Échap pour revenir à aujourd'hui`}
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
  /**
   * `null`/`undefined` — et non zéro — quand le montant n'est pas calculable
   * sur la fenêtre (série absente ou à un seul point) : « on ne sait pas » et
   * « rien à afficher » ne se confondent pas avec un montant nul.
   */
  value: number | null | undefined;
  /** Série d'historique — omise quand aucune donnée réelle n'existe. */
  spark?: number[];
  /**
   * Horodatages alignés sur `spark`. Même axe temporel que la courbe de tête
   * quand ils sont fournis — un palier occupe la durée qu'il a vraiment duré.
   */
  sparkDates?: string[];
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
  /**
   * `undefined` et `null` ne disent pas la même chose sur ces deux champs.
   *
   * `null` : la grandeur existe, l'historique ne permet pas de la calculer —
   * un tiret le dit. `undefined` : cette tuile n'a pas de ligne de variation à
   * porter, parce que son montant de tête *est* déjà la variation de la
   * période. Lui afficher un tiret annoncerait une inconnue là où le chiffre
   * est su, ce qui est la doctrine à l'envers.
   */
  /**
   * Phrase de périmètre, montrée dans le panneau de détail.
   *
   * Elle dit ce que le montant contient — et ce qu'il ne contient pas. Un
   * libellé d'un mot ne peut pas porter cette précision, et un « ? » de plus
   * dans une rangée de dix tuiles alourdirait l'écran : le panneau qui existe
   * déjà pour le Δ est le bon endroit.
   */
  help?: string;
  /**
   * Bascule interne à la tuile — seul le P&L en porte une (Latent / Réalisé).
   * Les deux options lisent la même définition (Δ de fenêtre sur un cumul à
   * date) ; ce n'est donc pas deux tuiles, mais deux lectures d'une seule.
   */
  toggle?: {
    active: string;
    options: { id: string; label: string }[];
    onChange: (id: string) => void;
  };
};

/** Préférence de visibilité des tuiles — clés masquées, P&L exclu. */
const KPI_HIDDEN_KEY = "dashboardKpiHiddenKeys";

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

  /*
    Sélecteur d'indicateurs — masque ou affiche chaque tuile hormis P&L, qui
    n'est pas décochable : c'est la seule grandeur que la doctrine impose de
    toujours montrer. La préférence survit au rechargement (`loadUiPref`), et
    une clé qui nommerait une tuile disparue (« Réalisé + revenus »,
    « Financier ») est ignorée sans casser l'écran — elle ne correspond à
    aucun `item.key` connu.
  */
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(() =>
    typeof window !== "undefined" ? loadUiPref<string[]>(KPI_HIDDEN_KEY, []) : []
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const knownKeys = items.map((i) => i.key);
  const hidden = hiddenKeys.filter(
    (k) => knownKeys.includes(k) && k !== "pnl"
  );
  const visibleItems = items.filter(
    (item) => item.key === "pnl" || !hidden.includes(item.key)
  );

  function toggleTile(key: string) {
    if (key === "pnl") return;
    setHiddenKeys((prev) => {
      const cur = prev.filter((k) => knownKeys.includes(k) && k !== "pnl");
      const next = cur.includes(key)
        ? cur.filter((k) => k !== key)
        : [...cur, key];
      saveUiPref(KPI_HIDDEN_KEY, next);
      return next;
    });
  }

  return (
    <div className="min-w-0 space-y-[var(--space-2)]">
      {/*
        Bascule de confidentialité, au-dessus des indicateurs : c'est là que
        se pose le regard juste avant de tourner l'écran vers quelqu'un. Un
        réglage rangé dans les préférences arriverait toujours trop tard.
      */}
      <div className="flex items-center justify-between gap-[var(--space-2)]">
        <p className="text-label hidden sm:block">Indicateurs</p>

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            data-testid="kpi-visibility-toggle"
            aria-expanded={pickerOpen}
            className={cn(
              "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-md)]",
              "px-[var(--space-2)] py-[var(--space-1)] text-[length:var(--text-2xs)] font-medium",
              "text-[var(--foreground-faint)] transition-colors duration-[var(--duration-fast)]",
              "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            )}
          >
            {pickerOpen ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">Afficher les indicateurs</span>
          </button>

          {pickerOpen && (
            <div
              role="menu"
              data-testid="kpi-visibility-menu"
              className={cn(
                "absolute right-0 top-full z-30 mt-[var(--space-1)] w-56",
                "rounded-[var(--radius-md)] border border-[var(--border)]",
                "bg-[var(--card)] p-[var(--space-2)] shadow-[var(--shadow-md)]"
              )}
            >
              {items.map((item) => {
                const isPnl = item.key === "pnl";
                const checked = isPnl || !hidden.includes(item.key);
                return (
                  <label
                    key={item.key}
                    className={cn(
                      "flex items-center gap-[var(--space-2)] rounded-[var(--radius-sm)]",
                      "px-[var(--space-1)] py-[var(--space-1)] text-[length:var(--text-xs)]",
                      isPnl
                        ? "text-[var(--foreground-faint)]"
                        : "cursor-pointer text-[var(--foreground)] hover:bg-[var(--surface-hover)]"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPnl}
                      onChange={() => toggleTile(item.key)}
                      data-testid={`kpi-visibility-${item.key}`}
                    />
                    {typeof item.label === "string" ? item.label : item.key}
                  </label>
                );
              })}
            </div>
          )}
        </div>

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
            "inline-flex items-center gap-[var(--space-1)] rounded-[var(--radius-md)]",
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

      {/*
        Flexbox plutôt qu'une grille à paliers fixes (D19, U1).
        Sous une grille `grid-cols-*`, masquer des tuiles via le
        sélecteur ci-dessus laissait les colonnes à leur largeur d'avant et un
        vide à droite — le nombre de colonnes restait celui de neuf tuiles
        même quand il n'en restait que quatre. Ici chaque tuile grandit pour
        occuper l'espace libéré (`flex-grow`), plafonnée à 320 px pour ne
        pas étirer un texte de trois mots sur toute la largeur du bandeau, et
        repasse à la ligne sous 200 px (`min-width`) — le même seuil que
        l'ancien `grid-cols-2` protégeait.
        `items-stretch` (par défaut) égalise la hauteur des tuiles d'une même
        ligne, mais rien dans une tuile ne dépend de sa largeur — libellé et
        montant sont tronqués, la zone de sparkline a une hauteur fixe — donc
        la largeur ne fait pas varier la hauteur de la rangée.
      */}
      <div
        className="flex min-w-0 flex-wrap gap-[var(--gap-card)]"
        data-testid="terminal-kpi-row"
        data-range={range}
      >
      {visibleItems.map((item) => {
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
        /*
          Une tuile dont le montant de tête est déjà la variation de la période
          n'a pas de seconde ligne à remplir — et surtout pas d'un tiret, qui
          signifie « inconnu » partout ailleurs dans cette rangée.
        */
        const hasChangeLine =
          item.changeAbs !== undefined || item.changePct !== undefined;
        /*
          Le panneau de détail répète, sans troncature, ce que la sous-ligne
          coupe : Δ et % complets.
        */
        const detailId = `kpi-detail-${item.key}`;
        const hasValue =
          typeof item.value === "number" && Number.isFinite(item.value);
        return (
          <article
            key={item.key}
            className="kpi-tile group/kpi relative z-0 flex min-w-[200px] max-w-[320px] flex-1 flex-col gap-[var(--space-2)] p-[var(--pad-card)] outline-none hover:z-20 focus-visible:z-20 focus-within:z-20"
            data-testid={`kpi-${item.key}`}
            tabIndex={0}
            aria-describedby={detailId}
          >
            <div className="flex items-center justify-between gap-[var(--space-1)]">
              <h3 className="text-label truncate" title={item.label}>
                {item.label}
              </h3>
              {item.toggle && (
                <div
                  className="flex shrink-0 gap-0.5"
                  role="tablist"
                  aria-label="Latent ou réalisé"
                  data-testid={`kpi-${item.key}-toggle`}
                >
                  {item.toggle.options.map((opt) => {
                    const selected = item.toggle!.active === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        data-testid={`kpi-${item.key}-toggle-${opt.id}`}
                        onClick={() => item.toggle!.onChange(opt.id)}
                        className={cn(
                          "rounded-[var(--radius-sm)] px-1 py-0.5 text-[9px] font-medium leading-none transition",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                          selected
                            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "bg-[var(--muted)]/70 text-[var(--foreground-secondary)] hover:bg-[var(--muted)]"
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <p
              className={cn(
                "num text-[length:var(--text-xl)] font-semibold leading-none",
                item.tone === "gold"
                  ? "text-[var(--chart-gold)]"
                  : "text-[var(--foreground)]"
              )}
            >
              {typeof item.value === "number" && Number.isFinite(item.value)
                ? maskAmount(
                    formatCurrency(item.value, baseCurrency),
                    amountsHidden
                  )
                : "—"}
            </p>

            <p
              className={cn(
                "flex min-w-0 items-baseline gap-[var(--space-1)]",
                "text-[length:var(--text-xs)] leading-none",
                // Hauteur conservée : la grille reste d'aplomb même sans ligne.
                !hasChangeLine && "invisible"
              )}
              data-testid={
                hasChangeLine ? `kpi-${item.key}-change` : undefined
              }
              aria-hidden={hasChangeLine ? undefined : true}
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
                  {/*
                    Sur quoi porte cette variation. La période ne vivait que
                    dans `data-range`, invisible à l'écran : deux tuiles
                    voisines pouvaient annoncer des horizons différents sans
                    que rien ne le montre.
                  */}
                  <span className="shrink-0 truncate text-[var(--foreground-faint)]">
                    {evolutionRangePeriodLabel(range)}
                  </span>
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
                  dates={item.sparkDates}
                  stroke={TONE_STROKE[tone] ?? TONE_STROKE.neutral!}
                  width={180}
                  height={28}
                  className="h-full w-full"
                />
              )}
            </div>

            {/*
              Positionné sous la tuile (jamais dessus) : `top-full` place son
              bord haut au bord bas de la tuile, la marge l'en écarte encore.
              Visible au survol de la souris et au focus clavier de la tuile
              (elle est elle-même le seul élément tabulable ici) ; invisible et
              non interactif sinon, pour ne rien changer au layout.
            */}
            <div
              id={detailId}
              role="tooltip"
              className={cn(
                "pointer-events-none absolute left-1/2 top-full z-50 mt-[var(--space-2)]",
                "w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[var(--radius-md)]",
                "border border-[var(--border)] bg-[var(--card)] p-[var(--space-3)]",
                "text-[length:var(--text-xs)] shadow-[var(--shadow-md)] opacity-0",
                "transition-opacity duration-[var(--duration-fast)]",
                "group-hover/kpi:pointer-events-auto group-hover/kpi:opacity-100",
                "group-focus-visible/kpi:pointer-events-auto group-focus-visible/kpi:opacity-100"
              )}
            >
              <p className="mb-[var(--space-2)] font-semibold text-[var(--foreground)]">
                {item.label}
              </p>
              {item.help && (
                <p className="mb-[var(--space-2)] text-[var(--foreground-faint)]">
                  {item.help}
                </p>
              )}
              <dl className="space-y-[var(--space-1)]">
                <div className="flex items-baseline justify-between gap-[var(--space-2)]">
                  <dt className="text-[var(--foreground-faint)]">Valeur</dt>
                  <dd className="num text-[var(--foreground)]">
                    {hasValue
                      ? maskAmount(
                          formatCurrency(item.value as number, baseCurrency),
                          amountsHidden
                        )
                      : "—"}
                  </dd>
                </div>
                {hasChangeLine && (
                  <div className="flex items-baseline justify-between gap-[var(--space-2)]">
                    <dt className="text-[var(--foreground-faint)]">
                      Δ période
                    </dt>
                    <dd
                      className={cn(
                        "num text-right",
                        signed
                          ? up
                            ? "val-positive"
                            : "val-negative"
                          : "text-[var(--foreground-faint)]"
                      )}
                    >
                      {signed ? (
                        <>
                          {abs !== null &&
                            `${abs >= 0 ? "+" : "−"}${maskAmount(
                              formatCurrency(Math.abs(abs), baseCurrency),
                              amountsHidden
                            )}`}
                          {abs !== null && pct !== null && " · "}
                          {pct !== null && formatPct(pct)}
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-[var(--space-2)]">
                  <dt className="text-[var(--foreground-faint)]">Période</dt>
                  <dd className="text-right text-[var(--foreground)]">
                    {evolutionRangePeriodLabel(range)}
                  </dd>
                </div>
              </dl>
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}
