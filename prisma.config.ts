import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Configuration Prisma 7 (CLI : generate, migrate, introspection).
 * Le client runtime utilise le driver adapter Neon (voir app/lib/prisma.ts).
 *
 * ## DATABASE_URL optionnelle au `generate`
 *
 * Sur Vercel, `npm ci` lance `postinstall` → `prisma generate` **avant** que
 * certaines variables ne soient toujours présentes (ou sur un env Preview
 * sans DATABASE_URL). `env("DATABASE_URL")` de prisma/config **jette** si la
 * var manque → build cassé avec PrismaConfigEnvError.
 *
 * `prisma generate` n'a pas besoin d'une vraie base : un placeholder suffit.
 * `migrate deploy` / seed doivent toujours avoir la vraie URL (runtime / job).
 */
const datasourceUrl =
  process.env.DATABASE_URL?.trim() ||
  "postgresql://prisma:prisma@127.0.0.1:5432/prisma_generate_placeholder";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
