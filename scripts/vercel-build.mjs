#!/usr/bin/env node
/**
 * Build Vercel : applique les migrations Prisma en attente avant `next build`.
 *
 * `npm run build` (déclenché par Vercel) ne passait jamais par
 * `prisma migrate deploy` — chaque migration ajoutée au repo devait être
 * appliquée à la main à la base de prod, et ça a fini par ne pas l'être
 * (ex. LifeInsuranceSupport, jamais créée en prod alors que le code la lit
 * depuis plusieurs jours → 500 en cascade sur /api/holdings, /api/portfolio).
 *
 * Sans DATABASE_URL (Preview sans base attachée), on saute simplement l'étape :
 * `migrate deploy` ne peut de toute façon rien faire sans base réelle.
 */
import { spawnSync } from "node:child_process";

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (process.env.DATABASE_URL?.trim()) {
  console.log("[build] DATABASE_URL présente — application des migrations Prisma…");
  run("npx", ["prisma", "migrate", "deploy"]);
} else {
  console.log("[build] Pas de DATABASE_URL — migrations ignorées (build sans base).");
}

run("npx", ["next", "build"]);
