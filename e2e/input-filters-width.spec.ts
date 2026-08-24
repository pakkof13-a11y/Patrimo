import { test, expect, type Page } from "@playwright/test";

/**
 * Largeur des filtres de Trading et Plateformes.
 *
 * Ces deux barres portent les seuls `!w-auto` posés en urgence du dépôt : sans
 * le `!`, la déclaration hors couche `.input { width: 100% }` l'emportait sur
 * l'utilitaire `w-auto`, et les quatre sélecteurs s'empilaient verticalement à
 * 1440 px. Le chantier responsive P6 l'a corrigé.
 *
 * Le correctif tient à un mécanisme de cascade qu'on s'apprête à modifier. Ce
 * test protège le résultat, pas le moyen : il ne vérifie ni le `!`, ni la
 * classe, ni une hauteur — il mesure ce que l'utilisateur voit, c'est-à-dire
 * qu'un filtre reste plus étroit que sa barre et que les filtres tiennent sur
 * une même ligne tant que la place existe.
 */

/** Largeurs de l'audit responsive, plus le mobile. */
const WIDTHS = [1440, 1280, 1024, 375] as const;

/**
 * Seuil du contrôle d'empilement.
 *
 * Ces barres sont en `flex-wrap` : passer à la ligne quand la place manque est
 * le comportement voulu, et Trading le fait dès 1280 px parce que sa recherche
 * réclame 13 rem. Le défaut à surveiller n'est donc pas « ça passe à la ligne »
 * mais « chaque filtre prend sa propre ligne » — l'empilement vertical intégral
 * d'avant le correctif. En dessous de 1280 px, même cet état est légitime.
 */
const STACKING_CHECKED_FROM = 1280;

type Zone = {
  label: string;
  url: string;
  toolbar: string;
  /** Les sélecteurs de filtre, ceux qui portent `w-auto`. */
  filters: string[];
};

const ZONES: Zone[] = [
  {
    label: "Trading",
    url: "/trading",
    toolbar: "trading-toolbar",
    filters: [
      "trading-direction-filter",
      "trading-underlying-filter",
      "trading-sort",
    ],
  },
  {
    label: "Plateformes",
    url: "/plateformes",
    toolbar: "platforms-toolbar",
    filters: ["platforms-type-filter", "platforms-sort-mode"],
  },
];

async function boxes(page: Page, zone: Zone) {
  const toolbar = page.getByTestId(zone.toolbar);
  await expect(toolbar).toBeVisible({ timeout: 30_000 });
  const toolbarBox = (await toolbar.boundingBox())!;
  const filters: Array<{ id: string; x: number; y: number; width: number }> = [];
  for (const id of zone.filters) {
    const el = page.getByTestId(id);
    if ((await el.count()) === 0) continue;
    const b = await el.boundingBox();
    if (b) filters.push({ id, x: b.x, y: b.y, width: b.width });
  }
  return { toolbarBox, filters };
}

for (const zone of ZONES) {
  test.describe(`Filtres ${zone.label} — largeur`, () => {
    for (const width of WIDTHS) {
      test(`${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(zone.url, { waitUntil: "domcontentloaded" });

        const { toolbarBox, filters } = await boxes(page, zone);
        expect(filters.length, "aucun filtre trouvé").toBeGreaterThan(0);

        /*
          Le défaut d'origine, dit en une mesure : un filtre aussi large que sa
          barre est un filtre revenu à `width: 100%`. La marge de 8 px absorbe
          le padding de la barre sans laisser passer un champ pleine largeur.
        */
        for (const f of filters) {
          expect(
            f.width,
            `${f.id} occupe toute la barre — width: 100% est revenu`
          ).toBeLessThan(toolbarBox.width - 8);
        }

        /*
          La largeur naturelle a aussi une borne basse : un sélecteur écrasé à
          quelques pixels serait illisible sans jamais déborder.
        */
        for (const f of filters) {
          expect(f.width, `${f.id} est trop étroit pour être lisible`).toBeGreaterThan(40);
        }

        // Aucun débordement horizontal de la page, à aucune largeur.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, "la page défile horizontalement").toBeLessThanOrEqual(1);

        if (width >= STACKING_CHECKED_FROM && filters.length >= 2) {
          /*
            Le cœur du correctif P6, dit par les ordonnées plutôt que par un
            décompte de lignes ou une hauteur de barre : au moins deux filtres
            partagent une ligne. Un filtre par ligne, c'est le défaut d'origine.
          */
          const rows = new Set(filters.map((f) => Math.round(f.y)));
          expect(
            rows.size,
            `un filtre par ligne à ${width} px : ${filters
              .map((f) => `${f.id}@y=${Math.round(f.y)}`)
              .join(", ")}`
          ).toBeLessThan(filters.length);
        }
      });
    }
  });
}
