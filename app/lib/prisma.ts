import { PrismaClient } from "@/app/lib/prisma-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma 7 — un driver adapter est obligatoire (pas de moteur "sans adapter").
 *
 * webSocketConstructor : le Pool WebSocket de Neon a besoin d'un constructeur
 * WebSocket. Node 22 et les runtimes edge exposent `WebSocket` en global ;
 * on ne le câble que s'il existe (conditionnel selon l'environnement), sinon
 * on laisse Neon utiliser son propre chemin.
 */
if (
  typeof neonConfig.webSocketConstructor === "undefined" &&
  typeof globalThis.WebSocket !== "undefined"
) {
  neonConfig.webSocketConstructor = globalThis.WebSocket;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Neon (WebSocket) uniquement contre une vraie base Neon / en prod Vercel.
 * Un Postgres classique (local, CI, docker-compose) ne parle pas le
 * protocole proxy WebSocket de Neon → on bascule sur l'adapter `pg`
 * (node-postgres, connexion TCP standard) dans ce cas.
 */
function shouldUseNeonAdapter(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url.includes("neon.tech") || process.env.VERCEL === "1";
}

/**
 * Fabrique un client Prisma autonome (adapter câblé selon l'environnement).
 * Utilisée par le singleton ci-dessous et par les scripts one-shot (seed,
 * diagnostics) qui gèrent eux-mêmes leur cycle de vie via `$disconnect()`.
 */
export function createPrismaClient(): PrismaClient {
  const log: ("error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (shouldUseNeonAdapter()) {
    const adapter = new PrismaNeon({
      connectionString: process.env.DATABASE_URL,
    });
    return new PrismaClient({ adapter, log });
  }

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({ adapter, log });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
