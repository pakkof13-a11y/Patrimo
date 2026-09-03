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
  stroke,
  activeIndex,
  setContainer,
  handlers,
  carriedActive,
  tooltip,
  ariaLabel,
}: {
  values: number[];
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
  /** Contenu de l'info-bulle, mis en forme par l'appelant. */
  tooltip?: ReactNode;
  ariaLabel: string;
}) {
  const geometry = useMemo(
    () => sparklineGeometry(values, VIEW_WIDTH, VIEW_HEIGHT, STROKE_WIDTH),
    [values]
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
        stroke={stroke}
        fill
        width={VIEW_WIDTH}
        height={VIEW_HEIGHT}
        strokeWidth={STROKE_WIDTH}
        className="h-full w-full"
      />

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
