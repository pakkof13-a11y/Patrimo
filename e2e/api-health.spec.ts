import { test, expect } from "@playwright/test";

test.describe("API santé", () => {
  test("GET /api/health OK (public)", async ({ request }) => {
    // health reste public (pas de cookie requis)
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { ok?: boolean; db?: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe("ok");
  });

  test("holdings, portfolio et transactions répondent (session)", async ({
    request,
  }) => {
    // storageState du projet chromium injecte la session demo
    const holdings = await request.get("/api/holdings?base=EUR");
    expect(holdings.ok()).toBeTruthy();
    const h = await holdings.json();
    expect(Array.isArray(h.holdings)).toBeTruthy();
    expect(h.summary).toBeTruthy();

    const portfolio = await request.get("/api/portfolio?base=EUR");
    expect(portfolio.ok()).toBeTruthy();
    const p = await portfolio.json();
    expect(p.summary).toBeTruthy();

    /*
      `history[]` n'existe plus sur `GET /api/portfolio` : la route rejouait
      le moteur sur toute la profondeur lisible pour la produire, et c'est ce
      rejeu qui la faisait tomber en 504 en préproduction (cf. commentaire de
      `app/api/portfolio/route.ts`). La série vit désormais dans
      `GET /api/portfolio/daily-nav`, et c'est elle qui porte le contrôle
      équivalent : un tableau de points non vide.
    */
    const dailyNav = await request.get("/api/portfolio/daily-nav?scope=net");
    expect(dailyNav.ok()).toBeTruthy();
    const d = await dailyNav.json();
    expect(Array.isArray(d.points)).toBeTruthy();
    expect(d.points.length).toBeGreaterThan(0);

    const tx = await request.get("/api/transactions");
    expect(tx.ok()).toBeTruthy();
    const t = await tx.json();
    expect(Array.isArray(t.transactions)).toBeTruthy();
  });
});
