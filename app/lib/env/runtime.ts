/**
 * Garde-fous de configuration runtime — environnement de test / prod.
 * Ne pas logger de secrets. Utilisé par /api/health et checks ops.
 */
import { timingSafeEqual } from "crypto";

export type RuntimeEnvStatus = {
  /** NODE_ENV résolu */
  nodeEnv: string;
  /** true si AUTH_SECRET non vide (longueur min. indicative) */
  authSecretConfigured: boolean;
  /** true si DATABASE_URL non vide */
  databaseUrlConfigured: boolean;
  /** true si un secret cron est défini (accrual multi-user) */
  cronSecretConfigured: boolean;
  /** true si ALLOW_DEMO_FALLBACK est activé (à éviter hors démo) */
  demoFallbackEnabled: boolean;
  /** true si l’on considère l’env « non-local » (production | test | staging) */
  isDeployedLike: boolean;
};

function truthyEnv(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Snapshot non secret de l’état de config (safe pour health JSON).
 */
export function getRuntimeEnvStatus(): RuntimeEnvStatus {
  const nodeEnv = process.env.NODE_ENV || "development";
  const auth = process.env.AUTH_SECRET?.trim() || "";
  const db = process.env.DATABASE_URL?.trim() || "";
  const cron = process.env.CRON_SECRET?.trim() || "";
  const vercel = Boolean(process.env.VERCEL);
  const isDeployedLike =
    nodeEnv === "production" ||
    vercel ||
    truthyEnv("PATRIMO_DEPLOYED");

  return {
    nodeEnv,
    authSecretConfigured: auth.length >= 16,
    databaseUrlConfigured: db.length > 0,
    cronSecretConfigured: cron.length >= 16,
    demoFallbackEnabled: truthyEnv("ALLOW_DEMO_FALLBACK"),
    isDeployedLike,
  };
}

/**
 * Erreurs bloquantes pour un environnement déployé (test/staging/prod).
 * En local (`development` hors Vercel) : liste vide (ne casse pas le dev).
 */
export function getDeployBlockingConfigIssues(): string[] {
  const s = getRuntimeEnvStatus();
  if (!s.isDeployedLike) return [];

  const issues: string[] = [];
  if (!s.authSecretConfigured) {
    issues.push(
      "AUTH_SECRET manquant ou trop court (≥ 16 car. recommandés, openssl rand -base64 32)"
    );
  }
  if (!s.databaseUrlConfigured) {
    issues.push("DATABASE_URL manquant");
  }
  if (s.demoFallbackEnabled) {
    issues.push(
      "ALLOW_DEMO_FALLBACK=true sur environnement déployé — désactiver hors démo pure"
    );
  }
  return issues;
}

/**
 * Compare un secret Bearer / header de façon timing-safe.
 * Retourne false si le secret env est absent ou trop court.
 */
export function timingSafeEqualSecret(
  provided: string | null | undefined,
  expectedEnvName: string
): boolean {
  const expected = process.env[expectedEnvName]?.trim();
  if (!expected || expected.length < 8) return false;
  if (!provided) return false;

  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
      // compare dummy pour réduire timing sur longueur
      timingSafeEqual(b, b);
      return false;
    }
    return timingSafeEqual(a, b);
  } catch {
    return provided === expected;
  }
}
