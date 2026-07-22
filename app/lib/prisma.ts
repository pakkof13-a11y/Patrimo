import { PrismaClient } from "@/app/lib/prisma-client/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

/**
 * Prisma 7 — driver adapter Neon obligatoire.
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
 * Fabrique un client Prisma autonome (adapter Neon câblé). Utilisée par le
 * singleton ci-dessous et par les scripts one-shot (seed, diagnostics) qui
 * gèrent eux-mêmes leur cycle de vie via `$disconnect()`.
 */
export function createPrismaClient(): PrismaClient {
  const adapter = new PrismaNeon({
    connectionString: process.env.DATABASE_URL,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
