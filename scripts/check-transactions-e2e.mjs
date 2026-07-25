/**
 * Vérification de bout en bout de la création de transactions.
 *
 * Pour chaque type : la transaction est-elle correctement taguée, le prix, la
 * quantité et la date correspondent-ils à la saisie, et la position remonte-t-elle
 * dans Positions en s'incrémentant sur une ligne existante ?
 *
 * Usage : node scripts/check-transactions-e2e.mjs
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

/** Appel API dans le contexte authentifié de la page. */
async function api(method, path, body) {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(p, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      });
      let parsed = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
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

// ── Préparation : plateforme + actifs dédiés ─────────────────────────────────
console.log("\n━━ Préparation ━━");

const pf = await api("POST", "/api/platforms", {
  name: `E2E Courtier ${stamp}`,
  type: "COURTIER",
});
const platformId = pf.body?.platform?.id ?? pf.body?.id;
console.log(`  plateforme : ${platformId ? "créée" : `ÉCHEC ${JSON.stringify(pf).slice(0, 200)}`}`);

const bank = await api("POST", "/api/platforms", {
  name: `E2E Banque ${stamp}`,
  type: "BANQUE",
});
const bankId = bank.body?.platform?.id ?? bank.body?.id;

const at = await api("POST", "/api/assets", {
  name: `E2E Action ${stamp}`,
  ticker: `E2E${stamp % 10000}`,
  assetClass: "ACTIONS",
  accountType: "CTO",
  currency: "EUR",
  platformId,
  priceProvider: "MANUAL",
  manualPrice: "120",
});
const assetId = at.body?.asset?.id ?? at.body?.id;
console.log(`  actif      : ${assetId ? "créé" : `ÉCHEC ${JSON.stringify(at).slice(0, 300)}`}`);

if (!platformId || !assetId) {
  console.log("\nPréparation impossible — arrêt.");
  await browser.close();
  process.exit(1);
}

// ── 1. Achat initial ─────────────────────────────────────────────────────────
console.log("\n━━ 1. Achat initial (10 × 100 € + 5 € de frais) ━━");
const buy1Date = "2026-03-10T10:30:00.000Z";
const buy1 = await api("POST", "/api/transactions", {
  type: "ACHAT",
  platformId,
  assetId,
  quantity: "10",
  unitPrice: "100",
  fees: "5",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: buy1Date,
  autoFundCash: true,
});
check("création acceptée", buy1.status === 200 || buy1.status === 201,
  buy1.status !== 200 && buy1.status !== 201 ? JSON.stringify(buy1.body).slice(0, 200) : "");

const list1 = await api("GET", "/api/transactions?limit=200");
const txs1 = list1.body?.transactions ?? list1.body?.items ?? [];
const t1 = txs1.find((t) => t.assetId === assetId && t.type === "ACHAT");
if (t1) {
  check("type tagué ACHAT", t1.type === "ACHAT", t1.type);
  check("quantité conservée", String(t1.quantity) === "10", String(t1.quantity));
  check("prix unitaire conservé", Number(t1.unitPrice) === 100, String(t1.unitPrice));
  check("date conservée", new Date(t1.occurredAt).toISOString() === buy1Date,
    new Date(t1.occurredAt).toISOString());
  check("frais conservés", Number(t1.fees) === 5, String(t1.fees));
} else {
  check("transaction retrouvée dans le journal", false);
}

// ── 2. Remontée dans Positions ───────────────────────────────────────────────
console.log("\n━━ 2. Remontée dans Positions ━━");
const h1 = await api("GET", "/api/holdings");
const holdings1 = h1.body?.holdings ?? [];
const pos1 = holdings1.find((h) => h.assetId === assetId);
if (pos1) {
  check("position présente", true);
  check("quantité = 10", Number(pos1.quantity) === 10, String(pos1.quantity));
  // CUMP = (10 × 100 + 5) / 10 = 100,50
  check("PRU intègre les frais (100,50)", Math.abs(Number(pos1.avgCostEur) - 100.5) < 0.01,
    String(pos1.avgCostEur));
  check("coût de revient = 1005 €", Math.abs(Number(pos1.costBasisEur) - 1005) < 0.01,
    String(pos1.costBasisEur));
} else {
  check("position présente dans Positions", false);
}

// ── 3. Second achat : incrémentation d'une position existante ────────────────
console.log("\n━━ 3. Second achat (5 × 140 €) — incrémentation ━━");
await api("POST", "/api/transactions", {
  type: "ACHAT",
  platformId,
  assetId,
  quantity: "5",
  unitPrice: "140",
  fees: "0",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: "2026-04-02T09:00:00.000Z",
  autoFundCash: true,
});
const h2 = await api("GET", "/api/holdings");
const pos2 = (h2.body?.holdings ?? []).find((h) => h.assetId === assetId);
const lines2 = (h2.body?.holdings ?? []).filter((h) => h.assetId === assetId).length;
if (pos2) {
  check("une seule ligne, pas deux", lines2 === 1, `${lines2} ligne(s)`);
  check("quantité cumulée = 15", Number(pos2.quantity) === 15, String(pos2.quantity));
  // CUMP = (1005 + 700) / 15 = 113,666…
  check("PRU recalculé (113,67)", Math.abs(Number(pos2.avgCostEur) - 113.6667) < 0.01,
    String(pos2.avgCostEur));
  check("coût de revient = 1705 €", Math.abs(Number(pos2.costBasisEur) - 1705) < 0.01,
    String(pos2.costBasisEur));
} else {
  check("position toujours présente", false);
}

// ── 4. Vente partielle ───────────────────────────────────────────────────────
console.log("\n━━ 4. Vente partielle (6 × 150 €) ━━");
const sell = await api("POST", "/api/transactions", {
  type: "VENTE",
  platformId,
  assetId,
  quantity: "6",
  unitPrice: "150",
  fees: "3",
  currency: "EUR",
  fxRateToEur: "1",
  occurredAt: "2026-05-20T14:00:00.000Z",
});
check("vente acceptée", sell.status === 200 || sell.status === 201,
  sell.status >= 400 ? JSON.stringify(sell.body).slice(0, 200) : "");
const h3 = await api("GET", "/api/holdings");
const pos3 = (h3.body?.holdings ?? []).find((h) => h.assetId === assetId);
if (pos3) {
  check("quantité restante = 9", Number(pos3.quantity) === 9, String(pos3.quantity));
  // Le PRU ne bouge pas à la vente (CUMP)
  check("PRU inchangé après vente", Math.abs(Number(pos3.avgCostEur) - 113.6667) < 0.01,
    String(pos3.avgCostEur));
}

// ── 5. Chaque type de transaction ────────────────────────────────────────────
console.log("\n━━ 5. Couverture des types ━━");

const cryptoAsset = await api("POST", "/api/assets", {
  name: `E2E Crypto ${stamp}`,
  ticker: `XE2E${stamp % 1000}`,
  assetClass: "CRYPTO",
  accountType: "CRYPTO",
  currency: "EUR",
  platformId,
  priceProvider: "MANUAL",
  manualPrice: "50",
});
const cryptoId = cryptoAsset.body?.asset?.id ?? cryptoAsset.body?.id;

const cases = [
  ["APPORT", { type: "APPORT", platformId: bankId, cashAmount: "10000", occurredAt: "2026-01-05T09:00:00.000Z" }],
  ["DIVIDENDE", { type: "DIVIDENDE", platformId, assetId, cashAmount: "45", occurredAt: "2026-06-01T09:00:00.000Z" }],
  ["REWARD", { type: "REWARD", platformId, assetId: cryptoId, quantity: "2", unitPrice: "50", occurredAt: "2026-06-05T09:00:00.000Z" }],
  ["AIRDROP", { type: "AIRDROP", platformId, assetId: cryptoId, quantity: "1", occurredAt: "2026-06-06T09:00:00.000Z" }],
  ["SPLIT", { type: "SPLIT", platformId, assetId, quantity: "2", occurredAt: "2026-06-10T09:00:00.000Z" }],
  ["FRAIS", { type: "FRAIS", platformId: bankId, cashAmount: "12", occurredAt: "2026-06-11T09:00:00.000Z" }],
  ["RETRAIT", { type: "RETRAIT", platformId: bankId, cashAmount: "500", occurredAt: "2026-06-12T09:00:00.000Z" }],
  ["TRANSFERT_CASH", { type: "TRANSFERT_CASH", platformId: bankId, toPlatformId: platformId, cashAmount: "200", occurredAt: "2026-06-13T09:00:00.000Z" }],
  ["INTERET", { type: "INTERET", platformId: bankId, cashAmount: "30", occurredAt: "2026-06-14T09:00:00.000Z" }],
];

const created = {};
for (const [label, payload] of cases) {
  const r = await api("POST", "/api/transactions", { fees: "0", currency: "EUR", fxRateToEur: "1", ...payload });
  const ok = r.status === 200 || r.status === 201;
  created[label] = ok;
  check(`${label} créé`, ok, ok ? "" : JSON.stringify(r.body).slice(0, 160));
}

// Relecture : chaque type doit être tagué tel quel
const listAll = await api("GET", "/api/transactions?limit=500");
const all = listAll.body?.transactions ?? listAll.body?.items ?? [];
const mine = all.filter(
  (t) => t.platformId === platformId || t.platformId === bankId
);
console.log(`\n  transactions du banc : ${mine.length}`);
for (const [label] of cases) {
  if (!created[label]) continue;
  const found = mine.some((t) => t.type === label);
  check(`${label} relu avec le bon tag`, found);
}

// ── 6. Effet du SPLIT sur la position ────────────────────────────────────────
console.log("\n━━ 6. Effet du split 2:1 ━━");
const h4 = await api("GET", "/api/holdings");
const pos4 = (h4.body?.holdings ?? []).find((h) => h.assetId === assetId);
if (pos4) {
  check("quantité doublée (9 → 18)", Number(pos4.quantity) === 18, String(pos4.quantity));
  check("coût de revient inchangé par le split",
    Math.abs(Number(pos4.costBasisEur) - Number(pos3?.costBasisEur ?? 0)) < 0.01,
    `${pos3?.costBasisEur} → ${pos4.costBasisEur}`);
  check("PRU divisé par 2", Math.abs(Number(pos4.avgCostEur) - Number(pos3?.avgCostEur ?? 0) / 2) < 0.01,
    String(pos4.avgCostEur));
}

// ── 7. Reward / airdrop : quantité sans coût ─────────────────────────────────
console.log("\n━━ 7. Réception gratuite (reward + airdrop) ━━");
const posC = (h4.body?.holdings ?? []).find((h) => h.assetId === cryptoId);
if (posC) {
  check("quantité = 3 (2 reward + 1 airdrop)", Number(posC.quantity) === 3, String(posC.quantity));
  check("coût de revient nul — rien n'a été dépensé",
    Math.abs(Number(posC.costBasisEur)) < 0.01, String(posC.costBasisEur));
} else {
  check("position crypto présente", false);
}

// ── Bilan ────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);

console.log(`\nPLATFORM_ID=${platformId}`);
console.log(`BANK_ID=${bankId}`);
console.log(`ASSET_ID=${assetId}`);
console.log(`CRYPTO_ID=${cryptoId}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
