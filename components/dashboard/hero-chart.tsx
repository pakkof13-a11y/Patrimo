"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/app/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";
import { sparklineGeometry } from "@/app/lib/ui/sparkline-geometry";
import type { HeroChartHover } from "@/app/hooks/use-hero-chart-hover";

/** Cadre logique du tracé — repris tel quel par la sparkline sous-jacente. */
const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 104;
const STROKE_WIDTH = 2;

/**
 * Courbe de tête, survolable.
 *
 * Le trait reste dessiné par `Sparkline` : c'est la même courbe qu'avant ce
 * chantier, au pixel près, et rien de ce qui la concerne n'a bougé. Ce
 * composant n'ajoute que ce qui répond au pointeur — une croix, une pastille,
 * une info-bulle — en se plaçant **au-dessus** du SVG.
 *
 * ## Pourquoi les repères sont du HTML, pas du SVG
 *
 * La sparkline est étirée (`preserveAspectRatio="none"`) : son `viewBox` de
 * 640 × 104 se déforme pour épouser la carte. Un `<circle>` posé dedans
 * deviendrait un ovale dès que la carte s'élargit, et il s'aplatirait
 * différemment à chaque largeur d'écran. Des éléments HTML positionnés en
 * pourcentage suivent exactement la même déformation horizontale sans en subir
 * la distorsion : la pastille reste ronde, la croix reste d'un pixel.
 *
 * Les deux lisent la géométrie de la **même fonction pure** que la sparkline,
 * avec les mêmes paramètres : la croix ne peut donc pas dériver du trait
 * qu'elle désigne.
 */
export function HeroChart({
  values,
  dates,
  stroke,
  activeIndex,
  setContainer,
  handlers,
  carriedActive,
  eventMarkers,
  tooltip,
  ariaLabel,
}: {
  values: number[];
  /**
   * Horodatages alignés sur `values`. Même série que celle passée au survol :
   * l'abscisse temporelle du trait et celle de l'aimantation ne peuvent pas
   * diverger.
   */
  dates?: Array<string | number | Date | null | undefined>;
  /** Couleur du trait — toujours un token (`var(--chart-…)`). */
  stroke: string;
  /**
   * Les trois membres du hook sont reçus séparément, jamais l'objet entier.
   *
   * Transporter l'objet ferait considérer par `react-hooks/refs` que toute
   * lecture de ses propriétés au rendu est une lecture de ref, puisque l'un de
   * ses membres alimente un `ref=`. Déplié, chaque valeur redevient ce qu'elle
   * est : un nombre, une fonction, un jeu de handlers.
   */
  activeIndex: HeroChartHover["activeIndex"];
  setContainer: HeroChartHover["setContainer"];
  handlers: HeroChartHover["handlers"];
  /** Le point actif est une valeur reportée : repère plus discret. */
  carriedActive: boolean;
  /**
   * Journées à mouvement de capitaux notable — au plus cinq, déjà triées.
   *
   * Le composant ne décide ni du seuil ni du nombre : il pose des repères là
   * où on le lui dit. La sélection vit dans `hero-attribution.ts`, où elle est
   * testable sans monter de SVG.
   */
  eventMarkers?: ReadonlyArray<{ index: number; amount: number }>;
  /** Contenu de l'info-bulle, mis en forme par l'appelant. */
  tooltip?: ReactNode;
  ariaLabel: string;
}) {
  const geometry = useMemo(
    () =>
      sparklineGeometry(values, VIEW_WIDTH, VIEW_HEIGHT, STROKE_WIDTH, dates),
    [values, dates]
  );

  const marker = useMemo(() => {
    if (!geometry || activeIndex === null) return null;
    const p = geometry.points.find((q) => q.sourceIndex === activeIndex);
    if (!p) return null;
    return {
      left: `${(p.x / VIEW_WIDTH) * 100}%`,
      top: `${(p.y / VIEW_HEIGHT) * 100}%`,
    };
  }, [geometry, activeIndex]);

  /*
    L'info-bulle bascule du côté opposé passé la moitié du cadre.

    Sans cela, elle sortirait de la carte sur les derniers points — c'est-à-dire
    exactement là où l'on regarde le plus souvent, la valeur d'aujourd'hui étant
    au bout à droite.
  */
  const tooltipOnLeft =
    marker !== null && parseFloat(marker.left) > 55;

  /*
    Position des repères d'événements.

    Ils lisent la même géométrie que le trait, comme la croix : un repère posé
    à côté de la marche qu'il explique serait pire que pas de repère du tout.
    Un rang absent du tracé — valeur non finie écartée — ne reçoit rien plutôt
    qu'un repère au hasard.
  */
  const eventDots = useMemo(() => {
    if (!geometry || !eventMarkers?.length) return [];
    return eventMarkers.flatMap((e) => {
      const p = geometry.points.find((q) => q.sourceIndex === e.index);
      if (!p) return [];
      return [
        {
          index: e.index,
          amount: e.amount,
          left: `${(p.x / VIEW_WIDTH) * 100}%`,
          top: `${(p.y / VIEW_HEIGHT) * 100}%`,
        },
      ];
    });
  }, [geometry, eventMarkers]);

  return (
    <div
      ref={setContainer}
      className={cn(
        "relative h-full w-full min-w-0",
        // Le glissement horizontal parcourt la courbe ; le défilement vertical
        // de la page reste possible, ce qui serait perdu avec `touch-action:none`.
        "touch-pan-y outline-none",
        "focus-visible:rounded-[var(--radius-sm)] focus-visible:shadow-[var(--focus-ring)]"
      )}
      tabIndex={0}
      role="group"
      aria-label={ariaLabel}
      data-testid="hero-chart"
      data-active-index={activeIndex ?? undefined}
      {...handlers}
    >
      <Sparkline
        values={values}
        dates={dates}
        stroke={stroke}
        fill
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        strokeWidth={STROKE_WIDTH}
        className="h-full w-full"
      />

      {/*
        Repères des mouvements de capitaux, **sur** la courbe.

        Ils lisent la même géométrie que le trait : left + top, pas le socle
        du cadre. Entrée en vert, sortie en rouge — les mêmes jetons que le
        reste de l'écran (`--chart-positive` / `--chart-negative`). Au survol
        du jour, le repère s'efface : la pastille du curseur le remplace, et
        deux points superposés ne se distingueraient plus.

        `aria-hidden` : ce ne sont pas des commandes. L'information qu'ils
        signalent est dite par l'info-bulle du jour, atteignable au clavier
        comme au pointeur.
      */}
      {eventDots.map((e) => {
        const incoming = e.amount >= 0;
        const hovering = activeIndex === e.index;
        return (
          <span
            key={e.index}
            aria-hidden
            data-testid="hero-chart-event"
            data-index={e.index}
            data-direction={incoming ? "in" : "out"}
            className={cn(
              "pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2",
              "rounded-full",
              incoming
                ? "bg-[var(--chart-positive)]"
                : "bg-[var(--chart-negative)]",
              hovering ? "opacity-25" : "opacity-80"
            )}
            style={{ left: e.left, top: e.top }}
          />
        );
      })}

      {marker && (
        <>
          {/* Croix verticale — pleine hauteur du cadre. */}
          <span
            aria-hidden
            data-testid="hero-chart-crosshair"
            className="pointer-events-none absolute inset-y-0 w-px bg-[var(--border-strong)]"
            style={{ left: marker.left }}
          />
          {/*
            Pastille sur le point.

            Une valeur reportée reçoit un repère creux : elle marque un jour
            que personne n'a mesuré, et lui donner le même éclat qu'une
            observation ferait passer une reconduction pour un relevé.
          */}
          <span
            aria-hidden
            data-testid="hero-chart-dot"
            data-carried={carriedActive || undefined}
            className={cn(
              "pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2",
              "rounded-full border-2 transition-none",
              carriedActive
                ? "border-[var(--foreground-faint)] bg-[var(--surface-raised)]"
                : "bg-[var(--surface-raised)] shadow-[0_0_0_3px_var(--surface-raised)]"
            )}
            style={{
              left: marker.left,
              top: marker.top,
              borderColor: carriedActive ? undefined : stroke,
            }}
          />
        </>
      )}

      {marker && tooltip && (
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 w-max max-w-[16rem]",
            tooltipOnLeft ? "-translate-x-full pr-[var(--space-3)]" : "pl-[var(--space-3)]"
          )}
          style={{ left: marker.left }}
          data-testid="hero-chart-tooltip"
          role="tooltip"
        >
          <div
            className={cn(
              "rounded-[var(--radius-md)] border border-[var(--border-strong)]",
              "bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)]",
              "shadow-[var(--shadow-lg)]"
            )}
          >
            {tooltip}
          </div>
        </div>
      )}
    </div>
  );
}
