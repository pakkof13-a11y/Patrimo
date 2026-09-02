"use client";

import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/app/lib/utils";

const emptySubscribe = () => () => undefined;

function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

const MODES = [
  { value: "light", label: "Clair", Icon: Sun },
  { value: "system", label: "Système", Icon: Monitor },
  { value: "dark", label: "Sombre", Icon: Moon },
] as const;

/**
 * Sélecteur Clair / Système / Sombre — contrairement à ThemeToggle (bascule
 * binaire), expose explicitement "système" comme un choix, pas seulement un
 * état de départ. Utilisé sur la page de login pour laisser choisir avant
 * même la connexion ; le choix est celui de next-themes (localStorage),
 * donc déjà appliqué au reste de l'app une fois connecté.
 */
export function ThemeModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useIsClient();
  // "system" est la valeur par défaut de next-themes (defaultTheme="system")
  // tant que l'utilisateur n'a rien choisi explicitement.
  const active = mounted ? theme ?? "system" : "system";

  return (
    <div
      role="radiogroup"
      aria-label="Thème"
      data-testid="theme-mode-toggle"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-[var(--border)]",
        "bg-[var(--card)]/70 p-0.5 backdrop-blur-sm",
        "transition-colors duration-300 ease-in-out",
        className
      )}
    >
      {MODES.map(({ value, label, Icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={label}
            title={label}
            data-testid={`theme-mode-${value}`}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full",
              "transition-colors duration-200 ease-in-out",
              isActive
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
