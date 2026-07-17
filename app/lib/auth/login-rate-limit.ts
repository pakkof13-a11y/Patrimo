/**
 * Protection brute-force login — mémoire process-local.
 * Clés : IP + identifiant (indépendantes, la plus restrictive gagne).
 *
 * Progressive : après THRESHOLD échecs, cooldown exponentiel plafonné.
 * Succès → reset des compteurs pour ces clés.
 */

export type LoginBlock = {
  blocked: true;
  retryAfterSec: number;
};

export type LoginAllow = { blocked: false };

type Bucket = {
  fails: number;
  /** Début de la fenêtre glissante des échecs */
  windowStart: number;
  /** Verrouillage progressif */
  lockedUntil: number;
};

const buckets = new Map<string, Bucket>();

/** Fenêtre glissante des échecs comptés */
const FAIL_WINDOW_MS = 15 * 60_000;
/** Échecs avant le premier cooldown */
const THRESHOLD = 5;
/** Premier cooldown (ms) après seuil */
const BASE_COOLDOWN_MS = 45_000;
/** Cooldown max */
const MAX_COOLDOWN_MS = 15 * 60_000;
/** Cap échecs stockés (évite overflow) */
const MAX_FAILS = 50;

function keyIp(ip: string): string {
  return `login:ip:${ip || "unknown"}`;
}

function keyLogin(login: string): string {
  return `login:id:${(login || "").toLowerCase().trim().slice(0, 64)}`;
}

function getBucket(key: string, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || now - b.windowStart >= FAIL_WINDOW_MS) {
    b = { fails: 0, windowStart: now, lockedUntil: 0 };
    buckets.set(key, b);
  }
  return b;
}

function remainingLockSec(b: Bucket, now: number): number {
  if (b.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((b.lockedUntil - now) / 1000));
}

/**
 * À appeler **avant** la vérif credentials.
 * Bloque si IP ou identifiant est en cooldown.
 */
export function checkLoginAllowed(
  ip: string,
  login: string
): LoginAllow | LoginBlock {
  const now = Date.now();
  prune(now);

  for (const key of [keyIp(ip), keyLogin(login)]) {
    const b = getBucket(key, now);
    const wait = remainingLockSec(b, now);
    if (wait > 0) {
      return { blocked: true, retryAfterSec: wait };
    }
  }
  return { blocked: false };
}

/**
 * Enregistre un échec (user inconnu, mauvais mdp, validation).
 * Déclenche un cooldown progressif au-delà du seuil.
 */
export function recordLoginFailure(ip: string, login: string): void {
  const now = Date.now();
  for (const key of [keyIp(ip), keyLogin(login)]) {
    const b = getBucket(key, now);
    b.fails = Math.min(MAX_FAILS, b.fails + 1);
    if (b.fails >= THRESHOLD) {
      const exp = Math.min(4, b.fails - THRESHOLD);
      const cooldown = Math.min(
        MAX_COOLDOWN_MS,
        BASE_COOLDOWN_MS * Math.pow(2, exp)
      );
      b.lockedUntil = Math.max(b.lockedUntil, now + cooldown);
    }
  }
}

/** Login réussi — efface les compteurs liés. */
export function clearLoginFailures(ip: string, login: string): void {
  buckets.delete(keyIp(ip));
  buckets.delete(keyLogin(login));
}

function prune(now: number): void {
  for (const [k, b] of buckets) {
    if (
      now - b.windowStart > FAIL_WINDOW_MS * 2 &&
      b.lockedUntil < now
    ) {
      buckets.delete(k);
    }
  }
}

/** Test / ops — reset total (ne pas exposer en prod API). */
export function __resetLoginRateLimitForTests(): void {
  buckets.clear();
}

/** Snapshot testable d’un bucket. */
export function __peekLoginBucketForTests(
  kind: "ip" | "id",
  value: string
): Bucket | undefined {
  const key = kind === "ip" ? keyIp(value) : keyLogin(value);
  return buckets.get(key);
}

export const LOGIN_RATE_LIMIT = {
  FAIL_WINDOW_MS,
  THRESHOLD,
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
} as const;

/** Message générique (pas de distinction user / mdp / rate). */
export const GENERIC_LOGIN_ERROR =
  "Identifiant ou mot de passe incorrect.";

/** Message rate-limit (n’indique pas si le compte existe). */
export function rateLimitLoginMessage(retryAfterSec: number): string {
  const min = Math.ceil(retryAfterSec / 60);
  if (retryAfterSec < 90) {
    return `Trop de tentatives. Réessayez dans ${retryAfterSec} s.`;
  }
  return `Trop de tentatives. Réessayez dans environ ${min} min.`;
}
