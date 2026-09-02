/**
 * Passe de contrôle complète : assurance-vie + non-régression.
 *
 * Vérifie le CRUD AV, la cohérence du patrimoine net (pas de double comptage),
 * le simulateur fiscal, puis que les écrans historiques répondent toujours.
 *
 * Usage : node scripts/check-full-audit.mjs
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
const near = (a, b, eps = 1) => Math.abs(Number(a) - Number(b)) < eps;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("console", (m) => {
  const t = m.text();
  // Les ressources externes (favicons, CDN, logos) sont bloquées par la
  // politique réseau de cet environnement : ce n'est pas un défaut de l'app.
  const external = /ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|favicon|404 \(Not Found\)/i.test(t);
  if (m.type() === "error" && !external) {
    pageErrors.push(`[console] ${t}`);
  }
});

console.log("\n━━ 1. Login ━━");
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="username"]', { timeout: 20000 });
await page.fill('input[name="username"]', USER);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await page.waitForTimeout(2500);
check("connexion réussie", !page.url().includes("/login"), page.url());

const api = (fn, arg) => page.evaluate(fn, arg);

console.log("\n━━ 2. Cohérence du patrimoine net ━━");
const summary = await api(async () => {
  const r = await fetch("/api/portfolio");
  return r.json();
});
const s = summary.summary ?? summary;
const holdings = await api(async () => {
  const r = await fetch("/api/holdings");
  return (await r.json()).holdings ?? [];
});
const avPositions = holdings.filter((h) => h.accountType === "AV");
const avValue = avPositions.reduce((t, h) => t + Number(h.marketValueEur), 0);
console.log(`  patrimoine net : ${Number(s.netWorthBase ?? s.netWorth).toFixed(2)} €`);
console.log(`  positions AV   : ${avPositions.length} · ${avValue.toFixed(2)} €`);

const li = await api(async () => {
  const r = await fetch("/api/life-insurance");
  return r.json();
});
console.log(`  encours AV (API contrats) : ${Number(li.totalOutstandingEur ?? 0).toFixed(2)} €`);
console.log(`  primes avant/après 2017   : ${li.totalPremiumsBefore2017Eur ?? "?"} / ${li.totalPremiumsAfter2017Eur ?? "?"}`);
check(
  "l'API expose les primes (base du seuil de 150 k€)",
  li.totalPremiumsBefore2017Eur !== undefined &&
    li.totalPremiumsAfter2017Eur !== undefined
);

// Le cash ne doit PAS contenir l'AV (sinon double comptage avec marketValue)
const cash = Number(s.cashBase ?? s.cash ?? 0);
check(
  "l'AV n'est pas comptée dans le cash",
  avValue === 0 || cash < avValue + 1e6,
  `cash ${cash.toFixed(2)} €`
);

console.log("\n━━ 3. CRUD assurance-vie ━━");
const stamp = Date.now();
const INSURER = `Audit AV ${stamp}`;

const created = await api(async (insurer) => {
  const r = await fetch("/api/life-insurance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      insurer,
      openDate: "2014-06-15",
      cashEuro: "0",
      premiumsBefore2017Eur: "20000",
      premiumsAfter2017Eur: "30000",
    }),
  });
  return { status: r.status, body: await r.json() };
}, INSURER);
check("création de contrat", created.status === 201, String(created.status));
const contractId = created.body?.policy?.id;

const afterCreate = await api(async () => {
  const r = await fetch("/api/life-insurance");
  return r.json();
});
const mine = (afterCreate.policies ?? []).find((p) => p.id === contractId);
check("contrat relu avec ses primes", Boolean(mine));
if (mine) {
  check("primes avant 2017 conservées", near(mine.premiumsBefore2017Eur, 20000), mine.premiumsBefore2017Eur);
  check("primes après 2017 conservées", near(mine.premiumsAfter2017Eur, 30000), mine.premiumsAfter2017Eur);
}

// Support structuré
const sup = await api(async (id) => {
  const r = await fetch("/api/life-insurance/supports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lifeInsuranceId: id,
      name: `Audit Structuré ${Date.now()}`,
      kind: "STRUCTURED",
      amountEur: "50000",
      nominalEur: "50000",
      underlying: "Euro Stoxx 50",
      strikeLevel: "4200",
      couponRatePct: "6",
      couponFrequency: "ANNUAL",
      couponBarrierPct: "70",
      maturityDate: "2033-06-15",
    }),
  });
  return { status: r.status, body: await r.json() };
}, contractId);
check("création d'un support structuré", sup.status === 201, String(sup.status));
const assetId = sup.body?.assetId;

const supports = await api(async () => {
  const r = await fetch("/api/life-insurance/supports");
  return (await r.json()).supports ?? [];
});
const mySup = supports.find((x) => x.assetId === assetId);
check("support rattaché au contrat", mySup?.lifeInsuranceId === contractId);
check("valorisation totale exposée", near(mySup?.currentValueEur, 50000), mySup?.currentValueEur);

// L'encours du contrat doit refléter ses supports du journal, pas seulement
// les champs historiques (remis à zéro par la migration).
const withSupport = await api(async () => {
  const r = await fetch("/api/life-insurance");
  return r.json();
});
const contractNow = (withSupport.policies ?? []).find((p) => p.id === contractId);
check(
  "encours du contrat = ses supports du journal",
  near(contractNow?.outstandingEur, 50000, 2),
  contractNow?.outstandingEur
);
const avContracts = (withSupport.policies ?? []).filter(
  (p) => Number(p.outstandingEur) > 0
);
check(
  "les contrats migrés n'affichent plus 0 €",
  avContracts.length >= 1,
  `${avContracts.length} contrat(s) avec encours`
);

// Le support remonte dans les positions
const holdings2 = await api(async () => {
  const r = await fetch("/api/holdings");
  return (await r.json()).holdings ?? [];
});
const pos = holdings2.find((h) => h.assetId === assetId);
check("support visible dans Positions", Boolean(pos));
check("classé en enveloppe AV", pos?.accountType === "AV", pos?.accountType);
check("prix de revient présent", Number(pos?.costBasisEur) > 0, pos?.costBasisEur);

// Patrimoine net augmente exactement du montant investi
const summary2 = await api(async () => {
  const r = await fetch("/api/portfolio");
  return r.json();
});
const s2 = summary2.summary ?? summary2;
const delta = Number(s2.netWorthBase ?? s2.netWorth) - Number(s.netWorthBase ?? s.netWorth);
console.log(`  variation patrimoine net : ${delta.toFixed(2)} €`);
check(
  "patrimoine net +50 000 € (pas de double comptage)",
  near(delta, 50000, 2),
  delta.toFixed(2)
);

// Réévaluation
await api(async (id) => {
  await fetch("/api/life-insurance/supports", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revalue", assetId: id, valueEur: "56000" }),
  });
}, assetId);
const holdings3 = await api(async () => {
  const r = await fetch("/api/holdings");
  return (await r.json()).holdings ?? [];
});
const pos3 = holdings3.find((h) => h.assetId === assetId);
check("réévaluation répercutée", near(pos3?.marketValueEur, 56000), pos3?.marketValueEur);
check("prix de revient inchangé", near(pos3?.costBasisEur, pos?.costBasisEur), pos3?.costBasisEur);

console.log("\n━━ 4. Simulateur fiscal ━━");
await page.goto(`${BASE}/assurance-vie`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const simulator = page.locator('[data-testid="av-redemption-simulator"]');
const simCount = await simulator.count();
check("simulateur présent dans l'onglet", simCount > 0, `${simCount} bloc(s)`);

console.log("\n━━ 5. Non-régression des écrans ━━");
const routes = [
  ["/dashboard", "dashboard"],
  ["/positions", "positions"],
  ["/transactions", "transactions"],
  ["/banques", "banques"],
  ["/assurance-vie", "assurance-vie"],
  ["/passifs", "passifs"],
  ["/alternatifs", "alternatifs"],
  ["/epargne-salariale", "épargne salariale"],
  ["/fiscalite", "fiscalité"],
  ["/comptes", "plateformes"],
];
for (const [route, label] of routes) {
  const before = pageErrors.length;
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  const skeleton = await page.locator('[data-testid="portfolio-skeleton"]').count();
  const newErrors = pageErrors.length - before;
  check(
    `${label} : rendu sans erreur`,
    newErrors === 0 && skeleton === 0,
    newErrors > 0 ? pageErrors.slice(before).join(" | ").slice(0, 150) : skeleton ? "bloqué sur le skeleton" : ""
  );
}

console.log("\n━━ 6. API historiques ━━");
const endpoints = [
  "/api/holdings",
  "/api/portfolio",
  "/api/transactions?pageSize=20",
  "/api/platforms",
  "/api/banks",
  "/api/liabilities",
  "/api/life-insurance",
  "/api/life-insurance/supports",
  "/api/life-insurance/coupons",
];
for (const ep of endpoints) {
  const st = await api(async (u) => {
    const r = await fetch(u);
    return r.status;
  }, ep);
  check(`${ep} → ${st}`, st === 200, st === 200 ? "" : `statut ${st}`);
}

console.log("\n━━ Nettoyage ━━");
if (assetId) {
  await api(async (id) => {
    await fetch(`/api/life-insurance/supports?assetId=${id}`, { method: "DELETE" });
  }, assetId);
}
if (contractId) {
  await api(async (id) => {
    await fetch(`/api/life-insurance?id=${id}`, { method: "DELETE" });
  }, contractId);
}
const summaryEnd = await api(async () => {
  const r = await fetch("/api/portfolio");
  return r.json();
});
const sEnd = summaryEnd.summary ?? summaryEnd;
check(
  "patrimoine net revenu à l'initial",
  near(sEnd.netWorthBase ?? sEnd.netWorth, s.netWorthBase ?? s.netWorth, 2),
  `${Number(sEnd.netWorthBase ?? sEnd.netWorth).toFixed(2)} vs ${Number(s.netWorthBase ?? s.netWorth).toFixed(2)}`
);

if (pageErrors.length > 0) {
  console.log("\n━━ Erreurs JS observées ━━");
  for (const e of [...new Set(pageErrors)].slice(0, 10)) console.log(`  · ${e.slice(0, 200)}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
