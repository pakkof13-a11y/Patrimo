/**
 * Protection brute-force login — multi-instance via Upstash si configuré,
 * sinon mémoire process (dev / tests).
 *
 * Clés : IP + identifiant (indépendantes, la plus restrictive gagne).
 * Progressive : après THRESHOLD échecs, cooldown exponentiel plafonné.
 * Succès → reset des compteurs pour ces clés.
 */

import {
  kvDel,
  kvGet,
  kvSet,
  __resetKvMemoryForTests,
} from "@/app/lib/api/kv-store";

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
/** TTL Redis / mémoire pour les buckets login */
const BUCKET_TTL_SEC = Math.ceil((FAIL_WINDOW_MS * 2) / 1000);

function keyIp(ip: string): string {
  return `login:ip:${ip || "unknown"}`;
}

function keyLogin(login: string): string {
  return `login:id:${(login || "").toLowerCase().trim().slice(0, 64)}`;
}

function remainingLockSec(b: Bucket, now: number): number {
  if (b.lockedUntil <= now) return 0;
  return Math.max(1, Math.ceil((b.lockedUntil - now) / 1000));
}

async function loadBucket(key: string, now: number): Promise<Bucket> {
  const raw = await kvGet(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Bucket;
      if (
        typeof parsed.fails === "number" &&
        typeof parsed.windowStart === "number" &&
        typeof parsed.lockedUntil === "number"
      ) {
        if (now - parsed.windowStart < FAIL_WINDOW_MS) {
          return parsed;
        }
      }
    } catch {
      /* corrupt → reset */
    }
  }
  return { fails: 0, windowStart: now, lockedUntil: 0 };
}

async function saveBucket(key: string, b: Bucket): Promise<void> {
  await kvSet(key, JSON.stringify(b), BUCKET_TTL_SEC);
}

/**
 * À appeler **avant** la vérif credentials.
 * Bloque si IP ou identifiant est en cooldown.
 */
export async function checkLoginAllowed(
  ip: string,
  login: string
): Promise<LoginAllow | LoginBlock> {
  const now = Date.now();

  for (const key of [keyIp(ip), keyLogin(login)]) {
    const b = await loadBucket(key, now);
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
export async function recordLoginFailure(
  ip: string,
  login: string
): Promise<void> {
  const now = Date.now();
  for (const key of [keyIp(ip), keyLogin(login)]) {
    const b = await loadBucket(key, now);
    b.fails = Math.min(MAX_FAILS, b.fails + 1);
    if (b.fails >= THRESHOLD) {
      const exp = Math.min(4, b.fails - THRESHOLD);
      const cooldown = Math.min(
        MAX_COOLDOWN_MS,
        BASE_COOLDOWN_MS * Math.pow(2, exp)
      );
      b.lockedUntil = Math.max(b.lockedUntil, now + cooldown);
    }
    await saveBucket(key, b);
  }
}

/** Login réussi — efface les compteurs liés. */
export async function clearLoginFailures(
  ip: string,
  login: string
): Promise<void> {
  await Promise.all([kvDel(keyIp(ip)), kvDel(keyLogin(login))]);
}

/** Test / ops — reset mémoire process (ne pas exposer en prod API). */
export function __resetLoginRateLimitForTests(): void {
  __resetKvMemoryForTests();
}

/** Snapshot testable d’un bucket (mémoire ou Upstash selon env). */
export async function __peekLoginBucketForTests(
  kind: "ip" | "id",
  value: string
): Promise<Bucket | undefined> {
  const key = kind === "ip" ? keyIp(value) : keyLogin(value);
  const raw = await kvGet(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Bucket;
  } catch {
    return undefined;
  }
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
