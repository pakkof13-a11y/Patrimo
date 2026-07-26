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
};

/**
 * Bannière haute (zone KPI) — cover + centre + overlay dégradé pour le contraste.
 */
export function BrandBannerSurface({ className, children }: SurfaceProps) {
  const theme = useBrandTheme();
  const src = theme === "dark" ? BRAND.banner.dark : BRAND.banner.light;

  return (
    <div
      className={cn(
        "brand-banner relative isolate min-w-0 overflow-hidden rounded-[var(--radius-lg)]",
        className
      )}
      data-testid="brand-banner"
    >
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
          "transition-opacity duration-300 ease-in-out"
        )}
      />
      {/* Overlay : lisibilité des tuiles KPI sur la bannière */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0",
          "bg-gradient-to-b from-[var(--background)]/75 via-[var(--background)]/55 to-[var(--background)]/80",
          "dark:from-[var(--background)]/70 dark:via-[var(--background)]/50 dark:to-[var(--background)]/75",
          "transition-opacity duration-300 ease-in-out"
        )}
      />
      <div className="relative z-10 min-w-0">{children}</div>
    </div>
  );
}

/**
 * Fond abstrait discret sous le contenu principal (positions, etc.).
 * Opacité ~10 % — purement décoratif, ne gêne pas la lecture.
 */
export function BrandContentBackground({ className, children }: SurfaceProps) {
  const theme = useBrandTheme();
  const src =
    theme === "dark" ? BRAND.background.dark : BRAND.background.light;

  return (
    <div
      className={cn("brand-content-bg relative isolate min-w-0", className)}
      data-testid="brand-content-bg"
    >
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
          "object-cover object-center opacity-[0.10] dark:opacity-[0.12]",
          "transition-opacity duration-300 ease-in-out"
        )}
      />
      <div className="relative z-10 min-w-0">{children}</div>
    </div>
  );
}
