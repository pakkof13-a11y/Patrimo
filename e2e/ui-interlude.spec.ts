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
    /*
      La carte affiche son ossature avant que les opérations n'arrivent :
      compter tout de suite reviendrait à mesurer un tableau vide et à conclure
      qu'aucune teinte n'est posée. On attend donc une première ligne.
    */
    await expect(
      page.locator("[data-testid^='activity-type-']").first()
    ).toBeVisible({ timeout: 20_000 });

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
      La carte affiche son ossature avant que les opérations n'arrivent :
      compter tout de suite reviendrait à mesurer un tableau vide et à conclure
      qu'aucune teinte n'est posée. On attend donc une première ligne.
    */
    await expect(
      page.locator("[data-testid^='activity-type-']").first()
    ).toBeVisible({ timeout: 20_000 });

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

    /*
      `openManage` (components/life-insurance/assurance-vie-page.tsx) déclenche
      un `scrollIntoView({ behavior: "smooth" })` après avoir attendu, en
      requestAnimationFrame, que l'ancre existe dans le DOM. `toBeInViewport`
      seul course donc avec un scroll fluide en cours : au premier passage de
      la vérification, le panneau peut être monté (viewport ratio 0) sans que
      le scroll ne l'ait encore amené à l'écran — signature observée en CI
      (1ʳᵉ tentative en échec, 2ᵉ verte sans rien y changer).

      Chromium (le navigateur de la suite) émet un événement `scrollend`
      natif à la fin d'un scroll, fluide ou non — signal DOM fiable plutôt
      qu'un délai arbitraire. On l'arme juste avant l'action qui déclenche le
      scroll, puis on attend soit cet événement, soit un délai court en repli
      si jamais rien ne scrolle (ex. cible déjà dans le viewport, l'événement
      ne se déclenche alors pas) — dans les deux cas, `toBeInViewport` reste
      l'assertion qui tranche, inchangée.
    */
    async function armerScrollend(page: import("@playwright/test").Page) {
      await page.evaluate(() => {
        (window as unknown as { __scrollEnded?: boolean }).__scrollEnded =
          false;
        const onEnd = () => {
          (window as unknown as { __scrollEnded?: boolean }).__scrollEnded =
            true;
        };
        window.addEventListener("scrollend", onEnd, { once: true });
      });
    }
    async function attendreScrollend(page: import("@playwright/test").Page) {
      await page
        .waitForFunction(
          () =>
            (window as unknown as { __scrollEnded?: boolean })
              .__scrollEnded === true,
          { timeout: 5_000 }
        )
        .catch(() => {
          // Rien à défiler (cible déjà en vue) ou navigateur sans
          // `scrollend` : `toBeInViewport` ci-dessous tranche quand même.
        });
    }

    // Le repli s'ouvre et la page défile jusqu'à l'encadré visé.
    await armerScrollend(page);
    await page.getByTestId("av-add-av-contract-form").click();
    await attendreScrollend(page);
    await expect(page.getByTestId("av-contract-form")).toBeInViewport({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /Ajouter/ }).first().click();
    await armerScrollend(page);
    await page.getByTestId("av-add-av-redemption-simulator").click();
    await attendreScrollend(page);
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

    /*
      Aucune image **stabilisée** cassée.

      `PlatformLogo` essaie plusieurs sources avant de replier sur le
      monogramme : une image en cours de cascade a transitoirement une largeur
      nulle sans que rien ne soit en défaut. On attend donc que le repli ait
      eu lieu, puis on vérifie qu'il ne reste aucune image chargée à vide —
      c'est le symptôme d'une icône brisée, et lui seul.

      Ici, logo.dev est injoignable (politique d'egress) : les lignes affichent
      donc des monogrammes, exactement comme les contrats d'assurance-vie qui
      utilisent le même composant.
    */
    await expect(async () => {
      const casses = await page.evaluate(() =>
        [...document.querySelectorAll("img")].filter(
          (i) => i.complete && i.naturalWidth === 0
        ).length
      );
      expect(casses).toBe(0);
    }).toPass({ timeout: 15_000 });
  });
});
