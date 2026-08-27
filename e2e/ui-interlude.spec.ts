import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Passe UI ciblée : icônes de navigation, couleurs du journal d'activité,
 * libellés et défilement de l'assurance-vie, logo du prêteur.
 *
 * Les couleurs sont vérifiées par le **jeton** appliqué (`val-positive`,
 * `val-warning`…), jamais par un code hexadécimal : le design system porte
 * déjà les variantes claire et sombre de chacun, et figer une valeur ici
 * casserait au premier ajustement de palette.
 */

test.describe("Interlude UI", () => {
  test("navigation : PEA & CTO porte un porte-cartes, Banques le fronton", async ({
    page,
  }) => {
    await gotoDashboard(page);
    // Les sous-entrées vivent dans le repli « Avoirs » : l'ouvrir d'abord.
    await page.getByTestId("nav-group-avoirs").click();
    await expect(page.getByTestId("nav-group-avoirs-menu")).toBeVisible({
      timeout: 10_000,
    });

    /*
      Les deux icônes ont été échangées : un fronton à colonnes dit « banque »,
      pas « enveloppe fiscale ». Lucide émet une classe par icône, ce qui rend
      l'identité vérifiable sans comparer des pixels.
    */
    await expect(
      page.getByTestId("nav-securities").locator("svg.lucide-wallet-cards")
    ).toHaveCount(1);
    await expect(
      page.getByTestId("nav-banques").locator("svg.lucide-landmark")
    ).toHaveCount(1);

    // Même gabarit : l'échange ne doit pas changer la taille du glyphe.
    const a = await page
      .getByTestId("nav-securities")
      .locator("svg")
      .first()
      .boundingBox();
    const b = await page
      .getByTestId("nav-banques")
      .locator("svg")
      .first()
      .boundingBox();
    expect(a?.width).toBeCloseTo(b?.width ?? 0, 0);
    expect(a?.height).toBeCloseTo(b?.height ?? 0, 0);
  });

  test("activité récente : chaque nature d'opération a sa teinte", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("recent-activity-card")).toBeVisible({
      timeout: 25_000,
    });

    /** Jeton attendu pour chaque type présent à l'écran. */
    const attendu: Record<string, string> = {
      ACHAT: "val-positive",
      VENTE: "val-negative",
      DIVIDENDE: "val-warning",
      LOYER: "val-info",
      COUPON: "val-accent",
    };

    let verifies = 0;
    for (const [type, jeton] of Object.entries(attendu)) {
      const cellules = page.getByTestId(`activity-type-${type}`);
      const n = await cellules.count();
      for (let i = 0; i < n; i++) {
        await expect(cellules.nth(i)).toHaveClass(new RegExp(jeton));
        // Le libellé reste écrit : la couleur ne porte jamais seule le sens.
        await expect(cellules.nth(i)).not.toBeEmpty();
        verifies++;
      }
    }

    // Le journal de démonstration doit contenir au moins un type coloré,
    // sinon ce test passerait sans rien avoir observé.
    expect(verifies).toBeGreaterThan(0);
  });

  test("activité récente : achat vers le haut, vente vers le bas", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("recent-activity-card")).toBeVisible({
      timeout: 25_000,
    });

    /*
      La lecture est celle de la **position**, pas du cash : un achat fait
      entrer une ligne au portefeuille, une vente l'en fait sortir. Les deux
      icônes décrivaient auparavant le mouvement de trésorerie, donc l'inverse.
    */
    const carte = page.getByTestId("recent-activity-card");
    const achats = carte.locator("svg.lucide-arrow-up-right");
    const ventes = carte.locator("svg.lucide-arrow-down-left");

    const nbAchats = await page.getByTestId("activity-type-ACHAT").count();
    const nbVentes = await page.getByTestId("activity-type-VENTE").count();

    if (nbAchats > 0) expect(await achats.count()).toBeGreaterThan(0);
    if (nbVentes > 0) expect(await ventes.count()).toBeGreaterThan(0);
    expect(nbAchats + nbVentes).toBeGreaterThan(0);
  });

  test("assurance-vie : libellés courts et défilement vers la bonne section", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/assurance-vie", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("assurance-vie-tab")).toBeVisible({
      timeout: 25_000,
    });

    await page.getByRole("button", { name: /Ajouter/ }).first().click();
    const menu = page.getByTestId("av-add-menu");
    await expect(menu).toBeVisible();

    // Le verbe est porté par le bouton parent : « Ajouter › un contrat ».
    await expect(page.getByTestId("av-add-av-contract-form")).toHaveText(
      "un contrat"
    );
    await expect(page.getByTestId("av-add-av-support-form")).toHaveText(
      "un support"
    );
    await expect(page.getByTestId("av-add-av-redemption-simulator")).toHaveText(
      "un rachat"
    );

    // Le repli s'ouvre et la page défile jusqu'à l'encadré visé.
    await page.getByTestId("av-add-av-contract-form").click();
    await expect(page.getByTestId("av-contract-form")).toBeInViewport({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /Ajouter/ }).first().click();
    await page.getByTestId("av-add-av-redemption-simulator").click();
    await expect(page.getByTestId("av-redemption-simulator")).toBeInViewport({
      timeout: 10_000,
    });
  });

  test("passifs : le prêteur porte son logo, avec repli propre", async ({
    page,
  }) => {
    await gotoDashboard(page);
    await page.goto("/passifs", { waitUntil: "domcontentloaded" });
    const lignes = page.getByTestId("liability-row");
    await expect(lignes.first()).toBeVisible({ timeout: 25_000 });

    /*
      `PlatformLogo` — le composant déjà utilisé pour les assureurs et les
      courtiers — rend soit une image logo.dev, soit un monogramme. Les deux
      sont acceptables ; ce qui ne le serait pas, c'est une case vide.
    */
    const premiere = lignes.first();
    const visuel = premiere.locator("img, svg, abbr, span[aria-hidden]").first();
    await expect(visuel).toBeVisible();

    // Aucune image cassée : une source logo.dev absente doit replier sur le
    // monogramme, pas laisser une icône brisée.
    const images = premiere.locator("img");
    for (let i = 0; i < (await images.count()); i++) {
      const ok = await images
        .nth(i)
        .evaluate((el) => (el as HTMLImageElement).naturalWidth > 0);
      expect(ok).toBe(true);
    }
  });
});
