"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
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

function useBrandTheme(): "dark" | "light" {
  const { resolvedTheme } = useTheme();
  const mounted = useIsClient();
  if (!mounted) return "light";
  return resolvedTheme === "dark" ? "dark" : "light";
}

type SurfaceProps = {
  className?: string;
  children?: React.ReactNode;
  /**
   * Prolonge le motif sous la zone suivante (ex. Cockpit) pour unifier le
   * haut de page — padding bas + fondu de sortie.
   */
  extendBelow?: boolean;
};

/**
 * Bannière haute (zone KPI) — motif marque responsive, opacité basse,
 * fondus latéraux pour combler les ratios extrêmes (mobile portrait, ultrawide).
 *
 * Stratégie de remplissage :
 * - calque `object-cover` (remplit, crop doux centré) en opacité très basse ;
 * - calque `object-contain` centré par-dessus pour le monogramme lisible ;
 * - gradients latéraux thématiques (beige clair / charcoal) pour qu’aucune
 *   zone de l’encadré ne reste vide quelle que soit la largeur.
 */
export function BrandBannerSurface({
  className,
  children,
  extendBelow = false,
}: SurfaceProps) {
  const theme = useBrandTheme();
  const src = theme === "dark" ? BRAND.banner.dark : BRAND.banner.light;

  return (
    <div
      className={cn(
        "brand-banner relative isolate min-w-0 overflow-hidden",
        "rounded-[var(--radius-lg)]",
        /* Ratio fluide : plus bas sur mobile, plus panoramique en large */
        "min-h-[9.5rem] sm:min-h-[10.5rem] lg:min-h-[11.5rem]",
        extendBelow && "brand-banner--extend-below pb-8 sm:pb-10",
        className
      )}
      data-testid="brand-banner"
      data-theme={theme}
    >
      {/* Fond teinte dominante — filet de sécurité si l’image rate */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[var(--banner-fill)] transition-colors duration-300 ease-in-out"
      />

      {/* Calque cover : remplit l’encadré sans bandes vides */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full",
          "object-cover object-center",
          "opacity-[0.22] dark:opacity-[0.28]",
          "transition-opacity duration-300 ease-in-out",
          "motion-reduce:transition-none"
        )}
      />

      {/* Calque contain : monogramme centré, sans déformation */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden
        decoding="async"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full",
          "object-contain object-center",
          "opacity-[0.38] dark:opacity-[0.42]",
          "transition-opacity duration-300 ease-in-out",
          "motion-reduce:transition-none"
        )}
      />

      {/* Fondus latéraux — comblent les bords quand contain laisse des bords vides */}
      <div
        aria-hidden
        className="brand-banner-fade-x pointer-events-none absolute inset-0 transition-opacity duration-300 ease-in-out"
      />

      {/* Overlay vertical : lisibilité des tuiles KPI */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          "bg-gradient-to-b from-[var(--background)]/70 via-[var(--background)]/50 to-[var(--background)]/78",
          "dark:from-[var(--background)]/65 dark:via-[var(--background)]/45 dark:to-[var(--background)]/72",
          "transition-opacity duration-300 ease-in-out"
        )}
      />

      {/* Extension bas → unifie sous le Cockpit */}
      {extendBelow && (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-10 sm:h-12",
            "bg-gradient-to-b from-transparent to-[var(--background)]/90",
            "dark:to-[var(--background)]/85"
          )}
        />
      )}

      <div className="relative z-10 min-w-0">{children}</div>
    </div>
  );
}
