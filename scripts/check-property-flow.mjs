/**
 * Parcours réel d'ajout d'un bien immobilier, du clic à la position.
 *
 * Usage : node scripts/check-property-flow.mjs
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
const PLATFORM = `Résidence principale ${stamp}`;
const PROPERTY = `Appartement Marseille ${stamp}`;

// Plateforme immobilière via l'API (la création de plateforme a son propre parcours)
const created = await page.evaluate(async (name) => {
  const res = await fetch("/api/platforms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type: "NOTAIRE_IMMOBILIER", subtype: "DIRECT" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}, PLATFORM);
const platformId = created.body?.platform?.id ?? created.body?.id;
console.log(`\n━━ Préparation ━━`);
check("plateforme immobilière créée", Boolean(platformId));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

console.log(`\n━━ Ouverture du formulaire depuis le modal de transaction ━━`);

// Bouton « Transaction » du cockpit / header
const txBtn = page
  .locator('button:has-text("Transaction")')
  .first();
await txBtn.click();
await page.waitForTimeout(1200);
check("modal de transaction ouvert", await page.locator('[data-testid="tx-platform"]').count() > 0);

// Sélectionner la plateforme immobilière
const combo = page.locator('[data-testid="tx-platform"]').first();
await combo.click();
await page.waitForTimeout(400);
// Le champ peut contenir une valeur précédente : on le vide avant de saisir.
await page.keyboard.press("Control+a");
await page.keyboard.press("Backspace");
await page.keyboard.type(PLATFORM.slice(0, 24), { delay: 20 });
await page.waitForTimeout(1200);
const option = page.getByText(PLATFORM, { exact: false }).first();
if (await option.count()) {
  await option.click();
} else {
  console.log("  (option introuvable dans la liste)");
  await page.screenshot({ path: "/tmp/property-combo.png" });
}
await page.waitForTimeout(1000);

const redirect = page.locator('[data-testid="tx-real-estate-redirect"]');
check("bascule immobilière détectée", (await redirect.count()) > 0);
if (await redirect.count()) {
  console.log(`  message : ${(await redirect.innerText()).split("\n")[0]}`);
}

const openBtn = page.locator('[data-testid="tx-open-property-form"]');
check("bouton d'ouverture présent", (await openBtn.count()) > 0);
if ((await openBtn.count()) === 0) {
  await page.screenshot({ path: "/tmp/property-fail.png" });
  console.log("  capture: /tmp/property-fail.png");
  await browser.close();
  process.exit(1);
}
await openBtn.click();
await page.waitForTimeout(1200);

console.log(`\n━━ Étape 1 : le bien ━━`);
check("formulaire immobilier ouvert", (await page.locator('[data-testid="property-wizard"]').count()) > 0);
await page.fill('[data-testid="property-name"]', PROPERTY);
await page.selectOption('[data-testid="property-type"]', "APPARTEMENT");
await page.selectOption('[data-testid="property-usage"]', "LOCATIF_NU");
await page.fill('[data-testid="property-area"]', "68");
await page.fill('[data-testid="property-address"]', "12 rue de la République");
await page.fill("#prop-zip", "13002");
await page.fill("#prop-city", "Marseille");
await page.fill("#prop-rooms", "3");
await page.screenshot({ path: "/tmp/property-step1.png" });

await page.locator('button:has-text("Suivant")').first().click();
await page.waitForTimeout(800);

console.log(`\n━━ Étape 2 : acquisition à 50 % ━━`);
await page.fill('[data-testid="property-price"]', "400000");
await page.fill('[data-testid="property-fees"]', "14000");
await page.fill('[data-testid="property-share"]', "50");
const dateInput = page.locator('[data-testid="property-date"], input[type="date"]').first();
await dateInput.fill("2024-09-12");
await page.waitForTimeout(700);

const recap = page.locator('[data-testid="property-acquisition-recap"]');
check("récapitulatif affiché", (await recap.count()) > 0);
if (await recap.count()) {
  const text = (await recap.innerText()).replace(/\s+/g, " ");
  console.log(`  ${text}`);
  check("valeur de la part calculée en direct", text.includes("200"), text.slice(0, 90));
  check("avertissement quote-part / prêt affiché", text.includes("réellement"));
}
await page.screenshot({ path: "/tmp/property-step2.png" });

await page.locator('button:has-text("Suivant")').first().click();
await page.waitForTimeout(800);

console.log(`\n━━ Étape 3 : valorisation et exploitation ━━`);
const rentField = page.locator('[data-testid="property-rent"]');
check("champs locatifs affichés (usage locatif)", (await rentField.count()) > 0);
if (await rentField.count()) {
  await rentField.fill("1100");
  await page.fill("#prop-charges", "120");
  await page.fill("#prop-tax", "900");
  await page.waitForTimeout(700);
  const y = page.locator('[data-testid="property-yield"]');
  if (await y.count()) console.log(`  ${(await y.innerText()).replace(/\s+/g, " ")}`);
  check("rendement brut calculé", (await y.count()) > 0);
}
await page.screenshot({ path: "/tmp/property-step3.png" });

console.log(`\n━━ Validation ━━`);
await page.locator('button:has-text("Ajouter le bien")').first().click();
await page.waitForTimeout(3500);

const props = await page.evaluate(async () => {
  const res = await fetch("/api/real-estate/properties");
  return res.json();
});
const mine = (props.properties ?? []).find((p) => p.name === PROPERTY);
check("bien enregistré", Boolean(mine));
if (mine) {
  console.log(`  ${mine.name} · ${mine.propertyType} · ${mine.usage} · ${mine.livingAreaM2} m²`);
  console.log(`  adresse : ${mine.addressLine}, ${mine.postalCode} ${mine.city}`);
  console.log(`  valeur du bien entier : ${mine.propertyValueEur} €`);
  console.log(`  mode de valorisation  : ${mine.valuationMode}`);
  check("valeur = prix d'achat du bien entier", Number(mine.propertyValueEur) === 400000, mine.propertyValueEur);
  check("estimation automatique activée", mine.valuationMode === "DVF_AUTO", mine.valuationMode);
  check("loyer conservé", Number(mine.monthlyRentEur) === 1100, String(mine.monthlyRentEur));
}

const holdings = await page.evaluate(async () => {
  const res = await fetch("/api/holdings");
  return res.json();
});
const pos = (holdings.holdings ?? []).find((h) => h.name === PROPERTY);
check("position visible dans Positions", Boolean(pos));
if (pos) {
  console.log(`  quantité ${pos.quantity} · valeur ${pos.marketValueEur} · coût ${pos.costBasisEur}`);
  check("valeur = 50 % de 400 000", Math.abs(Number(pos.marketValueEur) - 200000) < 1, pos.marketValueEur);
  check("coût de revient frais inclus", Math.abs(Number(pos.costBasisEur) - 214000) < 1, pos.costBasisEur);
  check("classé IMMOBILIER", pos.assetClass === "IMMOBILIER", pos.assetClass);
}

const txs = await page.evaluate(async () => {
  const res = await fetch("/api/transactions?pageSize=100");
  return res.json();
});
const buy = (txs.transactions ?? []).find((t) => t.asset?.name === PROPERTY);
check("transaction d'achat au journal", Boolean(buy));
if (buy) {
  console.log(`  ${buy.occurredAt.slice(0, 10)} ${buy.type} qté=${buy.quantity} prix=${buy.unitPrice} frais=${buy.fees}`);
  check("quantité = quote-part", Number(buy.quantity) === 0.5, String(buy.quantity));
  check("date d'achat saisie conservée", buy.occurredAt.startsWith("2024-09-12"), buy.occurredAt.slice(0, 10));
}

await page.screenshot({ path: "/tmp/property-done.png" });

const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);
console.log(`\nPLATFORM=${platformId}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
