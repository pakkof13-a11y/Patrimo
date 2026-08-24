import { test, expect, type Page } from "@playwright/test";

/**
 * Indicateurs des familles Alternatifs — chargement, zéro réel, valeur réelle.
 *
 * Le défaut corrigé : `AltMiniKpi` n'avait aucune notion de chargement, et ses
 * dix-sept appels lisaient `summary?.X ?? "0"` avant de passer par
 * `formatCurrency`. L'absence de donnée devenait donc un montant nul *avant*
 * d'atteindre la tuile, qui n'avait aucun moyen de faire la différence. Sur
 * Métaux, « Valeur actuelle » annonçait 0,00 € pendant près de six secondes.
 *
 * Comme pour le bandeau patrimonial (P1-1), le test passe par une API
 * réellement ralentie : c'est la seule façon d'observer un état transitoire
 * sans dépendre de la vitesse de la machine.
 */

type Famille = {
  sous: string;
  section: string;
  api: string;
  /** Nombre de tuiles de la bande — il ne doit pas varier. */
  tuiles: number;
};

const FAMILLES: Famille[] = [
  { sous: "metals", section: "metals-section", api: "**/api/precious-metals**", tuiles: 4 },
  { sous: "private-equity", section: "private-equity-section", api: "**/api/private-equity**", tuiles: 4 },
  { sous: "crowdlending", section: "crowdlending-section", api: "**/api/crowdlending**", tuiles: 4 },
  { sous: "tangibles", section: "tangibles-section", api: "**/api/tangibles**", tuiles: 5 },
];

/**
 * La bande d'indicateurs.
 *
 * Repérée par les libellés de ses tuiles plutôt que par sa grille : la section
 * porte plusieurs grilles, et celles du formulaire apparaissent une fois les
 * données arrivées — un sélecteur de position désignerait alors deux éléments
 * différents avant et après. Le `.min-w-0 >` restreint aux tuiles de la bande,
 * la section employant `text-label` ailleurs.
 */
const TUILES = (section: string) =>
  `[data-testid="${section}"] .min-w-0 > .text-label`;

async function ouvrirRalenti(page: Page, f: Famille, ms: number) {
  await page.route(f.api, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  await page.goto("/alternatifs", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("alternatives-tab")).toBeVisible({ timeout: 40_000 });
  await page.getByTestId(`alt-sub-${f.sous}`).click();
}

for (const f of FAMILLES) {
  test.describe(`Indicateurs ${f.sous}`, () => {
    test("aucun montant nul n'est affirmé tant que la donnée n'est pas arrivée", async ({
      page,
    }) => {
      await ouvrirRalenti(page, f, 6000);
      const section = page.getByTestId(f.section);
      await expect(section).toBeVisible({ timeout: 30_000 });

      // Le point central : pas un seul montant nul présenté comme un fait.
      expect(
        (await section.innerText()).replace(/\s+/g, " "),
        `${f.sous} affiche un montant nul pendant le chargement`
      ).not.toMatch(/0,00\s*€/);
    });

    test("les tuiles restent en place et la grille ne saute pas", async ({ page }) => {
      await ouvrirRalenti(page, f, 5000);
      const libelles = page.locator(TUILES(f.section));
      await expect(libelles.first()).toBeVisible({ timeout: 30_000 });

      /*
        La mesure porte sur les tuiles elles-mêmes : c'est leur hauteur qui
        décide de celle de la bande, et elle ne doit pas varier entre le
        squelette et la donnée — sans quoi tout ce qui suit se déplace au
        moment où la requête revient.
      */
      const hauteurs = async () =>
        page.locator(TUILES(f.section)).evaluateAll((els) =>
          els.map((e) => Math.round((e.parentElement as HTMLElement).getBoundingClientRect().height))
        );

      await expect(libelles).toHaveCount(f.tuiles);
      const pendant = await hauteurs();

      await page.waitForTimeout(9000);
      await expect(libelles).toHaveCount(f.tuiles);
      const apres = await hauteurs();

      expect(
        apres,
        `${f.sous} : les tuiles changent de hauteur entre chargement et données`
      ).toEqual(pendant);
    });
  });
}

test("un montant réellement nul s'affiche bien 0,00 €", async ({ page }) => {
  /*
    La distinction qui compte : « pas encore chargé » et « chargé, et nul » ne
    doivent pas se ressembler. Ici la réponse arrive vraiment, avec des zéros —
    et la bande doit les afficher comme des montants.
  */
  await page.route("**/api/precious-metals**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    const zero: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.summary ?? {})) {
      zero[k] = typeof v === "string" ? "0" : typeof v === "number" ? 0 : v;
    }
    await route.fulfill({ response: res, json: { ...body, lines: [], summary: zero } });
  });

  await page.goto("/alternatifs", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("alternatives-tab")).toBeVisible({ timeout: 40_000 });
  await page.getByTestId("alt-sub-metals").click();

  const section = page.getByTestId("metals-section");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section, "un zéro réel doit s'afficher comme un montant").toContainText(
    "0,00 €",
    { timeout: 30_000 }
  );
});
