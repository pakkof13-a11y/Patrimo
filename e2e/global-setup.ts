/**
 * Prépare l’environnement E2E avant la suite Playwright.
 *
 * Sécurité données :
 * - N’efface PAS le compte admin (seed E2E = demo uniquement).
 * - Si DATABASE_URL_E2E est défini, les tests utilisent cette base isolée
 *   (recommandé : ne jamais pointer Playwright sur la DB de travail).
 */
import { execSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");

  // .env puis .env.e2e (surcharge locale dédiée aux tests)
  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, ".env.e2e"), override: true });

  const e2eDb = (process.env.DATABASE_URL_E2E || "").trim();
  if (e2eDb) {
    process.env.DATABASE_URL = e2eDb;
    console.log(
      "[e2e] DATABASE_URL_E2E active → base isolée (données dev non touchées)."
    );
  } else {
    console.log(
      "[e2e] Même DATABASE_URL que l’app. Seed E2E = wipe compte **demo** uniquement (admin préservé)."
    );
    console.log(
      "[e2e] Astuce : définissez DATABASE_URL_E2E dans .env.e2e pour une base séparée."
    );
  }

  if (process.env.E2E_SKIP_SEED === "1") {
    console.log("[e2e] E2E_SKIP_SEED=1 → seed ignoré.");
    return;
  }

  console.log("[e2e] Running prisma seed (demo only, SEED_LIGHT)…");
  execSync("npx tsx prisma/seed.ts", {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      // Dataset léger pour e2e
      SEED_LIGHT: "1",
      E2E: "1",
      PLAYWRIGHT: "1",
      // Force : ne pas re-seed admin même si autre flag
      SEED_DEMO_ONLY: "1",
      SEED_ADMIN_ONLY: "0",
    },
  });
  console.log("[e2e] Seed done (compte demo uniquement).");
}
