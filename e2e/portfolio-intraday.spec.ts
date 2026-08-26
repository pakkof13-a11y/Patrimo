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
  test("rend une série vide quand rien n'a été collecté", async ({ request }) => {
    const res = await request.get("/api/portfolio/intraday?days=7");
    expect(res.ok(), `${res.status()} ${await res.text()}`).toBeTruthy();

    const body = await res.json();
    expect(body.interval).toBe("1h");
    expect(body.days).toBe(7);
    expect(body.observedFrom).toBeNull();
    expect(body.points).toEqual([]);
    expect(body.extremes).toBeNull();
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
