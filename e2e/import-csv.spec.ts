import { test, expect } from "@playwright/test";
import { ensurePlatform, gotoDashboard, openImportCsvModal } from "./helpers";

const SAMPLE_CSV = `date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class
01/06/2024;ACHAT;AIR.PA;Airbus;2;140;1;EUR;;E2E import;ACTIONS
`;

test.describe("Import CSV", () => {
  test("API template + preview + commit", async ({ page, request }) => {
    const tpl = await request.get("/api/import/template");
    expect(tpl.ok()).toBeTruthy();
    const body = await tpl.text();
    expect(body).toContain("date");
    expect(body).toContain("ACHAT");

    const preview = await request.post("/api/import/preview", {
      data: { csvText: SAMPLE_CSV, formatId: "patrimo" },
    });
    expect(preview.ok()).toBeTruthy();
    const previewJson = await preview.json();
    expect(previewJson.totalRows).toBe(1);
    expect(previewJson.rows[0].type).toBe("ACHAT");
    expect(previewJson.rows[0].ticker).toBe("AIR.PA");
    expect(previewJson.stats.error).toBe(0);

    const platformId = await ensurePlatform(request);
    expect(platformId).toBeTruthy();

    const rows = previewJson.rows.map((r: { selected: boolean }) => ({
      ...r,
      selected: true,
    }));

    const commit = await request.post("/api/import/commit", {
      data: { platformId, rows },
    });
    expect(commit.ok()).toBeTruthy();
    const commitJson = await commit.json();
    expect(commitJson.created).toBeGreaterThanOrEqual(1);

    await gotoDashboard(page);
    await expect(page.getByTestId("holdings-table")).toContainText(/Airbus|AIR\.PA/i, {
      timeout: 20_000,
    });
  });

  test("modale Import CSV s'ouvre et analyse un fichier", async ({ page }) => {
    await gotoDashboard(page);
    await openImportCsvModal(page);

    await expect(
      page.getByRole("heading", { name: /Importer des transactions \(CSV\)/i })
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /Télécharger le modèle/i })
    ).toBeVisible();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "e2e-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(SAMPLE_CSV, "utf-8"),
    });

    await expect(page.getByText("e2e-import.csv")).toBeVisible({ timeout: 10_000 });
    const analyseBtn = page.getByRole("button", { name: /^Analyser$/i });
    await expect(analyseBtn).toBeEnabled({ timeout: 10_000 });
    await analyseBtn.click();

    await expect(page.getByText(/\d+\s*ligne\(s\).*séparateur/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Airbus").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Importer \d+ ligne/i })).toBeVisible();
  });
});
