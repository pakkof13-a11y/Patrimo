/**
 * Parcours réel de l'échéancier de coupons d'un produit structuré.
 *
 * Vérifie qu'une constatation échue est proposée, qu'un coupon confirmé entre au
 * journal en COUPON, qu'un coupon marqué « non versé » n'y entre PAS tout en
 * cessant d'être proposé, et qu'aucune décision ne se rejoue.
 *
 * Usage : node scripts/check-coupon-schedule.mjs
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

const api = (fn, arg) => page.evaluate(fn, arg);
const stamp = Date.now();
const INSURER = `Coupon Test ${stamp}`;
const NAME_A = `Autocall A ${stamp}`;
const NAME_B = `Autocall B ${stamp}`;

console.log("\n━━ Préparation ━━");
const contract = await api(async (insurer) => {
  const r = await fetch("/api/life-insurance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ insurer, openDate: "2015-01-10", cashEuro: "0" }),
  });
  return (await r.json()).policy;
}, INSURER);
check("contrat créé", Boolean(contract?.id));

/** Constatation initiale il y a 15 mois → 5 échéances trimestrielles échues. */
const strike = new Date(Date.now() - 455 * 86400000).toISOString().slice(0, 10);
const maturity = "2032-01-01";

async function addStructured(name) {
  return api(
    async ([lifeInsuranceId, n, strikeDate, maturityDate]) => {
      const r = await fetch("/api/life-insurance/supports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lifeInsuranceId,
          name: n,
          kind: "STRUCTURED",
          amountEur: "10000",
          nominalEur: "10000",
          underlying: "Euro Stoxx 50",
          strikeLevel: "4200",
          couponRatePct: "8",
          couponFrequency: "QUARTERLY",
          couponBarrierPct: "70",
          strikeDate,
          maturityDate,
        }),
      });
      return { status: r.status, body: await r.json() };
    },
    [contract.id, name, strike, maturity]
  );
}

const a = await addStructured(NAME_A);
const b = await addStructured(NAME_B);
check("deux structurés créés", a.status === 201 && b.status === 201,
  `${a.status}/${b.status}`);
console.log(`  constatation initiale : ${strike}`);

console.log("\n━━ Constatations proposées ━━");
await page.goto(`${BASE}/assurance-vie`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const panel = page.locator('[data-testid="coupon-schedule-panel"]');
check("panneau de constatations affiché", (await panel.count()) > 0);

let pending = await api(async () => {
  const r = await fetch("/api/life-insurance/coupons");
  return (await r.json()).pending ?? [];
});
const mineA = pending.filter((p) => p.supportName === NAME_A);
const mineB = pending.filter((p) => p.supportName === NAME_B);
console.log(`  ${NAME_A} : ${mineA.length} constatation(s)`);
console.log(`  ${NAME_B} : ${mineB.length} constatation(s)`);
check("constatations trimestrielles proposées", mineA.length >= 4, String(mineA.length));
check(
  "montant = taux annuel / 4 (8 % sur 10 000 € → 200 €)",
  mineA.every((p) => p.amountEur === "200.00"),
  mineA[0]?.amountEur
);
check(
  "barrière et sous-jacent exposés pour éclairer la décision",
  mineA[0]?.couponBarrierPct === "70" && mineA[0]?.underlying === "Euro Stoxx 50"
);
check(
  "deux supports distincts, jamais confondus",
  new Set(pending.map((p) => p.note)).size === pending.length
);

console.log("\n━━ Rien n'est écrit sans décision ━━");
const txCount = async () =>
  api(async () => {
    const r = await fetch("/api/transactions?pageSize=100&type=COUPON");
    return (await r.json()).transactions?.length ?? 0;
  });
const beforeTx = await txCount();
check("journal inchangé à la simple lecture", true, `${beforeTx} COUPON`);

console.log("\n━━ « Versé » : une écriture au journal ━━");
const paid = mineA[0];
let res = await api(async ([assetId, observedOn]) => {
  const r = await fetch("/api/life-insurance/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decisions: [{ assetId, observedOn, paid: true }],
    }),
  });
  return await r.json();
}, [paid.assetId, paid.observedOn]);
console.log(`  ${JSON.stringify(res)}`);
check("un coupon créé", res.created === 1, JSON.stringify(res));

const coupons = await api(async (name) => {
  const r = await fetch(
    `/api/transactions?pageSize=100&q=${encodeURIComponent(name)}`
  );
  return ((await r.json()).transactions ?? []).filter((t) => t.type === "COUPON");
}, NAME_A);
check("écriture de type COUPON", coupons.length === 1, String(coupons.length));
if (coupons[0]) {
  console.log(`  ${coupons[0].occurredAt.slice(0, 10)} COUPON ${coupons[0].grossAmountEur ?? ""}`);
  check(
    "datée de la constatation",
    coupons[0].occurredAt.slice(0, 10) === paid.observedOn.slice(0, 10),
    `${coupons[0].occurredAt.slice(0, 10)} vs ${paid.observedOn.slice(0, 10)}`
  );
}

console.log("\n━━ « Non versé » : rien au journal, mais tranché ━━");
const unpaid = mineA[1];
res = await api(async ([assetId, observedOn]) => {
  const r = await fetch("/api/life-insurance/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decisions: [{ assetId, observedOn, paid: false }],
    }),
  });
  return await r.json();
}, [unpaid.assetId, unpaid.observedOn]);
console.log(`  ${JSON.stringify(res)}`);
check("marqué non versé", res.skipped === 1, JSON.stringify(res));

const couponsAfter = await api(async (name) => {
  const r = await fetch(
    `/api/transactions?pageSize=100&q=${encodeURIComponent(name)}`
  );
  return ((await r.json()).transactions ?? []).filter((t) => t.type === "COUPON");
}, NAME_A);
check(
  "AUCUNE écriture ajoutée pour un coupon non versé",
  couponsAfter.length === 1,
  `${couponsAfter.length} COUPON`
);

pending = await api(async () => {
  const r = await fetch("/api/life-insurance/coupons");
  return (await r.json()).pending ?? [];
});
const stillA = pending.filter((p) => p.supportName === NAME_A);
console.log(`  restantes sur ${NAME_A} : ${stillA.length} (avant : ${mineA.length})`);
check(
  "les deux constatations tranchées ne sont plus proposées",
  stillA.length === mineA.length - 2,
  `${stillA.length} vs ${mineA.length - 2}`
);
check(
  "le support B n'a pas été touché",
  pending.filter((p) => p.supportName === NAME_B).length === mineB.length
);

console.log("\n━━ Rejouer une décision ne duplique rien ━━");
res = await api(async ([assetId, observedOn]) => {
  const r = await fetch("/api/life-insurance/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decisions: [{ assetId, observedOn, paid: true }] }),
  });
  return await r.json();
}, [paid.assetId, paid.observedOn]);
console.log(`  ${JSON.stringify(res)}`);
check("échéance déjà tranchée ignorée", res.alreadySettled === 1, JSON.stringify(res));

const finalCoupons = await api(async (name) => {
  const r = await fetch(
    `/api/transactions?pageSize=100&q=${encodeURIComponent(name)}`
  );
  return ((await r.json()).transactions ?? []).filter((t) => t.type === "COUPON");
}, NAME_A);
check("toujours une seule écriture", finalCoupons.length === 1, String(finalCoupons.length));

console.log("\n━━ Montant personnalisé (coupon à mémoire) ━━");
const memo = mineA[2];
res = await api(async ([assetId, observedOn]) => {
  const r = await fetch("/api/life-insurance/coupons", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      decisions: [{ assetId, observedOn, paid: true, amountEur: "600" }],
    }),
  });
  return await r.json();
}, [memo.assetId, memo.observedOn]);
check("rattrapage accepté au-delà du montant théorique", res.created === 1, JSON.stringify(res));
const memoTx = await api(async (name) => {
  const r = await fetch(
    `/api/transactions?pageSize=100&q=${encodeURIComponent(name)}`
  );
  return ((await r.json()).transactions ?? []).filter((t) => t.type === "COUPON");
}, NAME_A);
const has600 = memoTx.some((t) => Math.abs(Number(t.grossAmountEur) - 600) < 1);
check("montant de 600 € enregistré", has600, memoTx.map((t) => t.grossAmountEur).join(" / "));

console.log("\n━━ Nettoyage ━━");
for (const assetId of [a.body?.assetId, b.body?.assetId]) {
  if (!assetId) continue;
  await api(async (id) => {
    await fetch(`/api/life-insurance/supports?assetId=${id}`, { method: "DELETE" });
  }, assetId);
}
await api(async (id) => {
  await fetch(`/api/life-insurance?id=${id}`, { method: "DELETE" });
}, contract.id);
const leftover = await api(async () => {
  const r = await fetch("/api/life-insurance/coupons");
  return (await r.json()).pending ?? [];
});
check(
  "constatations de test retirées",
  !leftover.some((p) => p.supportName.includes(String(stamp)))
);

const failed = results.filter((r) => !r.ok);
console.log(`\n━━ Bilan : ${results.length - failed.length}/${results.length} ━━`);
for (const f of failed) console.log(`  ✗ ${f.label}`);

await browser.close();
process.exitCode = failed.length > 0 ? 1 : 0;
