import { expect, type Page } from "@playwright/test";

/** Parse French currency text like "1 234,56 €" */
export function parseFrenchMoney(text: string): number {
  const match = text.replace(/\u00a0/g, " ").match(/-?[\d\s]+,\d{2}/);
  if (!match) {
    const alt = text.match(/-?[\d.,]+/);
    if (!alt) return NaN;
    return Number(alt[0].replace(/\s/g, "").replace(",", "."));
  }
  return Number(match[0].replace(/\s/g, "").replace(",", "."));
}

const E2E_USER = process.env.E2E_USER || "demo";
const E2E_PASS = process.env.E2E_PASS || "demo1234";

/** Connexion UI (credentials NextAuth). */
export async function loginAs(
  page: Page,
  username = E2E_USER,
  password = E2E_PASS
) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("login-form")).toHaveAttribute(
    "data-hydrated",
    "true",
    { timeout: 30_000 }
  );
  await expect(page.getByTestId("login-submit")).toBeEnabled();
  await page.getByTestId("login-username").fill(username);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * Connexion pour APIRequestContext (cookies de session NextAuth).
 */
export async function loginRequest(
  request: {
    get: (url: string) => Promise<{
      ok: () => boolean;
      json: () => Promise<unknown>;
      text: () => Promise<string>;
    }>;
    post: (
      url: string,
      opts: { form?: Record<string, string>; multiparts?: unknown }
    ) => Promise<{
      ok: () => boolean;
      status: () => number;
      text: () => Promise<string>;
      headers: () => Record<string, string>;
    }>;
  },
  username = E2E_USER,
  password = E2E_PASS
) {
  const csrfRes = await request.get("/api/auth/csrf");
  const csrfBody = (await csrfRes.json()) as { csrfToken?: string };
  const csrfToken = csrfBody.csrfToken;
  if (!csrfToken) throw new Error("loginRequest: pas de csrfToken");

  const res = await request.post("/api/auth/callback/credentials", {
    form: {
      csrfToken,
      username,
      password,
      callbackUrl: "/positions",
      json: "true",
    },
  });
  if (res.status() >= 400) {
    throw new Error(
      `loginRequest failed ${res.status()}: ${(await res.text()).slice(0, 200)}`
    );
  }
}

/** Open app (positions) and wait for holdings shell */
export async function gotoDashboard(page: Page) {
  await page.goto("/positions", { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    await loginAs(page);
    await page.goto("/positions", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByTestId("holdings-table")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByTestId("kpi-cash")).toBeVisible();
}

/** Select a platform in PlatformCombobox by typing + clicking option */
export async function selectPlatformCombobox(
  page: Page,
  testId: string,
  labelIncludes: string
) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill("");
  await input.fill(labelIncludes);
  const option = page
    .getByRole("option", { name: new RegExp(labelIncludes, "i") })
    .first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
}

/** Select asset via autocomplete (waits for suggestions, prefers local holding) */
export async function selectAsset(page: Page, query: string, nameMatch?: RegExp) {
  const assetInput = page.getByTestId("tx-asset");
  await assetInput.click();
  await assetInput.fill("");
  await assetInput.fill(query);

  const local = page
    .getByRole("option")
    .filter({ hasText: /en portefeuille/i })
    .first();
  if (await local.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await local.click();
    return;
  }

  const opt = nameMatch
    ? page.getByRole("option", { name: nameMatch }).first()
    : page.getByRole("option").first();
  await expect(opt).toBeVisible({ timeout: 10_000 });
  await opt.click();
}

/** Enveloppes via sélecteur (plus de pastilles header) */
const ENVELOPE_SELECT_VALUES: Record<string, string> = {
  "Compte-Titres": "CTO",
  PEA: "PEA",
  Cryptomonnaies: "CRYPTO",
  "Assurance-Vie": "AV",
  Immobilier: "IMMOBILIER",
  CFD: "CFD",
  "Toutes les enveloppes": "",
};

const ENVELOPE_URL: Record<string, string> = {
  CTO: "/positions?envelope=cto",
  PEA: "/positions?envelope=pea",
  CRYPTO: "/positions?envelope=crypto",
  AV: "/positions?envelope=av",
  IMMOBILIER: "/positions?envelope=immobilier",
  CFD: "/positions?envelope=cfd",
  "": "/positions",
};

/** Chemins URL pour les onglets (secours si le clic nav ne navigue pas). */
const NAV_PATH: Record<string, string> = {
  "Tableau de bord": "/dashboard",
  Positions: "/positions",
  Transactions: "/transactions",
  Fiscalité: "/fiscalite",
  Plateformes: "/plateformes",
  Passifs: "/passifs",
  Banques: "/banques",
  "Épargne Salariale": "/epargne-salariale",
  "Épargne salariale": "/epargne-salariale",
  "Actifs Alternatifs": "/alternatifs",
  "Actifs alternatifs": "/alternatifs",
};

/**
 * Navigation principale — clique le testid si possible, sinon `page.goto`.
 * Garantit que l’URL attendue est atteinte (évite flakiness soft-nav).
 */
export async function clickNav(page: Page, label: string) {
  const map: Record<string, string> = {
    "Tableau de bord": "nav-dashboard",
    Positions: "nav-holdings",
    Transactions: "nav-transactions",
    Fiscalité: "nav-fiscal",
    Plateformes: "nav-platforms",
    Passifs: "nav-liabilities",
    Banques: "nav-banques",
    "Épargne Salariale": "nav-epargne-salariale",
    "Épargne salariale": "nav-epargne-salariale",
    "Actifs Alternatifs": "nav-alternatifs",
    "Actifs alternatifs": "nav-alternatifs",
  };

  // ── Enveloppe (sélecteur Positions) ──────────────────────────────────────
  if (label in ENVELOPE_SELECT_VALUES) {
    const val = ENVELOPE_SELECT_VALUES[label]!;
    const target = ENVELOPE_URL[val] ?? "/positions";

    // S’assurer d’être sur Positions
    if (!page.url().includes("/positions")) {
      await page.goto("/positions", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("holdings-table")).toBeVisible({
        timeout: 20_000,
      });
    }

    const sel = page.getByTestId("envelope-select");
    if (await sel.isVisible().catch(() => false)) {
      await sel.selectOption(val);
      try {
        if (val) {
          await expect(page).toHaveURL(new RegExp(`envelope=${val}`, "i"), {
            timeout: 5_000,
          });
        } else {
          await expect(page).toHaveURL(/\/positions\/?(\?.*)?$/, {
            timeout: 5_000,
          });
        }
        return;
      } catch {
        /* soft-nav n’a pas mis à jour l’URL → fallback */
      }
    }
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("holdings-table")).toBeVisible({
      timeout: 15_000,
    });
    return;
  }

  const tid = map[label];
  const fallbackPath = NAV_PATH[label];

  const groupForTid: Record<string, string> = {
    "nav-platforms": "sources",
    "nav-banques": "sources",
    "nav-epargne-salariale": "extended",
    "nav-alternatifs": "extended",
    "nav-liabilities": "extended",
    "nav-fiscal": "tax",
  };

  async function ensureUrl() {
    if (!fallbackPath) return;
    try {
      await expect(page).toHaveURL(
        new RegExp(fallbackPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        { timeout: 4_000 }
      );
    } catch {
      await page.goto(fallbackPath, { waitUntil: "domcontentloaded" });
    }
  }

  if (tid) {
    const item = page.getByTestId(tid);
    if (await item.isVisible().catch(() => false)) {
      await item.click();
      await ensureUrl();
      return;
    }

    const preferred = groupForTid[tid];
    if (preferred) {
      const gb = page.getByTestId(`nav-group-${preferred}`);
      if (await gb.isVisible().catch(() => false)) {
        await gb.click();
        try {
          await expect(item).toBeVisible({ timeout: 3_000 });
          await item.click();
          await ensureUrl();
          return;
        } catch {
          await page.keyboard.press("Escape").catch(() => undefined);
        }
      }
    }

    // Fallback URL (menu portal non visible, viewport, etc.)
    if (fallbackPath) {
      await page.goto(fallbackPath, { waitUntil: "domcontentloaded" });
      return;
    }

    await item.click({ timeout: 10_000 });
    return;
  }

  if (fallbackPath) {
    await page.goto(fallbackPath, { waitUntil: "domcontentloaded" });
    return;
  }

  await page.getByRole("button", { name: label, exact: true }).click();
}

export async function expectKpiVisible(page: Page) {
  await expect(page.getByTestId("kpi-cash")).toBeVisible();
  await expect(page.getByTestId("kpi-realized")).toBeVisible();
}

export async function waitForHoldingsReady(page: Page) {
  await expect(page.getByTestId("holdings-table")).toBeVisible({
    timeout: 45_000,
  });
}

/**
 * Ouvre la modale Import CSV.
 * Deep-link `?import=1` = chemin fiable e2e (évite hit-test header sous charge).
 */
export async function openImportCsvModal(page: Page) {
  // 1) Deep-link (source de vérité e2e)
  const url = new URL(page.url());
  if (url.searchParams.get("import") !== "1") {
    url.searchParams.set("import", "1");
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/positions";
    }
    await page.goto(url.pathname + url.search, { waitUntil: "domcontentloaded" });
  }

  // 2) Secours clic header
  const byTestId = page.getByTestId("import-csv-modal");
  if (!(await byTestId.isVisible().catch(() => false))) {
    const btn = page.getByTestId("open-import-csv");
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ force: true });
    }
  }

  // Un seul locator (éviter .or() + strict mode quand titre + body matchent)
  await expect(page.getByTestId("import-csv-modal")).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Ouvre le panneau Préférences via clic (state local).
 * Retry avec second clic après court délai si le 1er est perdu.
 */
export async function openPreferences(page: Page) {
  const dialog = page.getByTestId("preferences-dialog");
  const btn = page.getByTestId("preferences-panel");
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.scrollIntoViewIfNeeded();

  for (let i = 0; i < 3; i++) {
    // Lire l’état via aria-expanded
    const expanded = await btn.getAttribute("aria-expanded");
    if (expanded === "true" && (await dialog.isVisible().catch(() => false))) {
      return;
    }
    await btn.click({ force: true });
    try {
      await expect(dialog).toBeVisible({ timeout: 2_000 });
      return;
    } catch {
      /* retry */
    }
  }
  await expect(dialog).toBeVisible({ timeout: 5_000 });
}

/** Crée une plateforme via API si absente (seed e2e peut n’avoir que des plateformes seed). */
export async function ensurePlatform(
  request: {
    get: (url: string) => Promise<{
      json: () => Promise<unknown>;
      ok: () => boolean;
      status?: () => number;
      text?: () => Promise<string>;
    }>;
    post: (
      url: string,
      opts: { data: Record<string, unknown> }
    ) => Promise<{
      json: () => Promise<unknown>;
      ok: () => boolean;
      status?: () => number;
      text: () => Promise<string>;
    }>;
  },
  opts?: { name?: string; type?: string; logoKey?: string }
): Promise<string> {
  const name = opts?.name || "BoursoBank";
  const type = opts?.type || "COURTIER";
  const logoKey = opts?.logoKey || "BOURSOBANK";

  const listRes = await request.get("/api/platforms");
  const list = (await listRes.json()) as {
    platforms?: Array<{ id: string; name: string }>;
  };
  const existing = list.platforms?.find((p) =>
    new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(p.name)
  );
  if (existing?.id) return existing.id;

  const createRes = await request.post("/api/platforms", {
    data: { name, type, logoKey },
  });
  if (!createRes.ok()) {
    throw new Error(`ensurePlatform failed: ${await createRes.text()}`);
  }
  const body = (await createRes.json()) as { platform?: { id: string } };
  if (!body.platform?.id) throw new Error("ensurePlatform: no id returned");
  return body.platform.id;
}
