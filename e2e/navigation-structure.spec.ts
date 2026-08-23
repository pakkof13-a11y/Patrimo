import { test, expect, type Page } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Barre latérale — architecture en quatre familles.
 *
 * Ce que ces tests protègent : chaque entrée mène à sa route, l'état actif
 * suit la route réelle (y compris après rafraîchissement et navigation
 * arrière), `/comptes` continue de fonctionner après le passage de l'URL
 * canonique à `/plateformes`, et le dépliant reste utilisable au clavier.
 */

const SECTIONS = {
  avoirs: [
    ["holdings", "/positions"],
    ["securities", "/pea-cto"],
    ["banques", "/banques"],
    ["assurance-vie", "/assurance-vie"],
    ["immobilier", "/immobilier"],
    ["crypto", "/cryptos"],
    ["epargne-salariale", "/epargne-salariale"],
    ["alternatifs", "/alternatifs"],
  ],
  engagements: [
    ["liabilities", "/passifs"],
    ["trading", "/trading"],
  ],
  suivi: [
    ["transactions", "/transactions"],
    ["platforms", "/plateformes"],
    ["fiscal", "/fiscalite"],
  ],
} as const;

async function openSection(page: Page, section: string) {
  await page.getByTestId(`nav-group-${section}`).click();
  await expect(page.getByTestId(`nav-group-${section}-menu`)).toBeVisible();
}

test.describe("Barre latérale", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
  });

  test("les quatre familles sont présentes et rien d'autre", async ({
    page,
  }) => {
    await expect(page.getByTestId("primary-nav")).toBeVisible();
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-group-avoirs")).toBeVisible();
    await expect(page.getByTestId("nav-group-engagements")).toBeVisible();
    await expect(page.getByTestId("nav-group-suivi")).toBeVisible();
    await expect(page.getByTestId("nav-preferences")).toBeVisible();

    // Groupes retirés : ils classaient par forme de détention, ce qui séparait
    // un PEA d'un bien immobilier alors que les deux s'additionnent pareil.
    await expect(page.getByTestId("nav-group-enveloppes")).toHaveCount(0);
    await expect(page.getByTestId("nav-group-actifs")).toHaveCount(0);
    await expect(page.getByTestId("nav-group-positions")).toHaveCount(0);
  });

  for (const [section, entries] of Object.entries(SECTIONS)) {
    for (const [testId, path] of entries) {
      test(`${section} → ${testId} ouvre ${path} et s'y allume`, async ({
        page,
      }) => {
        await openSection(page, section);
        await page.getByTestId(`nav-${testId}`).click();
        await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/")));

        // L'entrée est active, et sa famille aussi.
        await openSection(page, section);
        await expect(page.getByTestId(`nav-${testId}`)).toHaveAttribute(
          "aria-current",
          "page"
        );
        await expect(page.getByTestId(`nav-group-${section}`)).toHaveAttribute(
          "data-active",
          "true"
        );
      });
    }
  }

  test("l'état actif survit au rafraîchissement", async ({ page }) => {
    await page.goto("/passifs", { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-group-engagements")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.getByTestId("nav-group-avoirs")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  test("une seule famille est active à la fois", async ({ page }) => {
    /*
      `crypto` appartient à la famille Positions côté données mais possède sa
      propre entrée : sans l'exclure du repli, deux éléments s'allumeraient.
    */
    await page.goto("/cryptos", { waitUntil: "domcontentloaded" });
    const active = page.locator('[data-testid^="nav-group-"][data-active="true"]');
    await expect(active).toHaveCount(1);
  });

  test("une vue filtrée de Positions allume bien Avoirs", async ({ page }) => {
    /*
      `/positions/av` est un onglet à part entière qu'aucune entrée ne porte.
      Sans repli, il n'allumait rien du tout.
    */
    await page.goto("/positions/av", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-group-avoirs")).toHaveAttribute(
      "data-active",
      "true"
    );
    await openSection(page, "avoirs");
    await expect(page.getByTestId("nav-holdings")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("l'ancienne URL /comptes mène toujours aux Plateformes", async ({
    page,
  }) => {
    // L'URL canonique est passée à /plateformes ; aucun favori ne casse.
    for (const legacy of ["/comptes", "/mes-comptes", "/platforms"]) {
      await page.goto(legacy, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("platforms-tab")).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  test("le retour arrière garde l'état actif cohérent", async ({ page }) => {
    await page.goto("/transactions", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-group-suivi")).toHaveAttribute(
      "data-active",
      "true"
    );

    await page.goto("/passifs", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-group-engagements")).toHaveAttribute(
      "data-active",
      "true"
    );

    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("nav-group-suivi")).toHaveAttribute(
      "data-active",
      "true"
    );
    await expect(page.getByTestId("nav-group-engagements")).toHaveAttribute(
      "data-active",
      "false"
    );
  });

  test("le dépliant se ferme à Échap et se pilote au clavier", async ({
    page,
  }) => {
    await page.getByTestId("nav-group-avoirs").focus();
    await page.keyboard.press("Enter");
    const menu = page.getByTestId("nav-group-avoirs-menu");
    await expect(menu).toBeVisible();
    await expect(page.getByTestId("nav-group-avoirs")).toHaveAttribute(
      "aria-expanded",
      "true"
    );

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("la barre reste utilisable en largeur intermédiaire", async ({
    page,
  }) => {
    /*
      Sous 900 px la barre passe en rail horizontal qui va à la ligne. L'audit
      signalait cette largeur comme zone de vigilance : on vérifie que toutes
      les entrées restent atteignables et que le dépliant s'ouvre en dessous.
    */
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    for (const id of [
      "nav-dashboard",
      "nav-group-avoirs",
      "nav-group-engagements",
      "nav-group-suivi",
      "nav-preferences",
    ]) {
      await expect(page.getByTestId(id)).toBeInViewport();
    }

    await openSection(page, "suivi");
    await page.getByTestId("nav-platforms").click();
    await expect(page.getByTestId("platforms-tab")).toBeVisible({
      timeout: 30_000,
    });
  });
});
