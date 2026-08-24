import { test, expect, type Page } from "@playwright/test";

/**
 * Débordement horizontal de la page dans les familles d'Actifs alternatifs.
 *
 * Le défaut : un `<span class="sr-only">` — le libellé accessible de la
 * colonne d'actions — est en `position: absolute` sans aucun ancêtre
 * positionné. Son bloc conteneur est donc le document lui-même, et non le
 * conteneur de défilement de la table : il échappe au rognage et étire la page
 * jusqu'à la largeur du tableau. À 390 px, la fenêtre entière glissait de plus
 * de 900 px, emportant l'en-tête et la barre latérale.
 *
 * Le test mesure le défilement réellement obtenu — `window.scrollTo` puis
 * `scrollX` — et non une largeur calculée : `scrollWidth` reste supérieur à
 * `clientWidth` par la seule présence du tableau, qui a le droit de déborder
 * dans son propre conteneur. Seule compte la question posée à l'utilisateur :
 * la page part-elle de côté ?
 */

const FAMILLES = ["metals", "private-equity", "crowdlending", "tangibles"] as const;
const LARGEURS = [1440, 1024, 390] as const;

async function defilementPage(page: Page): Promise<number> {
  return page.evaluate(() => {
    const depart = window.scrollX;
    window.scrollTo(9999, 0);
    const atteint = window.scrollX;
    window.scrollTo(depart, 0);
    return atteint;
  });
}

for (const largeur of LARGEURS) {
  test.describe(`Alternatifs — ${largeur} px`, () => {
    for (const famille of FAMILLES) {
      test(`${famille} : la page ne part pas de côté`, async ({ page }) => {
        await page.setViewportSize({ width: largeur, height: 900 });
        await page.goto("/alternatifs", { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("alternatives-tab")).toBeVisible({
          timeout: 40_000,
        });
        await page.getByTestId(`alt-sub-${famille}`).click();
        // Le tableau doit être peuplé : c'est lui qui portait le débordement.
        await page.waitForTimeout(4000);

        expect(
          await defilementPage(page),
          `la page défile horizontalement sur ${famille} à ${largeur} px`
        ).toBe(0);
      });
    }
  });
}

test("un tableau large garde son propre défilement", async ({ page }) => {
  /*
    Le correctif ne doit pas se payer d'un tableau rogné : onze colonnes sur un
    écran de 390 px doivent rester atteignables, dans le conteneur prévu pour.
  */
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/alternatifs", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("alternatives-tab")).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("alt-sub-metals").click();
  await expect(page.getByTestId("precious-metals-table")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2500);

  const mesure = await page.evaluate(() => {
    const wrap = document.querySelector<HTMLElement>(".table-fluid-wrap");
    const table = document.querySelector<HTMLElement>(".table-fluid");
    if (!wrap || !table) return null;
    const debordement = wrap.scrollWidth - wrap.clientWidth;
    wrap.scrollLeft = 9999;
    /*
      Ce qui compte n'est pas la valeur de `scrollLeft` — le fond de course
      dépend de la gouttière réservée à la barre de défilement — mais le fait
      que la dernière colonne devienne atteignable.
    */
    const bordDroitVisible =
      table.getBoundingClientRect().right <= wrap.getBoundingClientRect().right + 12;
    wrap.scrollLeft = 0;
    return { debordement, bordDroitVisible };
  });

  expect(mesure, "conteneur de défilement introuvable").not.toBeNull();
  expect(
    mesure!.debordement,
    "le tableau ne déborde plus de son conteneur — il a été rogné"
  ).toBeGreaterThan(100);
  expect(
    mesure!.bordDroitVisible,
    "la dernière colonne reste hors d'atteinte après défilement"
  ).toBe(true);
});
