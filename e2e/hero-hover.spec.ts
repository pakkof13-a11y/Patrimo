import { test, expect, type Page, type Locator } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * La carte de tête lue comme une série.
 *
 * Ce que ces tests protègent n'est pas l'apparition d'une info-bulle — un
 * `toBeVisible` l'aurait dit — mais le fait que le **gros chiffre suive le
 * curseur puis revienne**. C'est là que se joue la promesse : un hero figé
 * pendant que l'info-bulle bouge, ou un hero resté sur une valeur passée après
 * la sortie, afficherait un patrimoine faux sans que rien ne le signale.
 */

/**
 * Lit un montant français rendu à l'écran.
 *
 * Les séparateurs de milliers sont des espaces insécables — parfois fines —
 * que le format monétaire pose lui-même : un `parseFloat` direct s'arrêterait
 * au premier d'entre eux et lirait 880 là où il y a 880 769,64.
 */
function nombre(texte: string): number {
  const brut = texte
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(brut);
  expect(Number.isFinite(n)).toBe(true);
  return n;
}

/** Ouvre le tableau de bord et rend la courbe survolable. */
async function heroChart(page: Page): Promise<Locator> {
  await gotoDashboard(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("terminal-hero")).toBeVisible({
    timeout: 20_000,
  });
  const chart = page.getByTestId("hero-chart");
  await expect(chart).toBeVisible({ timeout: 20_000 });
  return chart;
}

/**
 * Survole la courbe à une fraction de sa largeur.
 *
 * Le pointeur est posé en coordonnées absolues plutôt qu'avec `hover()` : c'est
 * l'abscisse qui désigne le point, et un centrage automatique tomberait
 * toujours sur le même.
 */
async function survolerA(page: Page, chart: Locator, fraction: number) {
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * fraction,
    box!.y + box!.height / 2
  );
}

test.describe("Carte de tête — survol de la courbe", () => {
  test("le montant suit le point survolé, puis revient à aujourd'hui", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");

    const aujourdhui = (await montant.innerText()).trim();
    expect(aujourdhui).not.toBe("");

    // Un point ancien : le premier tiers de la courbe.
    await survolerA(page, chart, 0.2);
    await expect(chart).toHaveAttribute("data-active-index", /\d+/);
    await expect(montant).toHaveAttribute("data-hovering", "true");
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    await expect(page.getByTestId("hero-chart-crosshair")).toBeVisible();
    await expect(page.getByTestId("hero-chart-dot")).toBeVisible();

    /*
      Le montant du hero doit valoir celui de l'info-bulle, aux décimales
      près : c'est la même valeur, écrite deux fois à deux tailles. Les
      comparer chiffre à chiffre attraperait un décalage d'un point entre la
      croix et le chiffre — le défaut que ce chantier doit rendre impossible.
    */
    const tooltipMontant = (
      await page.getByTestId("hero-tooltip-amount").innerText()
    ).trim();
    const heroSurvol = (await montant.innerText()).trim();
    const chiffres = (s: string) => s.replace(/[^\d]/g, "");
    expect(chiffres(tooltipMontant).startsWith(chiffres(heroSurvol))).toBe(true);

    // Sortie : retour à la valorisation courante, à l'identique.
    await page.mouse.move(0, 0);
    await expect(page.getByTestId("hero-chart-tooltip")).toHaveCount(0);
    await expect(montant).not.toHaveAttribute("data-hovering", "true");
    await expect(montant).toHaveText(aujourdhui);
  });

  test("les flèches parcourent la série, Échap ramène à aujourd'hui", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");
    const aujourdhui = (await montant.innerText()).trim();

    await chart.focus();
    // Première flèche : on entre par le dernier point, pas par le premier.
    await page.keyboard.press("ArrowLeft");
    const premierRang = await chart.getAttribute("data-active-index");
    expect(premierRang).not.toBeNull();

    await page.keyboard.press("ArrowLeft");
    const deuxiemeRang = await chart.getAttribute("data-active-index");
    expect(Number(deuxiemeRang)).toBe(Number(premierRang) - 1);

    // Une flèche droite revient d'un cran.
    await page.keyboard.press("ArrowRight");
    await expect(chart).toHaveAttribute("data-active-index", premierRang!);

    await page.keyboard.press("Escape");
    await expect(chart).not.toHaveAttribute("data-active-index", /\d+/);
    await expect(montant).toHaveText(aujourdhui);
  });

  test("net et brut décrivent la même date, et l'écart est exactement les passifs", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");

    /*
      Neuf dixièmes de la série, et non la moitié.

      Les passifs du jeu de démo n'entrent dans l'historique que dans sa
      dernière partie : avant, `Passifs 0,00 €`, et net vaut légitimement brut.
      Comparer au milieu ne prouverait donc rien. Mesuré sur ce décor, le rang
      atteint ici porte près de 200 000 € de dettes — l'écart y est réel, et
      c'est ce qui rend l'assertion capable d'échouer.
    */
    await page.getByTestId("hero-mode-net").click();
    await survolerA(page, chart, 0.9);
    const rangNet = await chart.getAttribute("data-active-index");
    const valeurNet = nombre(await montant.innerText());
    const split = (await page.getByTestId("hero-tooltip-split").innerText()).trim();
    const [actifs, passifs] = split
      .split("·")
      .map((part) => nombre(part));

    expect(passifs).toBeGreaterThan(0);

    await page.mouse.move(0, 0);
    await page.getByTestId("hero-mode-gross").click();
    await survolerA(page, chart, 0.9);
    const rangBrut = await chart.getAttribute("data-active-index");
    const valeurBrut = nombre(await montant.innerText());

    /*
      Le même pixel doit désigner le même jour dans les deux modes.

      Ce n'était pas le cas avant que la colonne du graphique reçoive une
      largeur fixe : le chiffre de tête changeant de largeur avec la valeur, il
      poussait la courbe pendant le survol, et le rang glissait de plusieurs
      dizaines entre net et brut.
    */
    expect(rangBrut).toBe(rangNet);

    // Le brut affiché est bien la ligne « Actifs » de l'info-bulle nette.
    expect(Math.abs(valeurBrut - actifs)).toBeLessThan(1);
    // Et le net en est la différence, aux arrondis d'affichage près.
    expect(Math.abs(valeurNet - (actifs - passifs))).toBeLessThan(1);
    expect(valeurBrut).not.toBe(valeurNet);

    /*
      La décomposition n'a de sens qu'en net — « net de quoi ? ». En brut, la
      question ne se pose pas, et la ligne ne doit pas suivre le bouton.
    */
    await expect(page.getByTestId("hero-tooltip-split")).toHaveCount(0);
  });

  test("montants masqués : le hero et l'info-bulle le sont aussi", async ({
    page,
  }) => {
    const chart = await heroChart(page);

    await page.getByTestId("privacy-toggle").click();
    await expect(page.getByTestId("hero-net-worth")).toHaveText("****", {
      timeout: 10_000,
    });

    await survolerA(page, chart, 0.4);
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    /*
      Masquer le hero sans masquer l'info-bulle rendrait le geste inutile :
      c'est le même montant, offert au même regard par-dessus l'épaule.
    */
    await expect(page.getByTestId("hero-tooltip-amount")).toHaveText("****");

    await page.mouse.move(0, 0);
    await page.getByTestId("privacy-toggle").click();
    await expect(page.getByTestId("hero-net-worth")).not.toHaveText("****");
  });
});
