import { chromium } from "@playwright/test";
const OUT="/tmp/patrimo-shots";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.goto("http://127.0.0.1:3000/login",{waitUntil:"networkidle"});
await p.fill('input[name="username"], input#username',"demo");
await p.fill('input[type="password"]',"ci-only-demo-password");
await p.click('button[type="submit"]'); await p.waitForTimeout(5000);

const panel = p.locator('[data-testid="portfolio-evolution-panel"]');
// vue décomposée
await p.locator('[data-testid="evolution-advanced-toggle"]').click(); await p.waitForTimeout(700);
await p.locator('[data-testid="evolution-view-decomposed"]').click().catch(async()=>{
  const opts = await p.locator('[data-testid="evolution-advanced"] [role="tab"]').allInnerTexts();
  console.log("tabs dispo:", JSON.stringify(opts));
});
await p.waitForTimeout(2200);
await panel.screenshot({path:`${OUT}/evo-decomposed.png`});
// périodique + décomposée
await p.locator('[data-testid="evolution-metric-period"]').click(); await p.waitForTimeout(2000);
await panel.screenshot({path:`${OUT}/evo-decomposed-period.png`});
console.log("pageerrors:", errs.length);
await b.close();
