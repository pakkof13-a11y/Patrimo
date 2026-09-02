import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Taux historique : aucun taux inventé.
 *
 * `fxRateToEurOnDate` rendait `fxRateToEur(cur)` — le taux **du jour** — dès
 * que le fournisseur d'archives ne répondait pas. Depuis le cache dégradé, ce
 * taux du jour peut lui-même être la table statique. Un dividende de 2021 en
 * dollars pouvait donc être converti à 1,08 et le résultat écrit dans
 * `Transaction.fxRateToEur`, où plus rien ne le distinguait d'un taux constaté.
 *
 * Ces tests séparent deux questions que le code confondait :
 *
 *   fxRateToEur()       → quel est le taux aujourd'hui ?
 *   fxRateToEurOnDate() → quel était le taux à cette date-là ?
 *
 * Le repli de la première n'a pas à répondre à la seconde. Le fournisseur est
 * entièrement simulé : aucun de ces tests ne touche le réseau.
 */

/** Réponse Frankfurter, telle que la lisent les deux fonctions. */
function reponse(usd: number) {
  return new Response(JSON.stringify({ rates: { USD: usd } }), { status: 200 });
}

/** Module réimporté à neuf : le cache des taux courants vit en module. */
async function moduleNeuf() {
  vi.resetModules();
  return import("@/app/lib/market/fx");
}

/** Distingue l'appel d'archive de l'appel courant par leur URL. */
const estArchive = (url: unknown) =>
  typeof url === "string" && /frankfurter\.app\/\d{4}-\d{2}-\d{2}/.test(url);
const estCourant = (url: unknown) =>
  typeof url === "string" && url.includes("/latest");

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fournisseur d'archives disponible", () => {
  it("rend le taux de la date demandée", async () => {
    // 1 EUR = 1,21 USD au 15/06/2021 → 1 USD vaut 1/1,21 EUR.
    fetchMock.mockImplementation(async (url: unknown) =>
      estArchive(url) ? reponse(1.21) : reponse(1.05)
    );
    const { fxRateToEurOnDate } = await moduleNeuf();

    const taux = await fxRateToEurOnDate("USD", "2021-06-15");
    expect(Number(taux)).toBeCloseTo(1 / 1.21, 9);
  });

  it("interroge bien la date demandée, pas la dernière cotation", async () => {
    fetchMock.mockResolvedValue(reponse(1.21));
    const { fxRateToEurOnDate } = await moduleNeuf();

    await fxRateToEurOnDate("USD", "2021-06-15");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/2021-06-15");
  });

  it("l'euro ne passe par aucun fournisseur", async () => {
    const { fxRateToEurOnDate } = await moduleNeuf();
    expect(await fxRateToEurOnDate("EUR", "2021-06-15")).toBe("1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("le taux courant ne remplace jamais un taux d'archive", () => {
  /*
    Le cœur du défaut. Dans chacun de ces cas, un taux courant est parfaitement
    disponible — c'est précisément celui qui était servi à sa place.
  */
  it("fournisseur d'archives injoignable : rien, alors que le taux du jour répond", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) throw new Error("FX HTTP 503");
      return reponse(1.05);
    });
    const { fxRateToEurOnDate, fxRateToEur } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "2021-06-15")).toBeNull();
    // Le taux courant, lui, reste disponible : c'est bien un refus, pas une panne.
    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.05, 9);
  });

  it("archives injoignables ET taux courant en repli statique : toujours rien", async () => {
    fetchMock.mockRejectedValue(new Error("réseau coupé"));
    const { fxRateToEurOnDate, fxRateToEur } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "2021-06-15")).toBeNull();
    /*
      La table déclarée (1,08 USD) reste le repli légitime du taux courant —
      comportement de B1, inchangé. Ce qu'on vérifie, c'est qu'elle ne franchit
      pas la frontière vers l'historique.
    */
    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.08, 9);
  });

  it("date hors série : rien, pas le dernier taux connu", async () => {
    // Frankfurter répond 200 mais sans la devise demandée.
    fetchMock.mockImplementation(async (url: unknown) =>
      estArchive(url)
        ? new Response(JSON.stringify({ rates: {} }), { status: 200 })
        : reponse(1.05)
    );
    const { fxRateToEurOnDate } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "1990-01-02")).toBeNull();
  });

  it("réponse en erreur : rien", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estArchive(url) ? new Response("nope", { status: 404 }) : reponse(1.05)
    );
    const { fxRateToEurOnDate } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "2021-06-15")).toBeNull();
  });

  it("délai dépassé : rien", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      if (estArchive(url)) {
        const e = new Error("The operation was aborted due to timeout");
        e.name = "TimeoutError";
        throw e;
      }
      return reponse(1.05);
    });
    const { fxRateToEurOnDate } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "2021-06-15")).toBeNull();
  });

  it("un taux nul ou négatif rendu par le fournisseur n'est pas retenu", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estArchive(url) ? reponse(0) : reponse(1.05)
    );
    const { fxRateToEurOnDate } = await moduleNeuf();

    expect(await fxRateToEurOnDate("USD", "2021-06-15")).toBeNull();
  });
});

describe("non-régression du taux courant (B1)", () => {
  it("sert le taux du fournisseur puis son cache", async () => {
    fetchMock.mockImplementation(async (url: unknown) =>
      estCourant(url) ? reponse(1.05) : reponse(1.21)
    );
    const { fxRateToEur } = await moduleNeuf();

    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.05, 9);
    await fxRateToEur("USD");
    // Une seule sortie réseau : le cache d'une heure fonctionne toujours.
    expect(fetchMock.mock.calls.filter((c) => estCourant(c[0])).length).toBe(1);
  });

  it("retombe sur la table déclarée quand le fournisseur est absent", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 403"));
    const { fxRateToEur, toEurAmount } = await moduleNeuf();

    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.08, 9);
    // Les conversions courantes restent servies, comme avant ce chantier.
    expect(Number(await toEurAmount("108", "USD"))).toBeCloseTo(100, 6);
  });

  it("les conversions normales sont inchangées quand tout répond", async () => {
    fetchMock.mockImplementation(async () => reponse(1.25));
    const { toEurAmount, fromEurAmount } = await moduleNeuf();

    expect(Number(await toEurAmount("125", "USD"))).toBeCloseTo(100, 9);
    expect(Number(await fromEurAmount("100", "USD"))).toBeCloseTo(125, 9);
  });
});
