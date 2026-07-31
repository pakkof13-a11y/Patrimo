"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, User } from "lucide-react";
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
  const [showPassword, setShowPassword] = useState(false);
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
        const err = res?.error;
        if (code === "rate_limited") {
          setError("Trop de tentatives. Réessayez dans quelques instants.");
        } else if (
          err === "Configuration" ||
          err === "MissingSecret" ||
          err === "UntrustedHost"
        ) {
          setError(
            "Erreur de configuration auth (serveur). Vérifiez AUTH_SECRET, AUTH_URL et les migrations Prisma sur Vercel — ce n’est pas un mauvais mot de passe."
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
    <div className="login-stage" data-testid="login-stage">
      {/*
        Fond fixe, indépendant du thème de l'application — voir le
        commentaire sur `.login-stage` dans globals.css. Pas de bouton
        clair/sombre ici : le réglage reste une affaire du terminal, une fois
        connecté.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- photo de marque plein cadre, pas un composant Next/Image */}
      <img
        src={BRAND.background.login}
        alt=""
        aria-hidden
        decoding="async"
        fetchPriority="high"
        className="login-bg-image"
      />

      {/*
        ── Contenu ──
        `relative` sans `z-index` : dans la pile d'empilement de `.login-stage`
        (isolée), un élément positionné à z-index:auto peint après ses
        frères de niveau 0 quand il les suit dans le DOM — donc au-dessus de
        la photo, sans qu'il soit nécessaire de lui donner un z-index propre.
      */}
      <main
        className={cn(
          "relative mx-auto flex min-h-svh w-full max-w-[var(--login-card-w)] flex-col",
          "items-center justify-center px-[var(--space-5)] py-[var(--space-12)]"
        )}
      >
        {/*
          Sigle sur fond réellement transparent (contrairement à l'ancien
          asset) : un rendu normal suffit, plus besoin de fusion pour
          neutraliser une tuile derrière la lettre.
        */}
        <BrandLogo
          size={72}
          priority
          alt=""
          className="h-[3.25rem] w-[3.25rem] object-contain"
        />

        <p
          className="login-eyebrow mt-[var(--space-4)] text-[length:var(--text-sm)]"
          data-testid="login-wordmark"
        >
          {BRAND.name}
        </p>

        <h1
          className={cn(
            "login-title mt-[var(--space-8)] text-center",
            "text-[2rem] sm:text-[2.5rem]"
          )}
        >
          Donner du sens
          <br />à votre patrimoine.
        </h1>

        {/* Filet doré : seule sa largeur respire, sur quatre secondes. */}
        <div className="mt-[var(--space-7)] flex justify-center">
          <span className="login-rule" aria-hidden />
        </div>

        <p
          className="login-eyebrow mt-[var(--space-6)] text-[length:var(--text-2xs)]"
          data-testid="login-slogan"
        >
          Personal wealth terminal
        </p>

        {/* ── Panneau ── */}
        <form
          method="post"
          action="#"
          onSubmit={onSubmit}
          className={cn(
            "login-card mt-[var(--space-10)] p-[var(--space-7)]",
            "flex flex-col gap-[var(--space-5)]"
          )}
          data-testid="login-form"
          data-hydrated={hydrated ? "true" : "false"}
        >
          <div>
            <label
              htmlFor="login-username"
              className="login-label mb-[var(--space-2)] block"
            >
              Identifiant
            </label>
            <div className="relative">
              <User
                className="pointer-events-none absolute left-[var(--space-4)] top-1/2 h-[0.9375rem] w-[0.9375rem] -translate-y-1/2 text-[var(--login-placeholder)]"
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="login-username"
                className="login-field pl-[calc(var(--space-4)*2+0.9375rem)] pr-[var(--space-4)]"
                autoComplete="username"
                name="username"
                placeholder="Votre identifiant"
                data-testid="login-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="login-label mb-[var(--space-2)] block"
            >
              Mot de passe
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-[var(--space-4)] top-1/2 h-[0.9375rem] w-[0.9375rem] -translate-y-1/2 text-[var(--login-placeholder)]"
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                id="login-password"
                className="login-field pl-[calc(var(--space-4)*2+0.9375rem)] pr-[calc(var(--space-4)*2+1rem)]"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                name="password"
                placeholder="Votre mot de passe"
                data-testid="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
                aria-label={
                  showPassword
                    ? "Masquer le mot de passe"
                    : "Afficher le mot de passe"
                }
                data-testid="login-toggle-password"
                className={cn(
                  "absolute right-[var(--space-3)] top-1/2 -translate-y-1/2 rounded-[var(--radius-sm)]",
                  "p-[var(--space-2)] text-[var(--login-placeholder)]",
                  "transition-colors duration-[120ms] ease-[var(--ease-out)]",
                  "hover:text-[var(--login-title)]",
                  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                )}
              >
                {showPassword ? (
                  <EyeOff className="h-[0.9375rem] w-[0.9375rem]" strokeWidth={1.5} />
                ) : (
                  <Eye className="h-[0.9375rem] w-[0.9375rem]" strokeWidth={1.5} />
                )}
              </button>
            </div>
          </div>

          {error && (
            <p
              className={cn(
                "rounded-[var(--login-field-radius)] px-[var(--space-3)] py-[var(--space-2)]",
                "text-center text-[length:var(--text-xs)] text-[var(--negative)]",
                "bg-[color-mix(in_srgb,var(--negative)_10%,transparent)]"
              )}
              data-testid="login-error"
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="login-submit inline-flex items-center justify-center gap-[var(--space-3)]"
            disabled={pending || !hydrated}
            data-testid="login-submit"
          >
            {pending ? "Connexion…" : "Accéder à mon patrimoine"}
            {!pending && (
              <ArrowRight className="h-[0.9375rem] w-[0.9375rem]" strokeWidth={1.75} aria-hidden />
            )}
          </button>
        </form>

        {/*
          Pas de lien « mot de passe oublié » : aucune route de
          réinitialisation n'existe côté serveur. Un lien mort sur l'écran
          d'entrée coûterait plus de confiance qu'il n'en gagnerait.
        */}

        <p className="login-footer mt-[var(--space-12)] text-center">
          {BRAND.name}
          <span className="mx-[var(--space-3)] opacity-60">•</span>
          Europe / Paris
        </p>
      </main>
    </div>
  );
}
