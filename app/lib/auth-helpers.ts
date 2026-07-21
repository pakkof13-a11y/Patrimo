import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { UserRole } from "@/types/next-auth";
import { normalizeRole } from "./auth/role";
import { prisma } from "./prisma";
import {
  getKvBackend,
  isEphemeralProcessStore,
  kvDel,
  kvGet,
  kvSet,
} from "./api/kv-store";

export type { UserRole };
export { normalizeRole } from "./auth/role";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  username?: string;
  /** Toujours défini — aligné sur Session.user.role (next-auth.d.ts) */
  role: UserRole;
};

/** Snapshot d’accès lu en base (pas le JWT seul). */
export type UserAccess = {
  id: string;
  role: UserRole;
  username: string;
  email: string;
};

const ACCESS_TTL_MS = 30_000; // 30 s — un admin rétrogradé perd les droits rapidement
const ACCESS_TTL_SEC = Math.ceil(ACCESS_TTL_MS / 1000);
const ACCESS_KEY_PREFIX = "user-access:";

/** Cache process uniquement si mono-instance (évite privilege escalation multi-lambda). */
type CacheEntry = { access: UserAccess | null; expiresAt: number };
const processAccessCache = new Map<string, CacheEntry>();

function accessKey(userId: string): string {
  return `${ACCESS_KEY_PREFIX}${userId}`;
}

function allowProcessCache(): boolean {
  // Sur Vercel sans Upstash, ne jamais cacher le rôle en mémoire process
  // (révocation non partagée entre lambdas + TTL illusoire).
  if (isEphemeralProcessStore()) return false;
  return getKvBackend() === "memory";
}

/**
 * Invalide le cache d’accès (après changement de rôle, suppression, etc.).
 * Async pour purger Upstash multi-instance.
 */
export async function invalidateUserAccessCache(userId?: string): Promise<void> {
  if (userId) {
    processAccessCache.delete(userId);
    await kvDel(accessKey(userId));
    return;
  }
  processAccessCache.clear();
  // Purge globale Redis non supportée sans SCAN — les clés expirent via TTL.
}

/**
 * Charge rôle + existence depuis la base (cache court si store sûr).
 * `null` = utilisateur absent / supprimé (hard delete Prisma cascade).
 * Pas de soft-delete dans le schéma actuel — « inactif » = n’existe plus.
 */
export async function loadUserAccess(
  userId: string,
  opts?: { bypassCache?: boolean }
): Promise<UserAccess | null> {
  const now = Date.now();
  const bypass = opts?.bypassCache === true;

  if (!bypass) {
    if (allowProcessCache()) {
      const hit = processAccessCache.get(userId);
      if (hit && hit.expiresAt > now) return hit.access;
    } else if (getKvBackend() === "upstash") {
      const raw = await kvGet(accessKey(userId));
      if (raw != null) {
        try {
          if (raw === "null") return null;
          return JSON.parse(raw) as UserAccess;
        } catch {
          /* corrupt → recharger */
        }
      }
    }
    // ephemeral memory store : pas de cache → DB directe
  }

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, username: true, email: true },
  });

  const access: UserAccess | null = row
    ? {
        id: row.id,
        role: normalizeRole(row.role),
        username: row.username,
        email: row.email,
      }
    : null;

  if (allowProcessCache()) {
    processAccessCache.set(userId, {
      access,
      expiresAt: now + ACCESS_TTL_MS,
    });
  } else if (getKvBackend() === "upstash" && !bypass) {
    await kvSet(
      accessKey(userId),
      access ? JSON.stringify(access) : "null",
      ACCESS_TTL_SEC
    );
  }

  return access;
}

/**
 * Session NextAuth obligatoire.
 * Le `role` renvoyé ici est celui du JWT (indicatif) — pour l’admin, utiliser `gateAdmin`.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const role = normalizeRole(session.user?.role);
  return {
    id,
    email: session.user?.email,
    name: session.user?.name,
    username: session.user?.username,
    role,
  };
}

/**
 * Vérifie que l’utilisateur existe encore en base (session non orpheline).
 */
export async function assertUserActive(userId: string): Promise<boolean> {
  const access = await loadUserAccess(userId);
  return access != null;
}

/**
 * userId de la session — isolation multi-compte.
 * Retourne null si non authentifié OU compte supprimé.
 */
export async function requireUserId(): Promise<string | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const active = await assertUserActive(user.id);
  if (!active) return null;
  return user.id;
}

/**
 * Résultat typé pour les routes admin (401 vs 403).
 */
export type AdminGate =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Admin : revalide **toujours** le rôle en base (bypass cache).
 * - 401 : pas de session / compte supprimé
 * - 403 : session valide mais plus (ou jamais) ADMIN
 *
 * Évite privilege escalation via cache multi-instance / JWT stale.
 */
export async function gateAdmin(): Promise<AdminGate> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { ok: false, status: 401, error: "Non authentifié" };
  }

  const access = await loadUserAccess(sessionUser.id, { bypassCache: true });
  if (!access) {
    await invalidateUserAccessCache(sessionUser.id);
    return {
      ok: false,
      status: 401,
      error: "Session invalide — compte introuvable ou supprimé",
    };
  }

  if (access.role !== "ADMIN") {
    return {
      ok: false,
      status: 403,
      error: "Accès réservé à l'administrateur",
    };
  }

  return {
    ok: true,
    user: {
      id: access.id,
      email: access.email,
      name: sessionUser.name,
      username: access.username,
      role: "ADMIN",
    },
  };
}

/**
 * Compat : null si non admin (ne distingue pas 401/403).
 * Préférer `gateAdmin` + `adminGateJson` sur les nouvelles routes.
 */
export async function requireAdmin(): Promise<SessionUser | null> {
  const gate = await gateAdmin();
  return gate.ok ? gate.user : null;
}

/** NextResponse 401/403 pour un échec gateAdmin. */
export function adminGateJson(
  gate: Extract<AdminGate, { ok: false }>
): NextResponse {
  return NextResponse.json({ error: gate.error }, { status: gate.status });
}
