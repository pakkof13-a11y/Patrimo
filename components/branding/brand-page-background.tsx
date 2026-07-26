"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { BRAND } from "@/components/branding/brand-assets";
import { cn } from "@/app/lib/utils";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

type Props = {
  className?: string;
  /**
   * true = fond de page login (sous le contenu, pas -z-10 global).
   * false = fond app (fixed, derrière tout le shell).
   */
  fillContainer?: boolean;
};

/**
 * Fond marque light/dark — object-cover responsive, pas de déformation.
 * Les PNG contiennent déjà les accents dorés : on les laisse bien visibles
 * pour le liquid glass des cartes (ne pas les écraser à 20 % d’opacité).
 */
export function BrandPageBackground({
  className,
  fillContainer = false,
}: Props) {
  const { resolvedTheme } = useTheme();
  const mounted = useIsClient();
  const theme = mounted && resolvedTheme === "dark" ? "dark" : "light";
  const src = theme === "dark" ? BRAND.background.dark : BRAND.background.light;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden
      decoding="async"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
      className={cn(
        "brand-page-bg pointer-events-none h-full w-full object-cover object-center",
        "opacity-100 transition-opacity duration-300 ease-in-out",
        "motion-reduce:transition-none",
        fillContainer
          ? "absolute inset-0 z-0"
          : "fixed inset-0 -z-10",
        className
      )}
    />
  );
}
