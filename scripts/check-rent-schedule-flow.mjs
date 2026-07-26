/**
 * Parcours réel des loyers récurrents et de la valorisation manuelle.
 *
 * Crée un bien locatif avec un jour d'encaissement via le formulaire, vérifie
 * que les échéances sont proposées, les confirme, et contrôle qu'une seconde
 * confirmation ne duplique rien. Puis saisit une valeur à la main et vérifie
 * qu'elle se propage à la position.
 *
 * Usage : node scripts/check-rent-schedule-flow.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const USER = process.env.CHECK_EMAIL ?? "demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "ci-only-demo-password";

const results = [];
function check(label, ok, detail = "") {
  results.push({ label, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (e) => console.log("  [erreur page]", e.message));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="username"]', { timeout: 20000 });
await page.fill('input[name="username"]', USER);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await page.waitForTimeout(3000);

const stamp = Date.now();
const PLATFORM = `Loyers ${stamp}`;
const PROPERTY = `T2 locatif ${stamp}`;

const created = await page.evaluate(async (name) => {
  const res = await fetch("/api/platforms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "NOTAIRE_IMMOBILIER", subtype: "DIRECT" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, PLATFORM);
const platformId = created.body?.platform?.id ?? created.body?.id;
console.log("\n━━ Préparation ━━");
check("plateforme immobilière créée", Boolean(platformId));

// Bail démarré il y a 4 mois pour avoir plusieurs échéances en retard.
const start = new Date(Date.now() - 120 * 86400000);
const startIso = start.toISOString().slice(0, 10);

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

console.log("\n━━ Saisie du bien depuis le formulaire ━━");
await page.locator('button:has-text("Transaction")').first().click();
await page.waitForTimeout(1200);
const combo = page.locator('[data-testid="tx-platform"]').first();
await combo.click();
await page.waitForTimeout(400);
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.keyboard.type(PLATFORM.slice(0, 20), { delay: 20 });
await page.waitForTimeout(1200);
const option = page.getByText(PLATFORM, { exact: false }).first();
if (await option.count()) await option.click();
await page.waitForTimeout(900);
await page.locator('[data-testid="tx-open-property-form"]').click();
await page.waitForTimeout(1200);

await page.fill('[data-testid="property-name"]', PROPERTY);
await page.selectOption('[data-testid="property-type"]', "APPARTEMENT");
await page.selectOption('[data-testid="property-usage"]', "LOCATIF_NU");
await page.fill('[data-testid="property-area"]', "45");
await page.fill("#prop-rooms", "2");
await page.locator('button:has-text("Suivant")').first().click();
await page.waitForTimeout(700);

await page.fill('[data-testid="property-price"]', "250000");
await page.fill('[data-testid="property-fees"]', "18000");
await page.fill('[data-testid="property-share"]', "100");
await page.locator('[data-testid="property-date"], input[type="date"]').first()
  .fill("2025-01-10");
await page.locator('button:has-text("Suivant")').first().click();
await page.waitForTimeout(700);

await page.fill('[data-testid="property-rent"]', "850");
await page.fill("#prop-charges", "95");
const rentDay = page.locator('[data-testid="property-rent-day"]');
check("champ « jour d'encaissement » présent", (await rentDay.count()) > 0);
await rentDay.fill("5");
// Le champ de début de bail est le second input date de l'étape.
const dates = page.locator('input[type="date"]');
await dates.last().fill(startIso);
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/rent-step3.png" });

await page.locator('button:has-text("Ajouter le bien")').first().click();
await page.waitForTimeout(3500);

const props = await page.evaluate(async () => {
  const r = await fetch("/api/real-estate/properties");
  return r.json();
});
const mine = (props.properties ?? []).find((p) => p.name === PROPERTY);
check("bien enregistré", Boolean(mine));
const assetId = mine?.assetId;

const pendingBefore = await page.evaluate(async () => {
  const r = await fetch("/api/real-estate/rent-schedule");
  return r.json();
});
const minePending = (pendingBefore.pending ?? []).filter(
  (p) => p.assetId === assetId
);
console.log(`  échéances proposées : ${minePending.length} (bail depuis ${startIso})`);
check("le jour d'encaissement a bien été enregistré", minePending.length > 0);
check(
  "loyers et charges proposés séparément",
  minePending.some((p) => p.kind === "RENT") &&
    minePending.some((p) => p.kind === "CHARGES")
);

console.log("\n━━ Panneau d'échéances ━━");
await page.goto(`${BASE}/positions/immobilier`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const panel = page.locator('[data-testid="rent-schedule-panel"]');
check("panneau d'échéances affiché", (await panel.count()) > 0);
if (await panel.count()) {
  console.log(
    "  " + (await panel.innerText()).replace(/\n+/g, " | ").slice(0, 300)
  );
  await panel.screenshot({ path: "/tmp/rent-panel.png" });
}

const txBefore = await page.evaluate(async () => {
  const r = await fetch("/api/transactions?pageSize=200");
  return (await r.json()).transactions ?? [];
});
check(
  "rien n'est écrit tant qu'on n'a pas confirmé",
  txBefore.filter((t) => (t.notes ?? "").includes("[loyer:")).length === 0
);

console.log("\n━━ Confirmation ━━");
await page.locator('[data-testid="rent-confirm"]').click();
await page.waitForTimeout(4000);

const txAfter = await page.evaluate(async () => {
  const r = await fetch("/api/transactions?pageSize=200");
  return (await r.json()).transactions ?? [];
});
const rents = txAfter.filter((t) => (t.notes ?? "").includes(`[loyer:`) && (t.notes ?? "").includes(assetId));
const charges = txAfter.filter((t) => (t.notes ?? "").includes(`[charges:`) && (t.notes ?? "").includes(assetId));
console.log(`  ${rents.length} loyer(s), ${charges.length} charge(s) écrits`);
check("les loyers sont écrits en LOYER", rents.length > 0 && rents.every((t) => t.type === "LOYER"));
check("les charges sont écrites en FRAIS", charges.length > 0 && charges.every((t) => t.type === "FRAIS"));
check(
  "une écriture par échéance proposée",
  rents.length + charges.length === minePending.length,
  `${rents.length + charges.length} vs ${minePending.length}`
);

console.log("\n━━ Reconfirmer ne duplique pas ━━");
const again = await page.evaluate(
  async (entries) => {
    const r = await fetch("/api/real-estate/rent-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    return r.json();
  },
  minePending.map((p) => ({ assetId: p.assetId, kind: p.kind, dueDate: p.dueDate }))
);
console.log(`  ${JSON.stringify(again)}`);
check("échéances ignorées", again.created === 0 && again.skipped === minePending.length);

const txDup = await page.evaluate(async () => {
  const r = await fetch("/api/transactions?pageSize=200");
  return (await r.json()).transactions ?? [];
});
check(
  "aucune écriture supplémentaire au journal",
  txDup.filter((t) => (t.notes ?? "").includes(assetId)).length ===
    rents.length + charges.length
);

console.log("\n━━ Valorisation manuelle ━━");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const setBtn = page.locator('[data-testid="property-set-value"]').first();
check("bouton de saisie de valeur présent", (await setBtn.count()) > 0);
await setBtn.click();
await page.waitForTimeout(500);
await page.locator('[data-testid="property-value-input"]').fill("310000");
await page.locator('[data-testid="property-value-save"]').click();
await page.waitForTimeout(4000);

const after = await page.evaluate(async () => {
  const r = await fetch("/api/real-estate/properties");
  return r.json();
});
const updated = (after.properties ?? []).find((p) => p.assetId === assetId);
check("valeur enregistrée", Number(updated?.propertyValueEur) === 310000, String(updated?.propertyValueEur));
check("bascule en mode manuel", updated?.valuationMode === "MANUAL", String(updated?.valuationMode));

const holdings = await page.evaluate(async () => {
  const r = await fetch("/api/holdings");
  return (await r.json()).holdings ?? [];
});
const pos = holdings.find((h) => h.assetId === assetId);
check("la position suit la nouvelle valeur", Math.abs(Number(pos?.marketValueEur) - 310000) < 1, String(pos?.marketValueEur));

await page.screenshot({ path: "/tmp/rent-done.png" });

// Nettoyage
await page.evaluate(async (pid) => {
  await fetch(`/api/platforms/${pid}`, { method: "DELETE" });
}, platformId);

const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
