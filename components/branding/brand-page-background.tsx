"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { BRAND } from "@/components/branding/brand-assets";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

/**
 * Fond abstrait de l'application entière — `position: fixed` derrière tout,
 * pas scopé à une zone. Une version précédente vivait à l'intérieur de la
 * zone de contenu (`.module-main`) : son image y était intégralement
 * recouverte par les cartes opaques (Positions, Cockpit, etc.), donc
 * invisible quel que soit son opacité. En vivant au niveau racine avec
 * `fixed`, l'image se voit dans les marges de page et les interstices entre
 * cartes, où qu'elles soient placées.
 */
export function BrandPageBackground() {
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
      className="brand-page-bg pointer-events-none fixed inset-0 -z-10 h-full w-full object-cover object-center opacity-[0.20] transition-opacity duration-300 ease-in-out dark:opacity-[0.22]"
    />
  );
}
