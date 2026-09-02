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

/**
 * Refuse un serveur déjà à l'écoute qui ne serait pas celui des tests.
 *
 * `reuseExistingServer` est vrai en local : si un `npm run dev` ordinaire
 * occupe déjà le port, Playwright le réutilise tel quel — avec la base de
 * **travail**, pas la base isolée. La suite s'exécute alors contre les vraies
 * données : les comptes créés par les tests s'y accumulent, un locator finit
 * par désigner cinq lignes au lieu d'une, et des tests échouent pour une
 * raison qui n'a rien à voir avec le code. C'est arrivé, et le diagnostic a
 * coûté cher.
 *
 * On préfère donc échouer immédiatement, avec la marche à suivre. Aucun
 * serveur en écoute = rien à vérifier : Playwright lancera le sien.
 */
async function assertServerIsE2E(): Promise<void> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

  let health: { e2e?: boolean } | null = null;
  try {
    const res = await fetch(`${baseURL}/api/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    health = (await res.json()) as { e2e?: boolean };
  } catch {
    return; // personne n'écoute : Playwright démarrera son propre serveur
  }

  if (health?.e2e === true) return;

  throw new Error(
    [
      `[e2e] Un serveur répond déjà sur ${baseURL} mais n'a pas été lancé pour les tests.`,
      "",
      "Il utilise donc DATABASE_URL (base de travail) et non DATABASE_URL_E2E :",
      "les fixtures des tests iraient polluer vos vraies données, et la suite",
      "échouerait sur des résidus plutôt que sur des régressions.",
      "",
      "Arrêtez ce serveur, ou relancez-le avec la base des tests :",
      "  DATABASE_URL=$DATABASE_URL_E2E E2E=1 npx next dev --webpack",
    ].join("\n")
  );
}

export default async function globalSetup() {
  const root = path.resolve(__dirname, "..");

  // .env puis .env.e2e (surcharge locale dédiée aux tests)
  dotenv.config({ path: path.join(root, ".env") });
  dotenv.config({ path: path.join(root, ".env.e2e"), override: true });

  const e2eDb = (process.env.DATABASE_URL_E2E || "").trim();
  const isolatedDb = Boolean(e2eDb);
  if (e2eDb) {
    process.env.DATABASE_URL = e2eDb;
    console.log(
      "[e2e] DATABASE_URL_E2E active → base isolée (données dev non touchées)."
    );
    await assertServerIsE2E();
  } else {
    console.log(
      "[e2e] Même DATABASE_URL que l’app. Seed E2E = wipe compte **demo** uniquement (admin préservé, donc non vierge : les specs cockpit seront ignorées)."
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
      /*
        Admin vidé, jamais regarni — et seulement sur base isolée.

        Les specs « cockpit » se connectent en admin pour décrire l'écran d'un
        compte sans données. Préserver admin gardait les résidus d'un seed
        complet antérieur, et ces specs échouaient en permanence. La base
        jetable est la seule où l'effacer est sans risque : c'est cette
        certitude, établie plus haut, que le drapeau transporte.
      */
      ...(isolatedDb ? { SEED_WIPE_ADMIN: "1" } : {}),
    },
  });
  console.log("[e2e] Seed done (compte demo uniquement).");
}
