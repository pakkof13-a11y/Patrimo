import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet « PEA & CTO ».
 *
 * Couvre ce que le tableau Positions ne portait pas : l'unicité légale du PEA,
 * le plafond de versement croisé PEA + PEA-PME, l'antériorité fiscale et la
 * simulation de retrait. Le CTO sert de témoin — il ne doit afficher ni
 * plafond, ni règle des 5 ans.
 */

/**
 * Chaque test repart d'un état vide : les comptes sont uniques par enveloppe
 * (un seul PEA par personne), donc un résidu d'un test précédent ferait échouer
 * la création du suivant. On supprime via l'API plutôt que par l'UI — c'est du
 * nettoyage de fixture, pas le comportement testé.
 */
async function resetAccounts(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/securities");
  if (!res.ok()) return;
  const body = await res.json();
  for (const account of body.accounts ?? []) {
    await request.delete(`/api/securities/accounts/${account.id}`);
  }
}

async function firstBrokerId(
  request: import("@playwright/test").APIRequestContext
): Promise<string> {
  const body = await (await request.get("/api/platforms")).json();
  const platforms = body.platforms ?? [];
  const broker = platforms.find(
    (p: { type?: string }) => p.type === "COURTIER"
  );
  return (broker ?? platforms[0]).id;
}

test.describe("PEA & CTO", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetAccounts(page.request);
    await page.goto("/pea-cto", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });
  });

  test.afterEach(async ({ page }) => {
    await resetAccounts(page.request);
  });

  test("ouvre un PEA et refuse le second — la loi n'en autorise qu'un", async ({
    page,
  }) => {
    await page.getByTestId("securities-form-toggle").click();
    await expect(page.getByTestId("securities-form")).toBeVisible();

    await page.getByTestId("securities-envelope-type").selectOption("PEA");
    await page.getByTestId("securities-platform").selectOption({ index: 1 });
    await page.getByTestId("securities-open-date").fill("2019-03-01");
    await page.getByTestId("securities-submit").click();
    await expect(page.getByText("Compte enregistré")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(1);

    // Second PEA : refusé avec un message métier, pas une erreur technique.
    await page.getByTestId("securities-form-toggle").click();
    await page.getByTestId("securities-envelope-type").selectOption("PEA");
    await page.getByTestId("securities-platform").selectOption({ index: 1 });
    await page.getByTestId("securities-open-date").fill("2021-05-01");
    await page.getByTestId("securities-submit").click();

    await expect(page.getByText(/vous détenez déjà un PEA/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(1);
  });

  test("plusieurs CTO sont acceptés, et n'affichent ni plafond ni règle des 5 ans", async ({
    page,
  }) => {
    for (const openDate of ["2020-01-01", "2022-06-15"]) {
      await page.getByTestId("securities-form-toggle").click();
      await page.getByTestId("securities-envelope-type").selectOption("CTO");
      await page.getByTestId("securities-platform").selectOption({ index: 1 });
      await page.getByTestId("securities-open-date").fill(openDate);
      await page.getByTestId("securities-submit").click();
      await expect(page.getByText("Compte enregistré")).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(page.getByTestId("securities-account-card")).toHaveCount(2);
    // Un compte-titres n'a ni plafond de versement ni antériorité fiscale.
    await expect(page.getByTestId("securities-room-gauge")).toHaveCount(0);
    await expect(page.getByTestId("securities-maturity")).toHaveCount(0);
  });

  test("le plafond du PEA-PME tient compte des versements du PEA", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);

    // Le plafond croisé se vérifie sur des montants précis : on met en place
    // l'état par l'API, l'objet du test étant ce que l'écran en déduit.
    const pea = await (
      await page.request.post("/api/securities/accounts", {
        data: {
          envelopeType: "PEA",
          platformId: brokerId,
          openDate: "2019-03-01",
        },
      })
    ).json();
    await page.request.post(
      `/api/securities/accounts/${pea.id}/contributions`,
      { data: { type: "DEPOSIT", amountEur: "150000", occurredAt: "2019-04-01" } }
    );
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA_PME",
        platformId: brokerId,
        openDate: "2024-02-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(2);

    // Le PEA est plein : plus aucune place, et la borne est son plafond propre.
    const captions = page.getByTestId("securities-room-caption");
    await expect(captions.first()).toContainText(/0,00\s*€ de versement/);

    // Le PEA-PME est vide : isolément il afficherait 225 000 €. Il rend
    // 75 000 € parce que le PEA plein consomme le plafond commun — et l'écran
    // doit l'expliquer, sans quoi le chiffre paraît faux.
    const pmeCaption = captions.nth(1);
    await expect(pmeCaption).toContainText("75 000,00");
    await expect(pmeCaption).toContainText(/plafond commun PEA \+ PEA-PME/i);
  });

  test("l'antériorité ne dit jamais « exonéré » sans les prélèvements sociaux", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA",
        platformId: brokerId,
        openDate: "2019-03-01",
      },
    });
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA_PME",
        platformId: brokerId,
        openDate: "2024-02-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    const maturity = page.getByTestId("securities-maturity");
    await expect(maturity).toHaveCount(2);

    // Plan mûr : l'impôt sur le revenu tombe, les prélèvements sociaux restent.
    await expect(maturity.first()).toContainText("IR exonéré");
    await expect(maturity.first()).toContainText("18,6");
    // Plan récent : les deux composantes sont annoncées.
    await expect(maturity.nth(1)).toContainText("12,8");
    await expect(maturity.nth(1)).toContainText("18,6");
  });

  test("le simulateur refuse un retrait supérieur à la valeur du plan", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA",
        platformId: brokerId,
        openDate: "2019-03-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("securities-account-toggle").first().click();
    await page
      .getByTestId("securities-withdrawal-amount")
      .first()
      .fill("999999999");

    // Ne rien calculer vaut mieux qu'afficher un montant faux.
    await expect(
      page.getByText(/supérieur à la valeur du plan/i)
    ).toBeVisible();
    await expect(page.getByTestId("securities-withdrawal-result")).toHaveCount(
      0
    );
  });

  test("rattacher les lignes fait entrer leur valeur dans le compte", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    const pea = await (
      await page.request.post("/api/securities/accounts", {
        data: {
          envelopeType: "PEA",
          platformId: brokerId,
          openDate: "2019-03-01",
        },
      })
    ).json();

    await page.reload({ waitUntil: "domcontentloaded" });

    // Le bandeau existe parce que l'omission est coûteuse : une ligne non
    // rattachée ne compte pas dans la valeur liquidative, donc la simulation
    // de retrait porterait sur un montant sous-évalué sans le dire.
    const banner = page.getByTestId("securities-unattached-banner");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/non rattachée/i);

    const before = await (await page.request.get("/api/securities")).json();
    const valueBefore = Number(
      before.accounts.find((a: { id: string }) => a.id === pea.id)
        .liquidationValueEur
    );

    // Un seul PEA existe : la destination des lignes PEA ne fait aucun doute,
    // le rattachement groupé est donc proposé.
    await page
      .getByTestId("securities-attach-all")
      .filter({ hasText: "PEA" })
      .click();
    await expect(page.getByText(/ligne\(s\) rattachée\(s\)/i)).toBeVisible({
      timeout: 15_000,
    });

    const after = await (await page.request.get("/api/securities")).json();
    const accountAfter = after.accounts.find(
      (a: { id: string }) => a.id === pea.id
    );
    expect(Number(accountAfter.liquidationValueEur)).toBeGreaterThan(
      valueBefore
    );
    expect(accountAfter.positionCount).toBeGreaterThan(0);
  });

  test("le sélecteur ne propose que des comptes de la même famille fiscale", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA",
        platformId: brokerId,
        openDate: "2019-03-01",
      },
    });
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "CTO",
        platformId: brokerId,
        openDate: "2020-01-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    const rows = page.getByTestId("securities-row");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });

    // Chaque ligne ne doit voir que les comptes qui pourraient réellement la
    // recevoir : déplacer un titre d'un CTO vers un PEA est un transfert, que
    // le service refuse — l'option ne doit donc pas être offerte.
    const count = await rows.count();
    for (let i = 0; i < Math.min(count, 6); i += 1) {
      const row = rows.nth(i);
      const envelope = (await row.locator("td").nth(1).innerText()).trim();
      const options = await row
        .getByTestId("securities-row-account")
        .locator("option")
        .allTextContents();
      const proposed = options.filter((o) => !/non rattachée/i.test(o));
      for (const option of proposed) {
        if (envelope === "PEA") {
          expect(option).toMatch(/PEA/);
        } else {
          expect(option).toContain("Compte-titres");
        }
      }
    }
  });

  test("les anciennes URL d'enveloppe mènent à l'onglet dédié", async ({
    page,
  }) => {
    await page.goto("/positions/pea", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/positions/cto", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });
  });
});
