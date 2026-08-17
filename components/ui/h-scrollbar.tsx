"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/app/lib/utils";

/**
 * Barre de défilement horizontale explicite pour un conteneur qui déborde.
 *
 * Les navigateurs modernes dessinent, sur la plupart des systèmes, une barre
 * *flottante* : elle n'occupe aucune place et n'apparaît qu'en cours de
 * défilement. Sur un poste à souris sans molette horizontale, un tableau plus
 * large que son cadre devient alors inatteignable — rien à saisir, et aucun
 * indice qu'il reste des colonnes à droite. `scrollbar-width` et
 * `::-webkit-scrollbar` n'y changent rien lorsque le système impose les barres
 * superposées.
 *
 * On dessine donc la piste et le curseur nous-mêmes, à partir du seul état qui
 * fasse foi — `scrollLeft`, `scrollWidth`, `clientWidth` du conteneur. Le
 * défilement natif continue de fonctionner, et cette barre le reflète.
 *
 * Elle disparaît d'elle-même quand il n'y a rien à faire défiler : une piste
 * pleine largeur sur un tableau qui tient à l'écran serait un faux affordant.
 */
export function HorizontalScrollbar({
  targetRef,
  controls,
  className,
  label = "Défilement horizontal du tableau",
}: {
  targetRef: React.RefObject<HTMLElement | null>;
  /** `id` du conteneur piloté — exigé d'un `role="scrollbar"`. */
  controls: string;
  className?: string;
  label?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ ratio: 1, progress: 0 });
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);

  const sync = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const scrollable = el.scrollWidth - el.clientWidth;
    setMetrics({
      ratio: el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1,
      progress: scrollable > 0 ? el.scrollLeft / scrollable : 0,
    });
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    sync();
    el.addEventListener("scroll", sync, { passive: true });

    /*
      Le tableau change de largeur sans que la fenêtre bouge : colonne
      masquée, groupe replié, panneau de détail ouvert. Un `resize` de fenêtre
      ne suffirait donc pas à tenir la barre à jour.
    */
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    const firstChild = el.firstElementChild;
    if (firstChild) observer.observe(firstChild);

    return () => {
      el.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [sync, targetRef]);

  const scrollTo = useCallback(
    (clientX: number) => {
      const el = targetRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      const rect = track.getBoundingClientRect();
      const thumbWidth = rect.width * metrics.ratio;
      const usable = Math.max(1, rect.width - thumbWidth);
      const position = clientX - rect.left - thumbWidth / 2;
      const progress = Math.min(1, Math.max(0, position / usable));
      el.scrollLeft = progress * (el.scrollWidth - el.clientWidth);
    },
    [metrics.ratio, targetRef]
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      const el = targetRef.current;
      const track = trackRef.current;
      if (!drag || !el || !track) return;
      const rect = track.getBoundingClientRect();
      const usable = Math.max(1, rect.width - rect.width * metrics.ratio);
      const delta = e.clientX - drag.startX;
      const scrollable = el.scrollWidth - el.clientWidth;
      el.scrollLeft = Math.min(
        scrollable,
        Math.max(0, drag.startScroll + (delta / usable) * scrollable)
      );
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [metrics.ratio, targetRef]);

  // Rien à faire défiler : la barre n'a pas lieu d'être.
  if (metrics.ratio >= 0.999) return null;

  const thumbPct = Math.max(8, metrics.ratio * 100);
  const leftPct = metrics.progress * (100 - thumbPct);

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-controls={controls}
      aria-valuenow={Math.round(metrics.progress * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-testid="h-scrollbar"
      className={cn(
        "relative h-[0.5rem] w-full cursor-pointer rounded-full",
        "bg-[var(--surface-sunken)]",
        className
      )}
      onPointerDown={(e) => {
        const el = targetRef.current;
        if (!el) return;
        const target = e.target as HTMLElement;
        // Clic sur la piste : on saute à l'endroit visé. Clic sur le curseur :
        // on entame un glissement, sans déplacement immédiat.
        if (target.dataset.thumb !== "true") scrollTo(e.clientX);
        dragRef.current = { startX: e.clientX, startScroll: el.scrollLeft };
      }}
    >
      <div
        data-thumb="true"
        className={cn(
          "absolute inset-y-0 rounded-full bg-[var(--border-strong)]",
          "transition-colors duration-[var(--duration-fast)] hover:bg-[var(--foreground-faint)]"
        )}
        style={{ width: `${thumbPct}%`, left: `${leftPct}%` }}
      />
    </div>
  );
}
