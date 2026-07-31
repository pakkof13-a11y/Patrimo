"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, User } from "lucide-react";
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

/**
 * Particules dorées — positions figées, jamais tirées au sort.
 *
 * `Math.random()` produirait un rendu serveur différent du rendu client et
 * déclencherait une erreur d'hydratation à chaque chargement. Les valeurs
 * sont donc écrites une fois pour toutes, réparties à la main pour éviter
 * l'alignement qu'une suite arithmétique laisserait voir.
 *
 * Quinze au maximum, conformément à la direction artistique : au-delà, la
 * scène bascule du « grain de lumière » vers le ciel étoilé.
 */
const PARTICLES: { left: string; top: string; delay: string; duration: string }[] =
  [
    { left: "8%", top: "72%", delay: "0s", duration: "34s" },
    { left: "17%", top: "45%", delay: "6s", duration: "41s" },
    { left: "23%", top: "88%", delay: "12s", duration: "37s" },
    { left: "31%", top: "22%", delay: "3s", duration: "45s" },
    { left: "38%", top: "64%", delay: "18s", duration: "32s" },
    { left: "44%", top: "35%", delay: "9s", duration: "48s" },
    { left: "52%", top: "80%", delay: "21s", duration: "36s" },
    { left: "58%", top: "18%", delay: "14s", duration: "43s" },
    { left: "64%", top: "58%", delay: "2s", duration: "39s" },
    { left: "71%", top: "84%", delay: "24s", duration: "35s" },
    { left: "77%", top: "29%", delay: "7s", duration: "46s" },
    { left: "83%", top: "67%", delay: "16s", duration: "33s" },
    { left: "89%", top: "41%", delay: "11s", duration: "44s" },
    { left: "94%", top: "76%", delay: "27s", duration: "38s" },
    { left: "12%", top: "15%", delay: "20s", duration: "42s" },
  ];

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
      {/* ── Couches de fond (§ CSS `login-*`) ── */}
      <div className="login-contours" aria-hidden />
      <div aria-hidden>
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="login-particle"
            style={{
              left: p.left,
              top: p.top,
              animationDelay: p.delay,
              animationDuration: p.duration,
            }}
          />
        ))}
      </div>
      <div className="login-wave" aria-hidden />

      <div className="absolute right-[var(--space-4)] top-[var(--space-4)] z-20">
        <ThemeModeToggle />
      </div>

      {/* ── Contenu ── */}
      {/*
        `relative` sans `z-index` : suffisant pour passer au-dessus des couches
        de fond (positionnées en z-0, mais antérieures dans le DOM) tout en
        évitant de créer un contexte d'empilement. Un `z-10` ici enfermerait le
        logo et sa fusion ne verrait plus le fond de la scène.
      */}
      <main
        className={cn(
          "relative mx-auto flex min-h-svh w-full max-w-[var(--login-card-w)] flex-col",
          "items-center justify-center px-[var(--space-5)] py-[var(--space-12)]"
        )}
      >
        <BrandLogo
          size={72}
          priority
          alt=""
          className="login-logo h-[3.25rem] w-[3.25rem] object-contain"
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
