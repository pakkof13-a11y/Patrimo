import { test, expect } from "@playwright/test";

/**
 * Le harnais ne doit pas se tirer dessus : course ECONNRESET sur socket réutilisé.
 *
 * ## Le mécanisme
 *
 * Le serveur Next ferme un socket inactif au bout de ~6 s. Le client HTTP de
 * Playwright est un `http.Agent({ keepAlive: true })` de Node, qui n'a aucun
 * délai d'inactivité : il ne retire jamais un socket de son pool de lui-même,
 * il attend le FIN du serveur. Le serveur est donc toujours celui qui ferme —
 * et quand sa fermeture tombe pendant qu'une requête part sur ce socket, elle
 * échoue en ECONNRESET / « socket hang up ».
 *
 * Mesuré avant correction : 2 échecs sur 25 avec une inactivité de 5 990 ms,
 * soit juste *en deçà* du seuil. C'est la signature d'une course, pas d'un
 * socket simplement expiré : au-delà du seuil le FIN est déjà arrivé et le pool
 * écarte le socket proprement.
 *
 * ## Ce que ce test vérifie
 *
 * L'invariant qui rend la course impossible, et non l'absence du symptôme :
 * le seuil d'inactivité du serveur dépasse le budget d'un test. Comme un
 * contexte de requêtes ne survit pas au test qui le porte, aucun socket ne peut
 * vivre assez longtemps pour que le serveur le ferme — la fermeture vient
 * toujours du client, à la libération du contexte, ce qui n'est pas une course.
 *
 * Ce contrôle se lit dans l'en-tête `Keep-Alive` que le serveur annonce : il
 * est instantané et déterministe, là où reproduire la course demanderait de
 * répéter des attentes de six secondes sans jamais garantir de la déclencher.
 */

/*
 * `--keepAliveTimeout` n'existe que sur `next start`. Le serveur de
 * développement garde son seuil par défaut : on ne l'exige donc que sur la
 * configuration réellement utilisée pour les longues séries — celle de la CI
 * et de PLAYWRIGHT_PROD_SERVER=1.
 */
const serveurDeProduction =
  !!process.env.CI || process.env.PLAYWRIGHT_PROD_SERVER === "1";

/** Le budget d'un test, tel que déclaré dans playwright.config.ts. */
const BUDGET_TEST_MS = 90_000;

test.describe("Harnais E2E — connexions persistantes", () => {
  test.skip(
    !serveurDeProduction,
    "Seuil réglable uniquement sur next start (CI ou PLAYWRIGHT_PROD_SERVER=1)"
  );

  test("le serveur ne ferme pas un socket avant la fin du test qui l'utilise", async ({
    request,
  }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBe(true);

    /*
      Node annonce son seuil en secondes dans l'en-tête `Keep-Alive`. Son
      absence signifierait que le serveur ne promet rien du tout — un état
      qu'on refuse tout autant qu'un seuil trop court.
    */
    const entete = res.headers()["keep-alive"];
    expect(
      entete,
      "le serveur E2E doit annoncer son seuil d'inactivité"
    ).toBeTruthy();

    const secondes = Number(/timeout=(\d+)/.exec(entete ?? "")?.[1]);
    expect(Number.isFinite(secondes)).toBe(true);

    expect(
      secondes * 1000,
      "le seuil d'inactivité du serveur doit dépasser le budget d'un test, " +
        "sans quoi il peut fermer un socket que Playwright s'apprête à réutiliser"
    ).toBeGreaterThan(BUDGET_TEST_MS);
  });

  test("un socket du pool reste réutilisable d'une requête à l'autre", async ({
    request,
  }) => {
    /*
      Le pendant fonctionnel du contrôle précédent : la persistance reste bien
      active. Un serveur qui répondrait `Connection: close` à chaque requête
      n'aurait lui non plus aucune course — mais pour une mauvaise raison, et
      le premier test passerait sans rien garantir.
    */
    const premiere = await request.get("/api/health");
    expect(premiere.headers()["connection"]).toBe("keep-alive");

    const seconde = await request.get("/api/health");
    expect(seconde.ok()).toBe(true);
  });
});
