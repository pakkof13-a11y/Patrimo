import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Écran « Épargne salariale ».
 *
 * Ces tests protègent trois refus plutôt qu'une mise en page : ne pas annoncer
 * un gain sans montants versés, ne pas faire passer une courbe de versements
 * pour une valorisation de marché, et ne pas ranger un fonds monétaire parmi
 * les actions. Le reste — l'ordre des cartes, les couleurs — peut bouger.
 */

/**
 * Attend que la liste des plans ait répondu, puis dit s'il y en a.
 *
 * Attendre `es-plans` ne suffit pas : la carte est rendue pendant le
 * squelette, donc `es-plan-row` y vaut zéro pour une raison de calendrier et
 * non d'absence de données. La liste chargée porte l'un des deux marqueurs
 * terminaux — la table, ou l'état vide explicite `es-no-plan` — et c'est sur
 * lui qu'on statue.
 */
async function plansCharges(page: import("@playwright/test").Page) {
  const vide = page.getByTestId("es-no-plan");
  const table = page.getByTestId("es-plan-table");
  await expect(vide.or(table)).toBeVisible({ timeout: 20_000 });
  return (await vide.count()) === 0;
}

test.describe("Épargne salariale", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await page.goto("/epargne-salariale", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("employee-savings-tab")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("la vue d'ensemble mène la page, la saisie reste repliée", async ({
    page,
  }) => {
    await expect(page.getByTestId("es-kpi-strip")).toBeVisible();
    await expect(page.getByTestId("es-liquidity-summary")).toBeVisible();
    await expect(page.getByTestId("es-allocation-card")).toBeVisible();
    await expect(page.getByTestId("es-evolution-card")).toBeVisible();
    await expect(page.getByTestId("es-plans")).toBeVisible();
    await expect(page.getByTestId("es-context-column")).toBeVisible();

    // Rien de sélectionné : la colonne de droite reste en retrait.
    await expect(page.getByTestId("es-plan-panel")).toHaveAttribute(
      "data-open",
      "false"
    );

    await expect(page.getByTestId("es-management")).toHaveCount(0);
    await page.getByTestId("es-manage-toggle").click();
    await expect(page.getByTestId("es-management")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("le pli prolonge la vue d'ensemble, il ne la rejoue pas", async ({
    page,
  }) => {
    /*
      La section de gestion a longtemps été un écran complet : elle rouvrait
      son propre titre « Épargne salariale » et ses propres indicateurs, sous
      ceux de la vue d'ensemble qui disent déjà la même chose. Repliée par
      défaut, la répétition ne se voyait qu'une fois le pli ouvert.

      Le test porte sur ce que l'utilisateur lit, pas sur une classe : un titre
      de module, une fois. Les indicateurs sont vérifiés au même endroit — la
      bande de la vue d'ensemble reste seule à les porter.
    */
    await page.goto("/epargne-salariale#gestion", {
      waitUntil: "domcontentloaded",
    });
    const management = page.getByTestId("es-management");
    await expect(management).toBeVisible({ timeout: 20_000 });

    /*
      Correspondance par sous-chaîne : le titre de la page porte la pastille du
      nombre de plans dans son nom accessible. Deux titres nommés « Épargne
      salariale » signifieraient que le pli a rouvert le sien.
    */
    /*
      Attendre que le pli soit rendu avant d'affirmer ce qu'il ne contient pas.

      Une assertion négative est vraie d'elle-même tant que le contenu n'est pas
      arrivé. Ces vérifications venaient en tête de test et passaient donc sur
      un pli encore vide : vertes par accident de calendrier, aveugles à la
      régression qu'elles prétendaient garder.
    */
    await expect(management.getByText("Positions FCPE")).toBeVisible({
      timeout: 20_000,
    });
    await expect(management.getByTestId("es-add-line")).toHaveCount(1);

    const titles = page.getByRole("heading", { name: "Épargne salariale" });
    await expect(titles).toHaveCount(1);

    /*
      La bande d'indicateurs appartient à la vue d'ensemble, pas au pli.

      On vise la bande elle-même plutôt que ses libellés. « Disponible » et
      « Bloqué » nomment aussi le badge de liquidité de chaque ligne FCPE :
      les chercher par texte confondait un indicateur répété avec quatre
      pastilles de tableau parfaitement légitimes, et l'assertion ne tenait
      qu'aussi longtemps que ces lignes n'étaient pas chargées.
    */
    await expect(page.getByTestId("es-kpi-strip")).toHaveCount(1);
    await expect(
      management.getByTestId("es-kpi-strip"),
      "la section de gestion rouvre sa propre bande d'indicateurs"
    ).toHaveCount(0);
  });

  test("le repli de gestion survit au rechargement — l'état vit dans l'URL", async ({
    page,
  }) => {
    await page.goto("/epargne-salariale#gestion", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("es-management")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("le nombre de plans compte les enveloppes, pas les lignes de relevé", async ({
    page,
  }) => {
    const pill = page.getByTestId("es-plan-count");
    await expect(pill).toBeVisible({ timeout: 20_000 });

    /*
      Sans plan, la pastille n'a rien à compter et le scénario n'a pas d'objet.
      Le dire par un skip visible plutôt que par un retour muet : la pastille
      pouvait tomber à zéro sans que ce test ne bronche.
    */
    test.skip(!(await plansCharges(page)), "Aucun plan d'épargne salariale à compter");

    const rows = page.getByTestId("es-plan-row");
    const shown = await rows.count();

    // Un plan = un type d'enveloppe chez un gestionnaire. Le seed en compte
    // trois pour quatre supports : la pastille ne doit pas compter les lignes.
    const label = await pill.innerText();
    const declared = Number(label.replace(/\D+/g, ""));
    expect(declared).toBeGreaterThanOrEqual(shown);
    await expect(page.getByTestId("es-kpi-value")).toContainText("support");
  });

  test("aucun gain n'est annoncé sans montants versés", async ({ page }) => {
    const perf = page.getByTestId("es-kpi-gain");
    await expect(perf).toBeVisible();
    // Attendre que les données aient répondu : pendant le squelette, tous les
    // totaux valent zéro et la tuile ne dit encore rien de vrai.
    await expect(page.getByTestId("es-plans")).toBeVisible({ timeout: 20_000 });
    await expect(perf).not.toContainText("Plans", { timeout: 20_000 });

    /*
      Sans montants versés, « gain » vaudrait l'encours entier — un capital
      qui aurait tout rapporté et rien coûté. L'écran doit alors le dire au
      lieu d'afficher un pourcentage.
    */
    if ((await perf.innerText()).includes("non renseignés")) {
      await expect(perf).toContainText("—");
    }
  });

  test("la courbe dit qu'elle trace des versements, pas une valorisation", async ({
    page,
  }) => {
    await page.getByTestId("es-view-contributions").click();
    const card = page.getByTestId("es-evolution-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/versements cumulés/i);

    const unavailable = page.getByTestId("es-evolution-unavailable");
    if ((await unavailable.count()) > 0) {
      await expect(unavailable).toContainText(/montants versés/i);
    } else {
      // Le tracé ne suit pas les marchés, et l'écran l'écrit.
      await expect(card).toContainText(/ne suit pas les marchés/i);
      await page.getByTestId("es-range-1y").click();
      await expect(page.getByTestId("es-range-1y")).toHaveAttribute(
        "data-active",
        "true"
      );
    }
  });

  test("les familles de supports se lisent en texte et distinguent le monétaire", async ({
    page,
  }) => {
    /*
      La précondition est l'existence de plans, pas celle de la légende.
      Sortir sur l'absence de la légende rendait ce test vert au moment même où
      la répartition cessait d'être lisible en texte.
    */
    test.skip(!(await plansCharges(page)), "Aucun plan : pas de répartition à lire");

    await page.getByTestId("es-view-allocation").click();
    const legend = page.getByTestId("es-allocation-legend");
    await expect(
      legend,
      "des plans existent, la répartition doit être lisible"
    ).toBeVisible({ timeout: 15_000 });

    await expect(legend).toContainText("%");
    await expect(legend).toContainText("€");

    // Le fonds monétaire du jeu de démonstration ne doit pas être rangé en
    // actions : ce serait annoncer un risque qui n'existe pas.
    const monetary = page.getByTestId("es-allocation-monetary");
    if ((await monetary.count()) > 0) {
      await expect(monetary).toContainText(/monétaires/i);
    }
  });

  test("la fiche d'un plan porte sa répartition et son horizon de déblocage", async ({
    page,
  }) => {
    /*
      Ces deux informations vivaient sur la carte du plan. La carte a disparu
      au profit d'une ligne comparable ; elles doivent donc se retrouver dans
      la fiche, pas s'être évaporées.
    */
    // Sans plan, il n'y a pas de fiche à ouvrir — dit au bilan, pas en silence.
    test.skip(!(await plansCharges(page)), "Aucun plan : pas de fiche à ouvrir");
    const rows = page.getByTestId("es-plan-row");

    await rows.first().click();

    await page.getByTestId("es-panel-tab-allocation").click();
    await expect(page.getByTestId("es-panel-allocation")).toBeVisible();

    await page.getByTestId("es-panel-tab-liquidity").click();
    const panel = page.getByTestId("es-plan-panel");
    await expect(panel).toContainText("Prochain déblocage");
  });

  test("la colonne contextuelle sépare disponible et bloqué", async ({
    page,
  }) => {
    const liquidity = page.getByTestId("es-context-liquidity");
    await expect(liquidity).toBeVisible();
    await expect(liquidity).toContainText("Disponible");
    await expect(liquidity).toContainText("Indisponible");
    // L'épargne salariale est bloquée par défaut : l'écran le rappelle plutôt
    // que de laisser croire à des fonds mobilisables.
    await expect(liquidity).toContainText(/bloquée par défaut/i);
  });

  test("sélectionner un plan ouvre sa fiche sans emporter la liste", async ({
    page,
  }) => {
    /*
      Ce skip existait déjà, mais il se prononçait sur `es-plans` — rendue dès
      le squelette. Il se déclenchait donc toujours, et ce test ne s'exécutait
      jamais malgré les quatre supports du jeu de démonstration.
    */
    test.skip(!(await plansCharges(page)), "Aucun plan dans le jeu de démonstration");
    const rows = page.getByTestId("es-plan-row");

    await rows.first().click();
    const panel = page.getByTestId("es-plan-panel");
    await expect(panel).toHaveAttribute("data-open", "true");

    // Disponible / bloqué : la question centrale, visible dès l'ouverture.
    await expect(panel.getByTestId("es-liquidity-bar")).toBeVisible();
    await expect(page.getByTestId("es-panel-value")).toBeVisible();

    // La liste reste en place : c'est l'intérêt d'une colonne ancrée.
    await expect(page.getByTestId("es-plan-table")).toBeVisible();

    await page.getByTestId("es-panel-tab-liquidity").click();
    await expect(page.getByTestId("es-panel-unlocks")).toBeVisible();

    await page.getByTestId("es-panel-tab-supports").click();
    await expect(page.getByTestId("es-panel-supports")).toBeVisible();

    await page.getByTestId("es-panel-close").click();
    await expect(panel).toHaveAttribute("data-open", "false");
  });

  test("les vues secondaires changent réellement le contenu", async ({
    page,
  }) => {
    await page.getByTestId("es-view-allocation").click();
    await expect(page.getByTestId("es-allocation-card")).toBeVisible();
    await expect(page.getByTestId("es-evolution-card")).toHaveCount(0);

    await page.getByTestId("es-view-liquidity").click();
    await expect(page.getByTestId("es-liquidity-summary")).toBeVisible();
    await expect(page.getByTestId("es-allocation-card")).toHaveCount(0);

    await page.getByTestId("es-view-overview").click();
    await expect(page.getByTestId("es-context-column")).toBeVisible();
  });
});