"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  nearestPointByFraction,
  nearestPointIndex,
  parseSparklineTimestamp,
  sparklineXFractions,
} from "@/app/lib/ui/sparkline-geometry";
import type { HeroSeriesPoint } from "@/app/lib/portfolio/hero-series";

/**
 * Survol de la courbe de tête — désigne un point, et rien d'autre.
 *
 * Le hook ne connaît ni le SVG, ni le format des montants, ni le mode net ou
 * brut : il reçoit une série déjà construite et rend le rang survolé. Toute la
 * mise en forme reste dans le composant, ce qui permet de tester ici ce qui
 * mérite de l'être — l'aimantation, les bornes, le clavier — sans monter un
 * arbre React.
 *
 * ## Pourquoi une aimantation sur l'abscisse dessinée
 *
 * Sans dates, la courbe espace ses points par rang — un pas constant — et
 * l'aimantation par rang désigne exactement le point sous le curseur.
 *
 * Avec des dates, le trait est linéaire dans le temps : un palier de six mois
 * occupe six mois de largeur. Aimanter encore au rang viserait un endroit du
 * trait où il n'y a rien. On lit alors les mêmes fractions que la géométrie.
 *
 * ## Pourquoi l'état ne change qu'au changement de point
 *
 * `setActiveIndex` reçoit le même rang tant que le pointeur reste dans la même
 * colonne, et React abandonne alors le rendu. Un déplacement de trois pixels ne
 * repeint rien, et `aria-live` n'annonce pas trois fois le même montant — c'est
 * la même exigence vue de deux côtés.
 */
export type HeroChartHover = {
  /** Rang survolé, ou `null` hors survol. */
  activeIndex: number | null;
  /** Point survolé, ou `null` — borné à la série courante. */
  activePoint: HeroSeriesPoint | null;
  /**
   * `ref` du conteneur, sous forme de fonction.
   *
   * Une ref-callback plutôt qu'un `RefObject` : le hook rend un objet unique
   * que le composant enfant reçoit en bloc, et un `RefObject` transporté de la
   * sorte fait considérer tout l'objet comme une ref — la règle `react-hooks/refs`
   * y voit alors une lecture de ref pendant le rendu à chaque propriété lue.
   * La fonction, elle, n'est appelée qu'au montage : rien n'est lu au rendu.
   */
  setContainer: (el: HTMLDivElement | null) => void;
  /** Repasse la carte sur « aujourd'hui ». */
  reset: () => void;
  /** Handlers à répandre sur le conteneur focusable de la courbe. */
  handlers: {
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerLeave: () => void;
    onPointerCancel: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    onBlur: () => void;
  };
};

export function useHeroChartHover(points: HeroSeriesPoint[]): HeroChartHover {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const count = points.length;
  const fractions = useMemo(() => {
    const timestamps = points.map((p) => parseSparklineTimestamp(p.date));
    return sparklineXFractions(points.length, timestamps);
  }, [points]);

  const setContainer = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el;
  }, []);

  const reset = useCallback(() => setActiveIndex(null), []);

  /**
   * Rang désigné par une abscisse écran.
   *
   * La largeur est celle du conteneur, pas celle du `viewBox` : la sparkline
   * est étirée (`preserveAspectRatio="none"`), donc une fraction de largeur
   * rendue vaut la même fraction de largeur logique. Sans cette mesure, la
   * croix se décalerait dès que la carte change de taille.
   */
  const pointAt = useCallback(
    (clientX: number) => {
      const el = containerRef.current;
      if (!el || count === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      const next =
        fractions.length === count && fractions.length > 0
          ? nearestPointByFraction(fractions, ratio)
          : nearestPointIndex(count, ratio);
      if (next < 0) return;
      setActiveIndex((prev) => (prev === next ? prev : next));
    },
    [count, fractions]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => pointAt(e.clientX),
    [pointAt]
  );

  /*
    Le contact initial désigne déjà un point.

    Sur une surface tactile il n'y a pas de survol : sans ce `pointerdown`, le
    premier appui ne montrerait rien et il faudrait glisser pour obtenir une
    valeur. Le glissement, lui, est servi par `pointermove`.
  */
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => pointAt(e.clientX),
    [pointAt]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (count === 0) return;
      const { key } = e;

      if (key === "Escape") {
        setActiveIndex((prev) => (prev === null ? prev : null));
        return;
      }

      const step = key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : 0;
      if (step === 0) return;

      // Sans ce `preventDefault`, les flèches font défiler la page en même
      // temps qu'elles parcourent la courbe.
      e.preventDefault();
      setActiveIndex((prev) => {
        /*
          Première flèche : on entre par le dernier point, celui que la carte
          affiche déjà. Commencer au début obligerait à traverser tout
          l'historique pour revenir là où le regard était posé.
        */
        const from = prev ?? count - 1;
        return Math.min(count - 1, Math.max(0, from + step));
      });
    },
    [count]
  );

  /*
    Rang borné à la série courante.

    Le sélecteur net/brut remplace la série sous le curseur. Les deux ont la
    même longueur aujourd'hui, mais s'en remettre à cette coïncidence ferait
    lire un rang hors tableau le jour où elle cesserait. Borner à la lecture
    évite aussi de remettre l'état à zéro dans un effet — ce que la règle
    `set-state-in-effect` du projet interdit.
  */
  const activePoint = useMemo(() => {
    if (activeIndex === null) return null;
    return points[activeIndex] ?? null;
  }, [activeIndex, points]);

  const handlers = useMemo(
    () => ({
      onPointerMove,
      onPointerDown,
      onPointerLeave: reset,
      onPointerCancel: reset,
      onKeyDown,
      onBlur: reset,
    }),
    [onPointerMove, onPointerDown, onKeyDown, reset]
  );

  return {
    activeIndex: activePoint ? activeIndex : null,
    activePoint,
    setContainer,
    reset,
    handlers,
  };
}
