import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "node:path";

// .env puis .env.e2e (surcharge : DB isolée, credentials e2e, …)
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, ".env.e2e"), override: true });

// Base isolée pour E2E si définie (ne touche pas la DB de travail)
if (process.env.DATABASE_URL_E2E?.trim()) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_E2E.trim();
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";
const isCI = !!process.env.CI;
const authFile = path.join(__dirname, "e2e", ".auth", "user.json");

/**
 * En local : réutilise le serveur Next déjà lancé sauf si PLAYWRIGHT_FORCE_SERVER=1.
 * Évite de redémarrer l’app (et de croiser la DB) à chaque run.
 * CI : démarre toujours son propre serveur.
 */
const reuseExistingServer =
  !isCI && process.env.PLAYWRIGHT_FORCE_SERVER !== "1";

/** Budget d'un test, réutilisé plus bas pour borner la vie d'un socket. */
const TEST_TIMEOUT_MS = 90_000;

/**
 * Seuil d'inactivité des connexions du serveur E2E.
 *
 * Le serveur Next ferme par défaut un socket inactif au bout de ~6 s (6 006 ms
 * mesurés). Le client HTTP de Playwright — un `http.Agent({ keepAlive: true })`
 * de Node — n'a, lui, aucun délai d'inactivité : il ne retire jamais un socket
 * de son pool de sa propre initiative, il attend le FIN du serveur. Le serveur
 * est donc toujours celui qui ferme, et quand sa fermeture tombe pendant qu'une
 * requête part sur ce même socket, elle échoue en ECONNRESET / socket hang up.
 * Mesuré sur HEAD : 2 échecs sur 25 avec une inactivité de 5 990 ms, juste en
 * deçà du seuil — la signature d'une course, et non d'un socket expiré.
 *
 * La documentation de Next prescrit exactement ce remède : le seuil du serveur
 * doit être *supérieur* à celui du client en aval. Ici le client n'en a pas ;
 * ce qui borne la vie d'un socket est donc la vie de son contexte, et un
 * contexte de requêtes ne survit pas au test qui le porte. Un seuil serveur
 * supérieur au budget d'un test garantit que le serveur ne peut jamais fermer
 * un socket encore utilisable : la fermeture vient toujours du client, à la
 * libération du contexte — ce qui n'est pas une course.
 *
 * Le double du budget d'un test laisse de la marge sans rien masquer : un
 * socket réellement bloqué au-delà se voit toujours, par le délai du test.
 */
const KEEP_ALIVE_TIMEOUT_MS = TEST_TIMEOUT_MS * 2;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // workers=1 : même user demo + seed partagé (évite courses multi-tenant)
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
  reporter: isCI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["github"]]
    : [["list"]],
  timeout: TEST_TIMEOUT_MS,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: isCI ? "retain-on-failure" : "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : undefined,
  },
  webServer: {
    /*
      Serveur de production pour les longues séries.

      En local, la suite tourne par défaut contre `next dev`, pratique quand on
      itère sur quelques specs. Sur la suite **complète**, ce choix se paie :
      le serveur de développement conserve modules compilés, source maps et
      état HMR de chaque route visitée, et après trois cents tests il atteint
      son propre seuil mémoire — « Server is approaching the used memory
      threshold, restarting... ». Le redémarrage tombe au milieu d'un test, qui
      échoue sur une donnée jamais chargée : un faux négatif que rien dans le
      code applicatif n'explique, et qu'un retry masquerait au lieu de le
      supprimer.

      `PLAYWRIGHT_PROD_SERVER=1` lance le serveur de production à la place — le
      même que la CI, qui ne connaît pas ce problème. Il exige un `npm run
      build` préalable, d'où le choix d'une option explicite plutôt que d'un
      défaut.

      Webpack plutôt que Turbopack en développement : plus stable pour l'e2e.

      `--keepAliveTimeout` : voir KEEP_ALIVE_TIMEOUT_MS ci-dessus. L'option
      n'existe que sur `next start` ; le serveur de développement conserve donc
      son seuil par défaut, ce qui est acceptable pour les quelques specs qu'on
      y lance mais pas pour une longue série.
    */
    command:
      isCI || process.env.PLAYWRIGHT_PROD_SERVER === "1"
        ? `npm run start -- --keepAliveTimeout ${KEEP_ALIVE_TIMEOUT_MS}`
        : "npx next dev --hostname 127.0.0.1 -p 3000 --webpack",
    url: baseURL,
    reuseExistingServer,
    timeout: 180_000,
    env: {
      ...process.env,
      // Propager la DB e2e au process Next si isolée
      ...(process.env.DATABASE_URL_E2E?.trim()
        ? { DATABASE_URL: process.env.DATABASE_URL_E2E.trim() }
        : {}),
      ALLOW_DEMO_FALLBACK: "false",
      SEED_LIGHT: "1",
      E2E: "1",
      PLAYWRIGHT: "1",
      // Pas d’appels calendrier macro externes (évite HTTP 429 faireconomy)
      MACRO_LIVE_DISABLED: "1",
      // Aligner NextAuth sur baseURL Playwright (évite localhost vs 127.0.0.1)
      AUTH_URL: baseURL,
      NEXTAUTH_URL: baseURL,
      // AUTH_URL vu différemment selon le bundle (middleware vs route handler
      // Next) selon l'environnement → Auth.js rejette le Host en UntrustedHost
      // même quand il correspond à baseURL. Sans risque ici (E2E local/CI,
      // serveur éphémère non exposé) : on fait confiance au Host réel de la
      // requête plutôt qu'à une AUTH_URL canonique stricte.
      AUTH_TRUST_HOST: "true",
    },
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
