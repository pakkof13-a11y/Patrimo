import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav } from "./helpers";

/**
 * Confidentialité : l'œil au-dessus des indicateurs masque les montants.
 *
 * Le parcours vaut d'être tenu de bout en bout parce que la fonction n'a de
 * valeur que si elle est complète : un seul montant resté lisible et la
 * bascule ne protège rien. Le test vérifie donc la tuile *et* le chiffre de
 * tête, puis le retour à l'état lisible.
 */
test.describe("Confidentialité des montants", () => {
  test("masque puis réaffiche les montants, et le choix survit au rechargement", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await gotoDashboard(page);
    await clickNav(page, "Tableau de bord");

    const toggle = page.getByTestId("privacy-toggle");
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    const netWorth = page.getByTestId("hero-net-worth");
    const tile = page.getByTestId("kpi-listed");
    const clearNetWorth = (await netWorth.innerText()).trim();

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(netWorth).toHaveText("****");
    await expect(tile).toContainText("****");

    // Un réglage de confidentialité qui se réarme tout seul à la visite
    // suivante n'est pas un réglage : il doit tenir au rechargement.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hero-net-worth")).toHaveText("****", {
      timeout: 20_000,
    });

    await page.getByTestId("privacy-toggle").click();
    await expect(page.getByTestId("hero-net-worth")).not.toHaveText("****");
    if (clearNetWorth) {
      await expect(page.getByTestId("hero-net-worth")).toHaveText(
        clearNetWorth
      );
    }
  });
});
