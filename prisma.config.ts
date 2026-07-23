import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * Configuration Prisma 7 (remplace le chargement auto de .env + les réglages
 * dans le bloc datasource). Le client runtime utilise le driver adapter Neon
 * (voir app/lib/prisma.ts) ; ce fichier sert au CLI (generate, migrate,
 * introspection) qui lit DATABASE_URL via dotenv.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
