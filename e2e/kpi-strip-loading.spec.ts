import { test, expect, type Page } from "@playwright/test";

/**
 * Bandeau d'indicateurs — chargement, zéro réel, valeur réelle.
 *
 * Le défaut corrigé : `KpiStrip` n'avait aucune notion de chargement. `summary`
 * y étant optionnel et le formatage retombant sur `?? 0`, les dix tuiles
 * affichaient `0,00 €` tant que la requête était en vol — dont « Patrimoine
 * net », le chiffre que l'on vient lire en premier.
 *
 * Ces tests passent par une API réellement ralentie, comme l'audit qui a
 * constaté le défaut : c'est la seule façon d'observer un état transitoire de
 * façon fiable.
 *
 * Le bandeau ne s'affiche pas partout (`showGlobalKpis` exclut le tableau de
 * bord et les vues Positions) — d'où le passage par Passifs, l'une des neuf
 * pages concernées.
 */

const PAGE = "/passifs";
const NET_WORTH = "kpi-net-worth";

async function gotoWithDelayedApi(page: Page, ms: number) {
  await page.route("**/api/holdings**", async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
}

test.describe("Bandeau KPI — état de chargement", () => {
  test("aucune tuile n'affiche 0,00 € tant que la donnée n'est pas arrivée", async ({
    page,
  }) => {
    await gotoWithDelayedApi(page, 6000);

    const strip = page.getByTestId("kpi-strip-grid");
    await expect(strip).toBeVisible({ timeout: 30_000 });

    // Les tuiles restent montées — la grille ne doit pas bouger — mais leur
    // valeur cède la place à un placeholder.
    await expect(page.getByTestId(NET_WORTH)).toHaveAttribute(
      "data-loading",
      "true"
    );
    await expect(page.getByTestId(NET_WORTH)).toHaveAttribute(
      "aria-busy",
      "true"
    );

    // Le point central du correctif : pas un seul montant nul affiché comme
    // un fait pendant le chargement.
    const during = await strip.innerText();
    expect(during).not.toMatch(/0,00\s*€/);
  });

  test("une fois chargé, la valeur réelle s'affiche normalement", async ({
    page,
  }) => {
    await gotoWithDelayedApi(page, 1200);

    const net = page.getByTestId(NET_WORTH);
    await expect(net).toBeVisible({ timeout: 30_000 });
    // Non-régression : la tuile finit par porter un montant, sans placeholder.
    await expect(net).not.toHaveAttribute("data-loading", "true", {
      timeout: 30_000,
    });
    await expect(net).toContainText(/€/, { timeout: 30_000 });
    await expect(net).not.toContainText("— €");
  });

  test("un patrimoine réellement nul s'affiche bien 0,00 €", async ({
    page,
  }) => {
    /*
      La distinction qui compte : « pas encore chargé » et « chargé, et nul »
      ne doivent pas se ressembler. Ici la réponse arrive vraiment, avec des
      zéros — et le bandeau doit les afficher comme des montants.
    */
    await page.route("**/api/holdings**", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      const zeroed: Record<string, unknown> = {};
      for (const k of Object.keys(body.summary ?? {})) zeroed[k] = "0";
      await route.fulfill({
        response: res,
        json: { ...body, summary: zeroed },
      });
    });

    await page.goto(PAGE, { waitUntil: "domcontentloaded" });

    const net = page.getByTestId(NET_WORTH);
    await expect(net).toBeVisible({ timeout: 30_000 });
    await expect(net).not.toHaveAttribute("data-loading", "true", {
      timeout: 30_000,
    });
    await expect(net).toContainText("0,00 €", { timeout: 30_000 });
  });

  test("le bandeau ne prétend rien quand la donnée n'arrive jamais", async ({
    page,
  }) => {
    /*
      Une réponse en erreur n'est pas une absence de patrimoine. Le placeholder
      d'inconnu — celui que le bandeau emploie déjà pour ses tuiles sans
      contenu — vaut mieux qu'un zéro affirmé.
    */
    await page.route("**/api/holdings**", (route) =>
      route.fulfill({ status: 500, json: { error: "boom" } })
    );

    await page.goto(PAGE, { waitUntil: "domcontentloaded" });
    const strip = page.getByTestId("kpi-strip-grid");
    await expect(strip).toBeVisible({ timeout: 30_000 });

    // Laisser les tentatives de rechargement s'épuiser.
    await page.waitForTimeout(4000);
    const txt = await strip.innerText();
    expect(txt).not.toMatch(/0,00\s*€/);
  });
});
