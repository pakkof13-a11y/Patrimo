import { test, expect } from "@playwright/test";

/**
 * Une échéance dit depuis quand elle attend — et rien de plus.
 *
 * Le panneau proposait cinquante-huit lignes dont seule la date distinguait
 * celle d'avril 2024 de celle du mois dernier. L'ancienneté est désormais
 * écrite, parce que personne ne fait la soustraction de tête sur une telle
 * liste.
 *
 * Ce que ce test protège autant que l'affichage : le module ne requalifie
 * pas. Il ne dit pas « impayé » — cela supposerait de savoir si le locataire
 * a payé, ce qu'Aurea ignore — et consulter la liste n'encaisse rien.
 */

test.describe("Échéancier de loyers", () => {
  test("chaque échéance passée dit depuis quand elle attend", async ({
    page,
  }) => {
    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    await page.getByTestId("re-subtab-rents").click();

    const panneau = page.getByTestId("rent-schedule-panel");
    await expect(panneau).toBeVisible({ timeout: 30_000 });
    await expect(panneau).toContainText("Échéances à confirmer");
    await expect(panneau).toContainText(/rien n'est enregistré/i);

    const ages = page.getByTestId("rent-age");
    const n = await ages.count();
    test.skip(n === 0, "Aucune échéance en attente dans le jeu de démonstration");

    // Chaque puce nomme une durée, jamais un statut de paiement.
    for (const texte of await ages.allInnerTexts()) {
      expect(texte).toMatch(/^échue depuis \d+ (mois|ans?)$/);
    }
    await expect(panneau).not.toContainText(/impay/i);
    await expect(panneau).not.toContainText(/retard de paiement/i);
  });

  test("consulter l'échéancier n'encaisse rien", async ({ page, request }) => {
    /*
      L'invariant qui compte : une échéance échue depuis deux ans ne doit pas
      devenir du cash parce qu'on a regardé la liste.
    */
    const avant = await request.get("/api/holdings").then((r) => r.json());
    const cashAvant = Number(avant.summary?.totalCashEur ?? 0);
    const revenusAvant = Number(avant.summary?.cashIncomeEur ?? 0);

    await page.goto("/immobilier", { waitUntil: "domcontentloaded" });
    await page.getByTestId("re-subtab-rents").click();
    await expect(page.getByTestId("rent-schedule-panel")).toBeVisible({
      timeout: 30_000,
    });

    const apres = await request.get("/api/holdings").then((r) => r.json());
    expect(Number(apres.summary?.totalCashEur ?? 0)).toBeCloseTo(cashAvant, 2);
    expect(Number(apres.summary?.cashIncomeEur ?? 0)).toBeCloseTo(
      revenusAvant,
      2
    );
  });
});
