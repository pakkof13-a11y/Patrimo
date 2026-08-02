import { test, expect } from "@playwright/test";
import { gotoDashboard, clickNav } from "./helpers";

/**
 * Watchlist : l'étoile de la fiche d'un actif alimente la carte du tableau
 * de bord.
 *
 * Le parcours est testé de bout en bout parce que c'est le seul endroit où la
 * boucle se referme — épingler dans le portefeuille, retrouver la ligne sur
 * un autre écran. Chaque moitié prise isolément passerait sans que la
 * fonctionnalité marche.
 */
test.describe("Watchlist", () => {
  test("épingler un actif le fait apparaître sur le tableau de bord", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    await gotoDashboard(page);
    await clickNav(page, "Positions");
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 20_000,
    });

    /*
      On part d'une watchlist vide pour que l'assertion porte sur *cet* actif,
      et on rend la base telle qu'on l'a trouvée à la fin : la démo épingle
      quelques lignes, et les autres tests de la série tournent après celui-ci.
    */
    const holdings = await (
      await request.get("/api/holdings?base=EUR")
    ).json();
    const preWatched = (
      holdings.holdings as Array<{ assetId: string; watchlisted?: boolean }>
    )
      .filter((h) => h.watchlisted)
      .map((h) => h.assetId);
    for (const assetId of preWatched) {
      await request.patch(`/api/assets/${assetId}/watchlist`, {
        data: { watchlisted: false },
      });
    }

    const row = page.locator("tr.holdings-row").first();
    const name = (await row.innerText()).split("\n")[0]!.trim();
    await row.click();

    const star = page.getByTestId("asset-panel-star");
    await expect(star).toBeVisible({ timeout: 20_000 });
    await expect(star).toHaveAttribute("data-on", "false");

    await star.click();
    await expect(star).toHaveAttribute("data-on", "true", { timeout: 20_000 });

    await clickNav(page, "Tableau de bord");
    const card = page.getByTestId("watchlist-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText(name, { timeout: 20_000 });

    // Et le retrait vide la carte, avec un état qui explique comment la remplir.
    await clickNav(page, "Positions");
    await page.locator("tr.holdings-row").first().click();
    const star2 = page.getByTestId("asset-panel-star");
    await expect(star2).toHaveAttribute("data-on", "true", { timeout: 20_000 });
    await star2.click();
    await expect(star2).toHaveAttribute("data-on", "false", { timeout: 20_000 });

    await clickNav(page, "Tableau de bord");
    await expect(page.getByTestId("watchlist-empty")).toBeVisible({
      timeout: 20_000,
    });

    for (const assetId of preWatched) {
      await request.patch(`/api/assets/${assetId}/watchlist`, {
        data: { watchlisted: true },
      });
    }
  });

  test("la carte du tableau de bord dépingle elle-même la ligne", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    /*
      Le retrait n'existait que dans la fiche de l'actif : il fallait rouvrir
      une ligne dont on ne voulait justement plus entendre parler. Le test
      porte sur ce raccourci, donc sur l'étoile de la carte elle-même.
    */
    const holdings = await (await request.get("/api/holdings?base=EUR")).json();
    const rows = holdings.holdings as Array<{
      assetId: string;
      watchlisted?: boolean;
    }>;
    const preWatched = rows.filter((h) => h.watchlisted).map((h) => h.assetId);
    for (const assetId of preWatched) {
      await request.patch(`/api/assets/${assetId}/watchlist`, {
        data: { watchlisted: false },
      });
    }
    const target = rows[0]!.assetId;
    await request.patch(`/api/assets/${target}/watchlist`, {
      data: { watchlisted: true },
    });

    // `gotoDashboard` rouvre l'onglet où la session s'était arrêtée : sur une
    // série, ce n'est pas forcément le tableau de bord. On l'y amène.
    await gotoDashboard(page);
    await clickNav(page, "Tableau de bord");
    const unpin = page.getByTestId(`watchlist-unpin-${target}`);
    await expect(unpin).toBeVisible({ timeout: 20_000 });
    await unpin.click();

    // La ligne disparaît, et la carte redevient l'état vide qui explique
    // comment la remplir — pas un tableau à zéro ligne.
    await expect(page.getByTestId(`watchlist-${target}`)).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(page.getByTestId("watchlist-empty")).toBeVisible({
      timeout: 20_000,
    });

    for (const assetId of preWatched) {
      await request.patch(`/api/assets/${assetId}/watchlist`, {
        data: { watchlisted: true },
      });
    }
  });

  test("API : un actif d'un autre compte ne peut pas être épinglé", async ({
    request,
  }) => {
    const res = await request.patch("/api/assets/inexistant-xyz/watchlist", {
      data: { watchlisted: true },
    });
    expect(res.status()).toBe(404);
  });
});
