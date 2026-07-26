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
      clearSessionPref(ONBOARDING_SESSION_DISMISS_KEY);
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
        "relative flex min-h-screen flex-col",
        "bg-[var(--background)] text-[var(--foreground)]",
        "transition-colors duration-300 ease-in-out"
      )}
    >
      {/* Halos marque — crossfade light/dark */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-100 transition-opacity duration-300 ease-in-out dark:opacity-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -10%, rgba(212,175,55,0.16), transparent), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(13,107,99,0.08), transparent)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-in-out dark:opacity-100"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% -10%, rgba(212,175,55,0.22), transparent), radial-gradient(ellipse 50% 35% at 100% 100%, rgba(45,212,191,0.08), transparent)",
        }}
      />

      <div className="absolute right-4 top-4 z-20 sm:right-6 sm:top-5">
        <ThemeModeToggle />
      </div>

      <div
        className={cn(
          "relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center",
          "px-4 py-12 sm:px-6 lg:px-8",
          "lg:grid lg:grid-cols-2 lg:items-center lg:gap-12 xl:gap-16"
        )}
      >
        {/* Hero — bas mobile, colonne gauche desktop */}
        <div
          className={cn(
            "mb-8 flex w-full max-w-md flex-col items-center text-center",
            "lg:mb-0 lg:max-w-none lg:items-start lg:text-left"
          )}
        >
          <BrandLogo
            size={112}
            priority
            alt={BRAND.name}
            className="login-logo rounded-2xl shadow-[var(--shadow-md)]"
          />
          <h1
            className={cn(
              "brand-gold-text brand-gold-shine mt-6 text-3xl tracking-tight sm:text-4xl",
              "lg:text-[2.5rem]"
            )}
          >
            {BRAND.name}
          </h1>
          <p
            className={cn(
              "brand-gold-text brand-gold-shine brand-slogan mt-4 max-w-sm",
              "text-[1.05rem] sm:text-lg lg:max-w-md lg:text-xl"
            )}
            data-testid="login-slogan"
          >
            {BRAND.slogan}
          </p>
          <p className="mt-4 hidden max-w-md text-sm leading-relaxed text-[var(--muted-foreground)] lg:block">
            Positions, P&amp;L et allocations à partir de votre journal —
            un cockpit clair pour piloter votre patrimoine.
          </p>
        </div>

        {/* Formulaire */}
        <div className="w-full max-w-sm lg:max-w-md lg:justify-self-end">
          <form
            method="post"
            action="#"
            onSubmit={onSubmit}
            className={cn(
              "login-card rounded-2xl p-6 sm:p-7",
              "transition-colors duration-300 ease-in-out"
            )}
            data-testid="login-form"
            data-hydrated={hydrated ? "true" : "false"}
          >
            <h2 className="mb-1 text-center text-lg font-semibold text-[var(--foreground)] lg:text-left">
              Connexion
            </h2>
            <p className="mb-5 text-center text-xs text-[var(--muted-foreground)] lg:text-left">
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

          <p className="mt-6 text-center text-[10px] text-[var(--muted-foreground)] lg:text-left">
            {BRAND.name} · Europe/Paris
          </p>
        </div>
      </div>
    </div>
  );
}
