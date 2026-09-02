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

type BrandLogoProps = {
  /** Taille affichée (px CSS) */
  size?: number;
  className?: string;
  /** Priorité de chargement (login) */
  priority?: boolean;
  /** Texte alternatif — vide si purement décoratif à côté d’un titre */
  alt?: string;
  /**
   * Force un jeu d’assets (ex. page login toujours sur fond sombre).
   * Sinon suit next-themes.
   */
  forceTheme?: "dark" | "light";
};

/**
 * Logo Aurea adapté au thème (dark / light) via next-themes.
 * Fallback light tant que le thème n’est pas résolu (évite flash wrong-logo).
 */
export function BrandLogo({
  size = 36,
  className,
  priority = false,
  alt = BRAND.name,
  forceTheme,
}: BrandLogoProps) {
  const { resolvedTheme } = useTheme();
  const mounted = useIsClient();
  const dark =
    forceTheme === "dark"
      ? true
      : forceTheme === "light"
        ? false
        : mounted && resolvedTheme === "dark";
  const src = dark ? BRAND.logo.dark : BRAND.logo.light;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- bascule thème + fallback onError
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      decoding="async"
      {...(priority ? { fetchPriority: "high" as const } : {})}
      onError={(e) => {
        const el = e.currentTarget;
        // Si le logo thème échoue, bascule sur l’autre ; si les deux manquent, masque sans casser le layout
        const fallback = dark ? BRAND.logo.light : BRAND.logo.dark;
        if (el.dataset.fallback !== "1" && el.src !== fallback) {
          el.dataset.fallback = "1";
          el.src = fallback;
          return;
        }
        el.style.visibility = "hidden";
      }}
      className={cn(
        "brand-logo shrink-0 object-contain",
        "transition-[opacity,filter] duration-300 ease-in-out",
        className
      )}
      style={{ width: size, height: size }}
    />
  );
}
