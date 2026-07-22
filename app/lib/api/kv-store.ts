/**
 * Store clé-valeur pour rate-limit / cache d'accès multi-instance.
 *
 * Backend :
 * - Upstash Redis REST si `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 * - sinon Map process-local (dev, tests, mono-instance)
 *
 * Sur Vercel sans Upstash, le mode mémoire reste fragile (cold start) —
 * documenté dans docs/secrets.md. Health expose `rateLimitBackend`.
 *
 * fix: import dynamique (lazy require) au lieu d'un import statique de module.
 * Redis.fromEnv() throw si UPSTASH_* absent — crashé NextAuth au boot sur Vercel.
 */

export type KvBackend = "upstash" | "memory";

type MemoryEntry = { value: string; expiresAt: number | null };

const memory = new Map<string, MemoryEntry>();

// Lazy : on n'instancie Redis que si les vars d'env sont présentes ET à l'appel.
let redisSingleton: import("@upstash/redis").Redis | null | undefined;

function hasUpstashEnv(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  );
}

/** Backend actif (résolu à l'appel, pas au chargement du module — env runtime). */
export function getKvBackend(): KvBackend {
  return hasUpstashEnv() ? "upstash" : "memory";
}

/**
 * true si on est en multi-instance (Vercel / Lambda) **sans** store partagé.
 * Les appelants doivent alors éviter les caches process-only pour la sécu.
 */
export function isEphemeralProcessStore(): boolean {
  if (getKvBackend() === "upstash") return false;
  return Boolean(
    process.env.VERCEL === "1" ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.PATRIMO_DEPLOYED === "true"
  );
}

/**
 * fix: lazy require — l'import statique `import { Redis }` crashait NextAuth
 * au boot si UPSTASH_* étaient absents de Vercel (Redis.fromEnv() throw).
 * Ici le require n'a lieu que si les vars sont présentes, isolé en try/catch.
 */
function getRedis(): import("@upstash/redis").Redis | null {
  if (!hasUpstashEnv()) return null;
  if (redisSingleton === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
      redisSingleton = Redis.fromEnv();
    } catch {
      // Upstash non disponible ou vars invalides — fallback mémoire
      redisSingleton = null;
    }
  }
  return redisSingleton ?? null;
}

function memoryGet(key: string): string | null {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt != null && Date.now() >= e.expiresAt) {
    memory.delete(key);
    return null;
  }
  return e.value;
}

function memorySet(key: string, value: string, ttlSec?: number): void {
  memory.set(key, {
    value,
    expiresAt:
      ttlSec != null && ttlSec > 0 ? Date.now() + ttlSec * 1000 : null,
  });
}

export async function kvGet(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const v = await redis.get<string | number | null>(key);
      if (v == null) return null;
      return typeof v === "string" ? v : String(v);
    } catch {
      // Fallback mémoire si Upstash indisponible (ne pas planter l'auth)
      return memoryGet(key);
    }
  }
  return memoryGet(key);
}

export async function kvSet(
  key: string,
  value: string,
  ttlSec?: number
): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      if (ttlSec != null && ttlSec > 0) {
        await redis.set(key, value, { ex: ttlSec });
      } else {
        await redis.set(key, value);
      }
      return;
    } catch {
      // fallback below
    }
  }
  memorySet(key, value, ttlSec);
}

export async function kvDel(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch {
      /* ignore */
    }
  }
  memory.delete(key);
}

/**
 * INCR atomique + EXPIRE si première incrémentation dans la fenêtre.
 * Retourne le compteur après incrément (ou null si backend en échec total).
 */
export async function kvIncr(
  key: string,
  ttlSec: number
): Promise<number> {
  const redis = getRedis();
  if (redis) {
    try {
      const n = await redis.incr(key);
      if (n === 1 && ttlSec > 0) {
        await redis.expire(key, ttlSec);
      }
      return n;
    } catch {
      // fallback mémoire
    }
  }

  const raw = memoryGet(key);
  const next = (raw ? Number.parseInt(raw, 10) || 0 : 0) + 1;
  const existing = memory.get(key);
  if (existing?.expiresAt != null) {
    memory.set(key, { value: String(next), expiresAt: existing.expiresAt });
  } else {
    memorySet(key, String(next), ttlSec);
  }
  return next;
}

export async function kvTtlMs(key: string): Promise<number | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const sec = await redis.ttl(key);
      if (sec < 0) return null;
      return sec * 1000;
    } catch {
      /* fallthrough */
    }
  }
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt == null) return null;
  return Math.max(0, e.expiresAt - Date.now());
}

/** Tests / ops — reset mémoire process (n'efface pas Upstash). */
export function __resetKvMemoryForTests(): void {
  memory.clear();
  redisSingleton = undefined;
}
