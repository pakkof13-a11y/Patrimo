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

    /*
      Attendre la donnée, et non seulement l'élément.

      Le chiffre de tête a trois états : un squelette sans `data-testid`, un
      tiret cadratin tant que la valeur est nulle, puis le montant. Les deux
      derniers portent le même identifiant, si bien qu'un `innerText()` immédiat
      n'attend que le second — et fige « — » comme s'il s'agissait d'une valeur.

      La suite du test comparait alors le montant réaffiché à ce tiret : échec
      si la donnée arrivait entre-temps, réussite creuse sinon. On attend donc
      que le tiret ait cédé la place avant de capturer.
    */
    await expect(netWorth).not.toHaveText("—", { timeout: 20_000 });
    const clearNetWorth = (await netWorth.innerText()).trim();

    /*
      Et l'on vérifie que ce qu'on a capturé est bien un montant : chiffres,
      séparateurs de milliers et signe, rien d'autre. Sans ce contrôle, un
      futur placeholder rendrait de nouveau la comparaison finale vide de sens
      sans que rien ne le signale. `\s` couvre les espaces insécables fine et
      normale, séparateurs de milliers rendus par `toLocaleString("fr-FR")`.
    */
    expect(
      clearNetWorth,
      `chiffre de tête attendu numérique, obtenu « ${clearNetWorth} »`
    ).toMatch(/^-?\d[\d\s]*$/);

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
    // La valeur capturée est un montant vérifié : la comparaison a un sens et
    // n'a plus besoin d'être gardée par un `if`, qui la rendait facultative.
    await expect(page.getByTestId("hero-net-worth")).toHaveText(clearNetWorth);
  });
});
