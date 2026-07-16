"use client";

import { FormEvent, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  ONBOARDING_SESSION_DISMISS_KEY,
  clearSessionPref,
} from "@/app/lib/ui-preferences";

/** Chemin relatif uniquement — évite localhost vs 127.0.0.1 (cookies session). */
function toAppPath(url: string | null | undefined, fallback = "/positions"): string {
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
  const callbackUrl = toAppPath(search.get("callbackUrl"), "/positions");

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
        setError("Identifiant ou mot de passe incorrect.");
        setPending(false);
        return;
      }
      // Nouveau login → l'aide réapparaît si « Afficher à chaque démarrage »
      // (dismiss permanent en localStorage n'est pas touché).
      clearSessionPref(ONBOARDING_SESSION_DISMISS_KEY);
      // Ne pas utiliser res.url absolu (AUTH_URL=localhost alors que e2e = 127.0.0.1)
      router.replace(toAppPath(callbackUrl, "/positions"));
      router.refresh();
    } catch {
      setError("Connexion impossible. Réessayez.");
      setPending(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
      {/* Fond discret */}
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(13,148,136,0.25), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(30,58,138,0.2), transparent)",
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/patrimo.jpg"
            alt="Patrimo"
            width={120}
            height={120}
            priority
            className="rounded-2xl object-cover shadow-lg ring-1 ring-white/10"
          />
          <p className="mt-5 text-base font-medium tracking-wide text-gray-400 sm:text-lg">
            Prenez les commandes de votre avenir financier.
          </p>
        </div>

        <form
          method="post"
          action="#"
          onSubmit={onSubmit}
          className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl backdrop-blur"
          data-testid="login-form"
          data-hydrated={hydrated ? "true" : "false"}
        >
          <h1 className="mb-1 text-center text-lg font-semibold text-white">
            Connexion
          </h1>
          <p className="mb-5 text-center text-xs text-slate-500">
            Accès sécurisé multi-compte
          </p>

          <label className="mb-3 block text-xs font-medium text-slate-400">
            Identifiant
            <input
              className="input mt-1 w-full border-slate-700 bg-slate-950 text-slate-100"
              autoComplete="username"
              name="username"
              data-testid="login-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="mb-4 block text-xs font-medium text-slate-400">
            Mot de passe
            <input
              className="input mt-1 w-full border-slate-700 bg-slate-950 text-slate-100"
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
              className="mb-3 rounded-lg bg-rose-950/50 px-3 py-2 text-center text-xs text-rose-300"
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

        <p className="mt-6 text-center text-[10px] text-slate-600">
          Patrimo · Europe/Paris
        </p>
      </div>
    </div>
  );
}
