import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { UserRole } from "@/types/next-auth";
import { normalizeRole } from "./auth/role";
import { prisma } from "./prisma";

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
type CacheEntry = { access: UserAccess | null; expiresAt: number };
const accessCache = new Map<string, CacheEntry>();

/**
 * Invalide le cache d’accès (après changement de rôle, suppression, etc.).
 */
export function invalidateUserAccessCache(userId?: string): void {
  if (userId) {
    accessCache.delete(userId);
    return;
  }
  accessCache.clear();
}

/**
 * Charge rôle + existence depuis la base (avec cache court).
 * `null` = utilisateur absent / supprimé (hard delete Prisma cascade).
 * Pas de soft-delete dans le schéma actuel — « inactif » = n’existe plus.
 */
export async function loadUserAccess(
  userId: string,
  opts?: { bypassCache?: boolean }
): Promise<UserAccess | null> {
  const now = Date.now();
  if (!opts?.bypassCache) {
    const hit = accessCache.get(userId);
    if (hit && hit.expiresAt > now) return hit.access;
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

  accessCache.set(userId, { access, expiresAt: now + ACCESS_TTL_MS });
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
 * Admin : revalide le rôle en base (cache ≤ 30 s).
 * - 401 : pas de session / compte supprimé
 * - 403 : session valide mais plus (ou jamais) ADMIN
 */
export async function gateAdmin(): Promise<AdminGate> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return { ok: false, status: 401, error: "Non authentifié" };
  }

  // Toujours revalider le rôle côté DB pour les privilèges élevés
  const access = await loadUserAccess(sessionUser.id);
  if (!access) {
    invalidateUserAccessCache(sessionUser.id);
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
