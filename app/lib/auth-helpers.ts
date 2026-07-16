import { auth } from "@/auth";
import { prisma } from "./prisma";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  username?: string;
  role: "ADMIN" | "USER";
};

/**
 * Session NextAuth obligatoire.
 * Retourne null si non authentifié (les routes API répondent 401).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  const role = session.user?.role === "ADMIN" ? "ADMIN" : "USER";
  return {
    id,
    email: session.user?.email,
    name: session.user?.name,
    username: session.user?.username,
    role,
  };
}

/**
 * userId de la session — isolation multi-compte.
 * Ne tombe plus sur un compte démo partagé.
 */
export async function requireUserId(): Promise<string | null> {
  const user = await getSessionUser();
  return user?.id ?? null;
}

export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}

/** Vérifie que l'utilisateur existe encore en base (session non révoquée). */
export async function assertUserActive(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return Boolean(u);
}
