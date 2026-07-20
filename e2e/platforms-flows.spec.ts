import { test, expect } from "@playwright/test";
import {
  ensurePlatform,
  gotoDashboard,
  clickNav,
} from "./helpers";

/**
 * Flux critiques Mes plateformes :
 * aperçu, nouvelle transaction préremplie, renvoi Positions avec filtre.
 */
test.describe("Mes plateformes — flux critiques", () => {
  test("API : create + edit type + walletAddress persistés", async ({
    request,
  }) => {
    const name = `E2E Plat Flow ${Date.now()}`;
    const create = await request.post("/api/platforms", {
      data: {
        name,
        type: "COURTIER",
        logoKey: "E2E_FLOW",
        upsert: true,
      },
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const created = await create.json();
    const id = created.platform?.id as string;
    expect(id).toBeTruthy();
    expect(created.platform?.type).toBe("COURTIER");

    const edit = await request.put("/api/platforms", {
      data: {
        id,
        type: "EXCHANGE_CRYPTO",
        notes: "e2e notes",
        walletAddress: null,
      },
    });
    expect(edit.ok(), await edit.text()).toBeTruthy();
    const edited = await edit.json();
    expect(edited.platform?.type).toBe("EXCHANGE_CRYPTO");
    expect(edited.platform?.notes).toBe("e2e notes");

    // Blockchain + adresse
    const chain = await request.post("/api/platforms", {
      data: {
        name: `E2E Chain ${Date.now()}`,
        type: "BLOCKCHAIN",
        logoKey: "ETHEREUM",
        walletAddress: "0x1111111111111111111111111111111111111111",
        upsert: true,
      },
    });
    expect(chain.ok(), await chain.text()).toBeTruthy();
    const chainJson = await chain.json();
    expect(
      (chainJson.platform?.walletAddress || "").toLowerCase()
    ).toBe("0x1111111111111111111111111111111111111111");

    const rePersist = await request.put("/api/platforms", {
      data: {
        id: chainJson.platform.id,
        walletAddress: "0x2222222222222222222222222222222222222222",
      },
    });
    expect(rePersist.ok(), await rePersist.text()).toBeTruthy();
    const reJson = await rePersist.json();
    expect(
      (reJson.platform?.walletAddress || "").toLowerCase()
    ).toBe("0x2222222222222222222222222222222222222222");
  });

  test("aperçu + nouvelle transaction préremplie + filtre Positions", async ({
    page,
    request,
  }) => {
    const name = `E2E Preview ${Date.now()}`;
    const id = await ensurePlatform(request, {
      name,
      type: "COURTIER",
      logoKey: "E2E_PREVIEW",
    });
    expect(id).toBeTruthy();

    // Position minimale pour que le filtre Positions ait du sens
    const assetRes = await request.post("/api/assets", {
      data: {
        name: "E2E Preview Equity",
        ticker: "E2EPV.PA",
        assetClass: "ACTIONS",
        platformId: id,
        currency: "EUR",
        accountType: "CTO",
        priceProvider: "MANUAL",
      },
    });
    expect(assetRes.ok(), await assetRes.text()).toBeTruthy();
    const assetId = (await assetRes.json()).asset?.id as string;
    const buy = await request.post("/api/transactions", {
      data: {
        type: "ACHAT",
        platformId: id,
        assetId,
        quantity: "1",
        unitPrice: "10",
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: new Date().toISOString().slice(0, 16),
        notes: "e2e preview buy",
        allowNegativeCash: true,
      },
    });
    expect(buy.ok(), await buy.text()).toBeTruthy();

    await gotoDashboard(page);
    await clickNav(page, "Mes plateformes");
    await expect(page.getByTestId("platforms-tab")).toBeVisible({
      timeout: 15_000,
    });

    const card = page.getByTestId(`platform-${name}`);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Menu ⋯ → aperçu
    await page.getByTestId(`platform-menu-${id}`).click();
    await page.getByTestId(`preview-platform-${id}`).click();
    await expect(page.getByTestId("platform-preview-modal")).toBeVisible();
    await expect(page.getByTestId("platform-preview")).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();

    // Nouvelle transaction depuis aperçu (préremplie)
    await page.getByTestId("platform-preview-new-tx").click();
    await expect(page.getByTestId("modal-overlay")).toBeVisible({
      timeout: 10_000,
    });
    // Combobox plateforme : valeur dans l’input (pas un nœud texte)
    await expect(page.getByTestId("tx-platform")).toHaveValue(name, {
      timeout: 8_000,
    });

    // Fermer la modale transaction
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("modal-overlay")).toHaveCount(0, {
      timeout: 5_000,
    });

    // Retour plateformes → aperçu → Voir dans Positions
    await clickNav(page, "Mes plateformes");
    await expect(card).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`platform-menu-${id}`).click();
    await page.getByTestId(`preview-platform-${id}`).click();
    await page.getByTestId("platform-preview-positions").click();

    await expect(page).toHaveURL(new RegExp(`platformId=${id}`), {
      timeout: 10_000,
    });
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("holdings-platform-filter")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/E2E Preview Equity|E2EPV/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("API holdings : platformSlices multi-custody crypto (qty par jambe)", async ({
    request,
  }) => {
    const ts = Date.now();
    const platA = await request.post("/api/platforms", {
      data: {
        name: `E2E Slice A ${ts}`,
        type: "EXCHANGE_CRYPTO",
        logoKey: "E2E_SLICE_A",
        upsert: true,
      },
    });
    expect(platA.ok(), await platA.text()).toBeTruthy();
    const idA = (await platA.json()).platform.id as string;

    const platB = await request.post("/api/platforms", {
      data: {
        name: `E2E Slice B ${ts}`,
        type: "BLOCKCHAIN",
        logoKey: "BASE",
        upsert: true,
      },
    });
    expect(platB.ok(), await platB.text()).toBeTruthy();
    const idB = (await platB.json()).platform.id as string;

    const ticker = `ESL${String(ts).slice(-6)}`;
    for (const [platformId, qty, price] of [
      [idA, "1", "100"],
      [idB, "3", "100"],
    ] as const) {
      const assetRes = await request.post("/api/assets", {
        data: {
          name: `E2E Slice Coin ${ticker}`,
          ticker,
          assetClass: "CRYPTO",
          platformId,
          currency: "EUR",
          accountType: "CRYPTO",
          priceProvider: "MANUAL",
          manualPrice: "100",
        },
      });
      expect(assetRes.ok(), await assetRes.text()).toBeTruthy();
      const assetId = (await assetRes.json()).asset?.id as string;
      const buy = await request.post("/api/transactions", {
        data: {
          type: "ACHAT",
          platformId,
          assetId,
          quantity: qty,
          unitPrice: price,
          fees: "0",
          currency: "EUR",
          fxRateToEur: "1",
          occurredAt: new Date().toISOString().slice(0, 16),
          notes: "e2e multi-custody slice",
          allowNegativeCash: true,
        },
      });
      expect(buy.ok(), await buy.text()).toBeTruthy();
    }

    const holdingsRes = await request.get("/api/holdings?base=EUR");
    expect(holdingsRes.ok()).toBeTruthy();
    const body = await holdingsRes.json();
    const row = (body.holdings as Array<{
      ticker: string | null;
      quantity: string;
      platformIds?: string[];
      platformSlices?: Array<{
        platformId: string;
        quantity: string;
      }>;
    }>).find(
      (h) => (h.ticker || "").toUpperCase() === ticker.toUpperCase()
    );
    expect(row, "ligne crypto fusionnée absente").toBeTruthy();
    expect(Number(row!.quantity)).toBeCloseTo(4, 5);
    expect(row!.platformIds?.sort()).toEqual([idA, idB].sort());
    expect(row!.platformSlices?.length).toBe(2);
    const sliceA = row!.platformSlices!.find((s) => s.platformId === idA);
    const sliceB = row!.platformSlices!.find((s) => s.platformId === idB);
    expect(Number(sliceA?.quantity || 0)).toBeCloseTo(1, 5);
    expect(Number(sliceB?.quantity || 0)).toBeCloseTo(3, 5);
  });

  test("menu ⋯ : nouvelle transaction + deep-link filtre", async ({
    page,
    request,
  }) => {
    const name = `E2E Menu Tx ${Date.now()}`;
    const id = await ensurePlatform(request, {
      name,
      type: "BANQUE",
      logoKey: "E2E_MENU",
    });

    await gotoDashboard(page);
    await clickNav(page, "Mes plateformes");
    await expect(page.getByTestId(`platform-${name}`)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByTestId(`platform-menu-${id}`).click();
    await page.getByTestId(`new-tx-platform-${id}`).click();
    await expect(page.getByTestId("modal-overlay")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("tx-platform")).toHaveValue(name, {
      timeout: 8_000,
    });
  });
});
