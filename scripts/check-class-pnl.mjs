/**
 * Vérification visuelle de la vue « Décomposée / Périodique » par classe d'actif.
 * Usage : node scripts/check-class-pnl.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const EMAIL = process.env.CHECK_EMAIL ?? "demo";
const PASSWORD = process.env.DEMO_PASSWORD ?? "ci-only-demo-password";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('input[name="username"]', { timeout: 20000 });
await page.fill('input[name="username"]', EMAIL);
await page.fill('input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30000 });
await page.waitForTimeout(4000);

// Vue décomposée + périodique
const clicked = [];
for (const id of [
  "evolution-advanced-toggle",
  "evolution-view-decomposed",
  "evolution-metric-period",
]) {
  const el = page.locator(`[data-testid="${id}"]`);
  if (await el.count()) {
    await el.first().click();
    clicked.push(id);
    await page.waitForTimeout(600);
  }
}
console.log("contrôles cliqués:", clicked.join(", ") || "(aucun)");

// Attendre la réponse de l'API
const resp = await page
  .waitForResponse((r) => r.url().includes("/api/portfolio/class-pnl"), {
    timeout: 15000,
  })
  .catch(() => null);
if (resp) {
  const body = await resp.json().catch(() => null);
  console.log("API class-pnl:", resp.status());
  if (body) {
    console.log("  classes:", (body.classes ?? []).join(", "));
    console.log("  points:", body.points?.length, "estimé:", body.estimated);
    const last = body.points?.[body.points.length - 1];
    if (last) console.log("  dernier jour:", last.day, JSON.stringify(last.pnlByClass));
  }
} else {
  console.log("API class-pnl: aucune réponse captée");
}
await page.waitForTimeout(2500);

// Légende du graphique = noms de classes ?
const legend = await page
  .locator(".recharts-legend-item-text")
  .allTextContents();
console.log("légende:", legend.join(" | "));

const note = await page
  .locator('[data-testid="evolution-decomposed-note"]')
  .textContent()
  .catch(() => null);
console.log("note:", note);

// Géométrie des barres : combien de segments, débordent-ils sur le jour voisin ?
const bars = await page.evaluate(() => {
  const rects = [...document.querySelectorAll(".recharts-bar-rectangle path")];
  const xs = rects.map((r) => {
    const b = r.getBoundingClientRect();
    return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) };
  });
  const widths = [...new Set(xs.map((r) => r.w))];
  const cols = [...new Set(xs.map((r) => r.x))].sort((a, b) => a - b);
  const gaps = cols.slice(1).map((c, i) => c - cols[i]);
  return {
    segments: xs.length,
    widths,
    columns: cols.length,
    minGap: gaps.length ? Math.min(...gaps) : null,
    maxWidth: widths.length ? Math.max(...widths) : null,
  };
});
console.log("barres:", JSON.stringify(bars));
console.log(
  "débordement:",
  bars.maxWidth != null && bars.minGap != null
    ? bars.maxWidth <= bars.minGap
      ? "non (largeur <= écart entre jours)"
      : `OUI (${bars.maxWidth}px > ${bars.minGap}px)`
    : "n/a"
);

await page
  .locator('[data-testid="evolution-decomposed-note"]')
  .scrollIntoViewIfNeeded()
  .catch(() => {});
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/class-pnl.png" });
console.log("capture: /tmp/class-pnl.png");

// Plage longue : les jours doivent se reventiler en semaines
const range1m = page.locator('[data-testid="evolution-range-1m"]');
if (await range1m.count()) {
  await range1m.first().click();
  await page.waitForTimeout(3000);
  const wk = await page.evaluate(() => {
    const ticks = [...document.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")].map(t => t.textContent);
    const rects = [...document.querySelectorAll(".recharts-bar-rectangle path")];
    const cols = [...new Set(rects.map(r => Math.round(r.getBoundingClientRect().x)))];
    return { ticks, segments: rects.length, columns: cols.length };
  });
  console.log("1M ticks:", wk.ticks.join(" / "));
  console.log("1M barres:", wk.segments, "segments sur", wk.columns, "colonnes");
  console.log("1M note:", await page.locator('[data-testid="evolution-decomposed-note"]').textContent().catch(()=>null));
  await page.screenshot({ path: "/tmp/class-pnl-1m.png" });
}
await browser.close();
