"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ThemeModeToggle } from "@/components/ui/theme-mode-toggle";
import { BrandLogo } from "@/components/branding/brand-logo";
import { BRAND } from "@/components/branding/brand-assets";
import { cn } from "@/app/lib/utils";
import {
  ONBOARDING_SESSION_DISMISS_KEY,
  clearSessionPref,
} from "@/app/lib/ui-preferences";

/** Chemin relatif uniquement — évite localhost vs 127.0.0.1 (cookies session). */
function toAppPath(url: string | null | undefined, fallback = "/dashboard"): string {
  const raw = (url || fallback).trim() || fallback;
  if (raw.startsWith("/")) return raw;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}` || fallback;
  } catch {
    return fallback;
  }
}

const emptySubscribe = () => () => undefined;

/** true uniquement après hydratation client (SSR = false). */
function useIsClient() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export default function LoginPage() {
  const router = useRouter();
  const search = useSearchParams();
  const callbackUrl = toAppPath(search.get("callbackUrl"), "/dashboard");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Marqueur d’hydratation — e2e attend avant submit (évite GET natif). */
  const hydrated = useIsClient();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!hydrated) return;
    setError(null);
    setPending(true);
    try {
      const res = await signIn("credentials", {
        username: username.trim(),
        password,
        redirect: false,
        callbackUrl,
      });
      if (!res || res.error) {
        // Messages génériques — pas de distinction « user existe / mauvais mdp ».
        // rate_limited : cooldown sans confirmer l’existence du compte.
        const code = (res as { code?: string } | undefined)?.code;
        if (code === "rate_limited") {
          setError(
            "Trop de tentatives. Réessayez dans quelques instants."
          );
        } else {
          setError("Identifiant ou mot de passe incorrect.");
        }
        setPending(false);
        return;
      }
      // Nouveau login → l'aide réapparaît si « Afficher à chaque démarrage »
      // (dismiss permanent en localStorage n'est pas touché).
      clearSessionPref(ONBOARDING_SESSION_DISMISS_KEY);
      // Ne pas utiliser res.url absolu (AUTH_URL=localhost alors que e2e = 127.0.0.1)
      router.replace(toAppPath(callbackUrl, "/dashboard"));
      router.refresh();
    } catch {
      setError("Connexion impossible. Réessayez.");
      setPending(false);
    }
  }

  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col items-center justify-center px-4",
        "bg-[var(--background)] text-[var(--foreground)]",
        "transition-colors duration-300 ease-in-out"
      )}
    >
      {/*
        Halo doré — teinte reprise du monogramme (pas --primary, qui est teal
        et sert déjà à l'action). Deux calques superposés qui se crossfadent
        en opacité plutôt qu'un gradient qu'on tenterait de transitionner
        directement (les navigateurs n'interpolent pas les dégradés de façon
        fiable) — même technique que BrandBannerSurface / BrandPageBackground.
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-100 transition-opacity duration-300 ease-in-out dark:opacity-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -10%, rgba(212,175,55,0.16), transparent), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(212,175,55,0.08), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-in-out dark:opacity-100"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -10%, rgba(212,175,55,0.22), transparent), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(212,175,55,0.10), transparent)",
        }}
      />

      <div className="absolute right-4 top-4 z-10">
        <ThemeModeToggle />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandLogo
            size={120}
            priority
            alt={BRAND.name}
            className="rounded-2xl shadow-lg ring-1 ring-[var(--border)]"
          />
          <p className="mt-5 text-base font-medium tracking-wide text-[var(--muted-foreground)] sm:text-lg">
            Prenez les commandes de votre avenir financier.
          </p>
        </div>

        <form
          method="post"
          action="#"
          onSubmit={onSubmit}
          className={cn(
            "rounded-2xl border border-[var(--border)] bg-[var(--card)]/90 p-6 shadow-2xl backdrop-blur",
            "transition-colors duration-300 ease-in-out"
          )}
          data-testid="login-form"
          data-hydrated={hydrated ? "true" : "false"}
        >
          <h1 className="mb-1 text-center text-lg font-semibold text-[var(--foreground)]">
            Connexion
          </h1>
          <p className="mb-5 text-center text-xs text-[var(--muted-foreground)]">
            Accès sécurisé multi-compte
          </p>

          <label className="mb-3 block text-xs font-medium text-[var(--muted-foreground)]">
            Identifiant
            <input
              className="input mt-1 w-full"
              autoComplete="username"
              name="username"
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="mb-4 block text-xs font-medium text-[var(--muted-foreground)]">
            Mot de passe
            <input
              className="input mt-1 w-full"
              type="password"
              autoComplete="current-password"
              name="password"
              data-testid="login-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {error && (
            <p
              className="mb-3 rounded-lg bg-[var(--danger)]/10 px-3 py-2 text-center text-xs text-[var(--danger)]"
              data-testid="login-error"
              role="alert"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={pending || !hydrated}
            data-testid="login-submit"
          >
            {pending ? "Connexion…" : "Se connecter"}
          </Button>
        </form>

        <p className="mt-6 text-center text-[10px] text-[var(--muted-foreground)]">
          {BRAND.name} · Europe/Paris
        </p>
      </div>
    </div>
  );
}
