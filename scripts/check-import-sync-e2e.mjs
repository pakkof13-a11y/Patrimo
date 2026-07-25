/**
 * Import CSV et synchronisation on-chain : les transactions arrivent-elles avec
 * le bon type, le bon prix, la bonne quantité et la bonne date, et
 * s'agrègent-elles à une position existante ?
 *
 * Usage : node scripts/check-import-sync-e2e.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const USER = process.env.CHECK_EMAIL ?? "demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "ci-only-demo-password";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="username"]', { timeout: 20000 });
await page.fill('input[name="username"]', USER);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });

async function api(method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(p, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      });
      let parsed = null;
      try { parsed = await res.json(); } catch { parsed = null; }
      return { status: res.status, body: parsed };
    },
    [method, path, body ?? null]
  );
}

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const stamp = Date.now();
const TICKER = `CSV${stamp % 10000}`;

console.log("\n━━ Préparation ━━");
const pf = await api("POST", "/api/platforms", {
  name: `E2E Import ${stamp}`,
  type: "COURTIER",
});
const platformId = pf.body?.platform?.id ?? pf.body?.id;
console.log(`  plateforme : ${platformId ? "créée" : "ÉCHEC"}`);

// Position préexistante, pour vérifier que l'import s'y agrège
const at = await api("POST", "/api/assets", {
  name: `E2E CSV Titre ${stamp}`,
  ticker: TICKER,
  assetClass: "ACTIONS",
  accountType: "CTO",
  currency: "EUR",
  platformId,
  priceProvider: "MANUAL",
  manualPrice: "200",
});
const assetId = at.body?.asset?.id ?? at.body?.id;

await api("POST", "/api/transactions", {
  type: "ACHAT", platformId, assetId,
  quantity: "10", unitPrice: "100", fees: "0",
  currency: "EUR", fxRateToEur: "1",
  occurredAt: "2026-01-15T10:00:00.000Z",
  autoFundCash: true,
});
const hBefore = await api("GET", "/api/holdings");
const posBefore = (hBefore.body?.holdings ?? []).find((h) => h.assetId === assetId);
console.log(`  position initiale : ${posBefore?.quantity} titres, PRU ${posBefore?.avgCostEur}`);

// ── Import CSV ───────────────────────────────────────────────────────────────
console.log("\n━━ Import CSV ━━");

// Format générique Patrimo : point-virgule, décimales à la virgule (locale FR)
const csvText = [
  "Date;Type;Ticker;Quantite;Prix;Frais;Devise",
  `20/02/2026;ACHAT;${TICKER};5;120,50;2,50;EUR`,
  `05/03/2026;ACHAT;${TICKER};3;130,00;1,00;EUR`,
  `12/03/2026;VENTE;${TICKER};4;150,00;1,50;EUR`,
].join("\n");

const preview = await api("POST", "/api/import/preview", {
  csvText,
  formatId: "auto",
});
check("aperçu accepté", preview.status === 200,
  preview.status !== 200 ? JSON.stringify(preview.body).slice(0, 200) : "");

const draft = preview.body?.rows ?? preview.body?.draftRows ?? [];
console.log(`  lignes d'aperçu : ${draft.length}`);
if (draft.length > 0) {
  const r0 = draft[0];
  console.log(`  1re ligne : ${JSON.stringify(r0).slice(0, 260)}`);
  check("3 lignes reconnues", draft.length === 3, String(draft.length));
}

const commit = await api("POST", "/api/import/commit", {
  platformId,
  csvText,
  accountEnvelopeType: "CTO",
});
check("import validé", commit.status === 200,
  commit.status !== 200 ? JSON.stringify(commit.body).slice(0, 250) : "");
console.log(`  résultat : ${JSON.stringify(commit.body).slice(0, 260)}`);

// ── Contrôle du journal ──────────────────────────────────────────────────────
console.log("\n━━ Journal après import ━━");
const list = await api("GET", `/api/transactions?pageSize=100&q=${TICKER}`);
const txs = (list.body?.transactions ?? []).filter((t) => t.assetId === assetId);
console.log(`  transactions sur l'actif : ${txs.length}`);
for (const t of txs.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
  console.log(`    ${t.occurredAt.slice(0, 10)} ${t.type.padEnd(7)} qté=${t.quantity} prix=${t.unitPrice} frais=${t.fees}`);
}

const buy0220 = txs.find((t) => t.occurredAt.startsWith("2026-02-20"));
if (buy0220) {
  check("date CSV JJ/MM/AAAA correctement lue", true, buy0220.occurredAt.slice(0, 10));
  check("type ACHAT", buy0220.type === "ACHAT", buy0220.type);
  check("quantité = 5", Number(buy0220.quantity) === 5, String(buy0220.quantity));
  check("prix à virgule décimale lu (120,50 → 120.5)",
    Number(buy0220.unitPrice) === 120.5, String(buy0220.unitPrice));
  check("frais à virgule décimale lus (2,50 → 2.5)",
    Number(buy0220.fees) === 2.5, String(buy0220.fees));
} else {
  check("achat du 20/02 retrouvé", false);
}

const sale = txs.find((t) => t.type === "VENTE");
check("vente taguée VENTE", Boolean(sale), sale ? String(sale.quantity) : "absente");

// ── Agrégation dans Positions ────────────────────────────────────────────────
console.log("\n━━ Position après import ━━");
const hAfter = await api("GET", "/api/holdings");
const lines = (hAfter.body?.holdings ?? []).filter((h) => h.assetId === assetId);
const posAfter = lines[0];
if (posAfter) {
  check("toujours une seule ligne", lines.length === 1, `${lines.length}`);
  // 10 + 5 + 3 − 4 = 14
  check("quantité cumulée = 14", Number(posAfter.quantity) === 14, String(posAfter.quantity));
  // Coût : 1000 + (5×120,50+2,50=605) + (3×130+1=391) = 1996 ; PRU = 1996/18 = 110,888…
  // Après vente de 4 : coût restant = 1996 × 14/18 = 1552,44
  const expected = (1000 + 605 + 391) * (14 / 18);
  check("coût de revient cohérent après vente",
    Math.abs(Number(posAfter.costBasisEur) - expected) < 0.5,
    `${Number(posAfter.costBasisEur).toFixed(2)} vs ${expected.toFixed(2)} attendu`);
} else {
  check("position présente après import", false);
}

// ── Import rejoué : doublons ? ───────────────────────────────────────────────
console.log("\n━━ Import rejoué (dédoublonnage) ━━");
const again = await api("POST", "/api/import/commit", {
  platformId, csvText, accountEnvelopeType: "CTO",
});
console.log(`  résultat : ${JSON.stringify(again.body).slice(0, 220)}`);
const list2 = await api("GET", `/api/transactions?pageSize=100&q=${TICKER}`);
const txs2 = (list2.body?.transactions ?? []).filter((t) => t.assetId === assetId);
check("aucun doublon créé", txs2.length === txs.length,
  `${txs.length} → ${txs2.length}`);

// ── Bilan ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);
console.log(`\nPLATFORM_ID=${platformId}\nASSET_ID=${assetId}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
