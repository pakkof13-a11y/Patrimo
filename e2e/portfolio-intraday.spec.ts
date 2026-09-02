import { test, expect } from "@playwright/test";

/**
 * L'endpoint de restitution intraday.
 *
 * Le compte de démonstration n'a aucune barre collectée — les fournisseurs ne
 * sont pas joignables et rien de synthétique n'est injecté en base. La réponse
 * attendue est donc une série **vide**, et c'est le comportement à verrouiller :
 * une fenêtre sans collecte ne doit ni échouer, ni inventer des points.
 *
 * Ce test vérifie aussi qu'une lecture n'écrit rien, en comparant les totaux du
 * patrimoine avant et après.
 */

const num = (v: unknown) => Number(v ?? 0);

test.describe("Restitution intraday", () => {
  test("reconstruit l'historique à partir des clôtures, sans instantané", async ({
    request,
  }) => {
    /*
      Le critère du chantier « historique reconstructible ».

      Aucune barre intra-séance n'a été collectée sur ce compte, et il n'existe
      pas d'instantané historique. La série existe quand même : les clôtures
      quotidiennes suffisent à valoriser les positions, et chaque point dit d'où
      vient son cours.

      Avant ce chantier, cette même requête rendait une série vide.
    */
    const res = await request.get("/api/portfolio/intraday?days=7");
    expect(res.ok(), `${res.status()} ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    expect(body.interval).toBe("1h");
    expect(body.days).toBe(7);
    expect(body.points.length).toBeGreaterThan(0);

    // Aucune barre intraday : la reconstruction passe par les clôtures.
    expect(body.observedFrom).toBeNull();
    expect(body.origins).toContain("DAILY_EXACT");
    expect(body.points[0].priceOrigin).toBeTruthy();

    // La couverture est annoncée plutôt que supposée complète.
    expect(body.coverage).toBeGreaterThan(0);
    expect(body.coverage).toBeLessThanOrEqual(1);
    for (const p of body.points) {
      expect(p.priceCoverage).toBeGreaterThanOrEqual(0);
      expect(p.priceCoverage).toBeLessThanOrEqual(1);
    }
  });

  test("une clôture ne se fait pas passer pour une observation de l'instant", async ({
    request,
  }) => {
    const body = await (await request.get("/api/portfolio/intraday?days=7")).json();

    /*
      Le filtre porte sur **toutes** les origines du point, pas sur la plus
      faible : une seule ligne sans historique — un actif créé par un autre test
      — suffirait sinon à ce qu'aucun point ne soit reconnu comme quotidien,
      alors que ses clôtures ont bien servi.
    */
    const quotidiens = body.points.filter((p: { priceOrigins: string[] }) =>
      p.priceOrigins.includes("DAILY_EXACT")
    );
    expect(quotidiens.length).toBeGreaterThan(0);

    // Le statut du point le dit : la journée est connue, pas l'heure.
    for (const p of quotidiens) expect(p.status).toBe("ESTIMATED");
  });

  test("la fenêtre demandée est bornée", async ({ request }) => {
    // 999 jours en pas horaire, ce serait 24 000 instants : la borne existe
    // pour que la lecture ne puisse pas être rendue coûteuse depuis l'URL.
    const res = await request.get("/api/portfolio/intraday?days=999");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).days).toBeLessThanOrEqual(31);
  });

  test("une valeur illisible retombe sur le défaut plutôt que d'échouer", async ({
    request,
  }) => {
    const res = await request.get("/api/portfolio/intraday?days=abc");
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).days).toBe(7);
  });

  test("consulter la série ne change aucun total", async ({ request }) => {
    const avant = await (await request.get("/api/portfolio")).json();
    await request.get("/api/portfolio/intraday?days=7");
    await request.get("/api/portfolio/intraday?days=31");
    const apres = await (await request.get("/api/portfolio")).json();

    expect(num(apres.summary?.netWorthEur)).toBeCloseTo(
      num(avant.summary?.netWorthEur),
      2
    );
    expect(num(apres.summary?.totalLiabilitiesEur)).toBeCloseTo(
      num(avant.summary?.totalLiabilitiesEur),
      2
    );
  });

  test("sans session, la série n'est pas servie", async ({ playwright }) => {
    // `newContext()` hérite du `storageState` du projet : sans état vide
    // explicite, la requête serait authentifiée et ce test ne prouverait rien.
    const anonyme = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    // Sans `maxRedirects: 0`, la requête suit la redirection du proxy jusqu'à
    // `/login`, qui répond 200 : on mesurerait la page de connexion, pas la
    // protection de la route.
    const res = await anonyme.get("http://127.0.0.1:3000/api/portfolio/intraday", {
      maxRedirects: 0,
    });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.headers()["location"] ?? "").toContain("/login");
    await anonyme.dispose();
  });
});
