import type { UserRole } from "@/types/next-auth";

/** Normalise JWT / DB / session → UserRole (jamais undefined). */
export function normalizeRole(role: string | null | undefined): UserRole {
  return role === "ADMIN" ? "ADMIN" : "USER";
}
