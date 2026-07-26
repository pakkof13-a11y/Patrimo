/**
 * Parcours réel de saisie d'une assurance-vie, du contrat au produit structuré.
 *
 * Vérifie que le support entre au patrimoine par le journal (prix de revient,
 * plus-value) et non par un champ à côté, et que les caractéristiques du
 * structuré sont bien conservées.
 *
 * Usage : node scripts/check-life-insurance-flow.mjs
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
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on("pageerror", (e) => console.log("  [erreur page]", e.message));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="username"]', { timeout: 20000 });
await page.fill('input[name="username"]', USER);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await page.waitForTimeout(2500);

const stamp = Date.now();
const INSURER = `Spirica Test ${stamp}`;
const STRUCTURED = `Athena Autocall ${stamp}`;

console.log("\n━━ Navigation vers l'onglet ━━");
await page.goto(`${BASE}/assurance-vie`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
check(
  "onglet Assurance-vie accessible",
  (await page.locator('[data-testid="assurance-vie-tab"]').count()) > 0
);

console.log("\n━━ Création du contrat ━━");
const combo = page.locator('[data-testid="av-insurer"]').first();
await combo.click();
await page.keyboard.type(INSURER, { delay: 15 });
await page.waitForTimeout(600);
await page.locator('[data-testid="av-open-date"]').fill("2015-03-20");
await page.locator('[data-testid="av-add-policy"]').click();
await page.waitForTimeout(3000);

const contracts = await page.evaluate(async () => {
  const r = await fetch("/api/life-insurance");
  return (await r.json()).policies ?? [];
});
const mine = contracts.find((c) => c.insurer.includes(String(stamp)));
check("contrat enregistré", Boolean(mine));

const card = page.locator('[data-testid="av-contract"]', {
  hasText: String(stamp),
});
if (await card.count()) {
  const txt = (await card.first().innerText()).replace(/\s+/g, " ");
  console.log(`  ${txt.slice(0, 160)}`);
  check(
    "antériorité fiscale calculée (contrat de 2015 → acquise)",
    txt.includes("antériorité acquise"),
    txt.match(/antériorité[^·]*/)?.[0] ?? ""
  );
}

console.log("\n━━ Saisie d'un produit structuré ━━");
await page.locator('[data-testid="support-contract"]').selectOption(mine.id);
await page.locator('[data-testid="support-kind"]').selectOption("STRUCTURED");
await page.waitForTimeout(500);
check(
  "champs structurés révélés par la nature du support",
  (await page.locator('[data-testid="support-structured-fields"]').count()) > 0
);

await page.fill('[data-testid="support-name"]', STRUCTURED);
await page.fill('[data-testid="support-amount"]', "10000");
await page.fill('[data-testid="support-underlying"]', "Euro Stoxx 50");
await page.fill('[data-testid="support-strike"]', "4200");
await page.fill('[data-testid="support-coupon"]', "8");
await page
  .locator('[data-testid="support-coupon-frequency"]')
  .selectOption("QUARTERLY");
await page.fill("#\\30 ", "").catch(() => {});
await page.waitForTimeout(700);

const recap = page.locator('[data-testid="support-coupon-recap"]');
check("récapitulatif de coupon affiché", (await recap.count()) > 0);
if (await recap.count()) {
  const t = (await recap.innerText()).replace(/\s+/g, " ");
  console.log(`  ${t}`);
  // 10 000 € à 8 % annuel versé trimestriellement = 200 € par échéance.
  check("coupon trimestriel = taux annuel / 4", t.includes("200,00"), t);
  check("coupon annuel affiché", t.includes("800,00"), t);
}

console.log("\n━━ L'échéance est exigée pour un structuré ━━");
const submit = page.locator('[data-testid="support-submit"]');
check("bouton désactivé sans échéance", await submit.isDisabled());

await page.locator('[data-testid="support-maturity"]').fill("2031-03-20");
await page.waitForTimeout(400);
check("bouton actif une fois l'échéance saisie", !(await submit.isDisabled()));

await submit.click();
await page.waitForTimeout(3500);

console.log("\n━━ Le support entre par le journal ━━");
const supports = await page.evaluate(async () => {
  const r = await fetch("/api/life-insurance/supports");
  return (await r.json()).supports ?? [];
});
const s = supports.find((x) => x.name === STRUCTURED);
check("support enregistré", Boolean(s));
if (s) {
  console.log(
    `  ${s.kind} · ${s.underlying} · strike ${s.strikeLevel} · coupon ${s.couponRatePct}% ${s.couponFrequency}`
  );
  check("nature STRUCTURED conservée", s.kind === "STRUCTURED");
  check("sous-jacent conservé", s.underlying === "Euro Stoxx 50");
  check("strike conservé", Number(s.strikeLevel) === 4200, s.strikeLevel);
  check("coupon conservé", Number(s.couponRatePct) === 8, s.couponRatePct);
  check(
    "périodicité conservée",
    s.couponFrequency === "QUARTERLY",
    s.couponFrequency
  );
  check(
    "échéance conservée",
    (s.maturityDate ?? "").startsWith("2031-03-20"),
    s.maturityDate
  );
  check("rattaché au contrat", s.lifeInsuranceId === mine.id);
}

const holdings = await page.evaluate(async () => {
  const r = await fetch("/api/holdings");
  return (await r.json()).holdings ?? [];
});
const pos = holdings.find((h) => h.name === STRUCTURED);
check("position visible dans Positions", Boolean(pos));
if (pos) {
  console.log(
    `  qté ${pos.quantity} · valeur ${pos.marketValueEur} · coût ${pos.costBasisEur} · ${pos.accountType}`
  );
  check("classé dans l'enveloppe AV", pos.accountType === "AV", pos.accountType);
  check(
    "valeur = montant investi",
    Math.abs(Number(pos.marketValueEur) - 10000) < 1,
    pos.marketValueEur
  );
  check(
    "prix de revient présent (donc plus-value calculable)",
    Number(pos.costBasisEur) > 0,
    pos.costBasisEur
  );
}

// pageSize est plafonné à 100 côté API : on cherche par nom plutôt que de
// parcourir tout le journal, sinon un versement daté hors de la première page
// passerait pour absent.
const txs = await page.evaluate(async (name) => {
  const r = await fetch(
    `/api/transactions?pageSize=100&q=${encodeURIComponent(name)}`
  );
  return (await r.json()).transactions ?? [];
}, STRUCTURED);
const buy = txs.find((t) => t.asset?.name === STRUCTURED);
check("transaction d'achat au journal", Boolean(buy));
if (buy) {
  console.log(`  ${buy.occurredAt.slice(0, 10)} ${buy.type} ${buy.unitPrice} €`);
  check("type ACHAT", buy.type === "ACHAT", buy.type);
}

console.log("\n━━ Réévaluation ━━");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const valueInput = page
  .locator(`[data-testid="av-support-row"]:has-text("${STRUCTURED.slice(0, 20)}")`)
  .locator('[data-testid="support-value"]');
if (await valueInput.count()) {
  await valueInput.first().fill("11500");
  await valueInput.first().blur();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(async () => {
    const r = await fetch("/api/holdings");
    return (await r.json()).holdings ?? [];
  });
  const p2 = after.find((h) => h.name === STRUCTURED);
  check(
    "réévaluation répercutée sur la position",
    Math.abs(Number(p2?.marketValueEur) - 11500) < 1,
    String(p2?.marketValueEur)
  );
  check(
    "prix de revient inchangé par la réévaluation",
    Math.abs(Number(p2?.costBasisEur) - Number(pos?.costBasisEur)) < 1,
    `${pos?.costBasisEur} → ${p2?.costBasisEur}`
  );
} else {
  check("champ de valorisation trouvé", false);
}

console.log("\n━━ Nettoyage ━━");
if (s) {
  await page.evaluate(async (assetId) => {
    await fetch(`/api/life-insurance/supports?assetId=${assetId}`, {
      method: "DELETE",
    });
  }, s.assetId);
}
if (mine) {
  await page.evaluate(async (id) => {
    await fetch(`/api/life-insurance?id=${id}`, { method: "DELETE" });
  }, mine.id);
}
const leftover = await page.evaluate(async () => {
  const r = await fetch("/api/life-insurance/supports");
  return (await r.json()).supports ?? [];
});
check(
  "support supprimé",
  !leftover.some((x) => x.name === STRUCTURED)
);

const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
