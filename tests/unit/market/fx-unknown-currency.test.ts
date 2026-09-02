import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Une devise qu'aucune source ne fonde ne vaut pas un euro par unité.
 *
 * Le dernier maillon de la résolution était `rates[cur] ?? FALLBACK[cur] ?? 1`.
 * Pour une devise absente à la fois des taux servis et de la table déclarée —
 * couronne suédoise, zloty, livre turque —, il affirmait une parité avec
 * l'euro.
 *
 * Mesuré avant correction, fournisseur indisponible :
 *
 *   fxRateToEur("SEK")              → 1,0000000000
 *   toEurAmount("1000", "SEK")      → 1 000 €      (onze fois leur valeur)
 *   convertToEurSync("1000","SEK")  → 1 000 €
 *
 * Ce montant pouvait ensuite être persisté : transaction, prix manuel,
 * cotation.
 *
 * Ce que ce chantier ne touche pas : les cinq entrées de la table déclarée
 * restent des replis légitimes et assumés, et l'euro vaut toujours 1. Seul le
 * sixième cas — celui qu'aucune source ne fonde — cesse d'être un chiffre.
 */

function reponse(rates: Record<string, number>) {
  return new Response(JSON.stringify({ rates }), { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function moduleNeuf() {
  vi.resetModules();
  return import("@/app/lib/market/fx");
}

describe("devises fondées", () => {
  it("l'euro vaut un, sans interroger personne", async () => {
    fetchMock.mockRejectedValue(new Error("aucun appel attendu"));
    const { fxRateToEur, toEurAmount } = await moduleNeuf();
    expect(await fxRateToEur("EUR")).toBe("1");
    expect(Number(await toEurAmount("1000", "EUR"))).toBe(1000);
  });

  it("les cinq replis déclarés restent servis quand le fournisseur est absent", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { fxRateToEur } = await moduleNeuf();
    // 1/1,08 · 1/0,96 · 1/0,85 · 1/160 — la table du module, inchangée.
    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.08, 9);
    expect(Number(await fxRateToEur("CHF"))).toBeCloseTo(1 / 0.96, 9);
    expect(Number(await fxRateToEur("GBP"))).toBeCloseTo(1 / 0.85, 9);
    expect(Number(await fxRateToEur("JPY"))).toBeCloseTo(1 / 160, 9);
  });

  it("un taux réel est utilisé pour une devise hors table", async () => {
    // Frankfurter en rend une trentaine : le chemin nominal couvre SEK.
    fetchMock.mockResolvedValue(reponse({ SEK: 11.5, USD: 1.1 }));
    const { fxRateToEur, toEurAmount } = await moduleNeuf();
    expect(Number(await fxRateToEur("SEK"))).toBeCloseTo(1 / 11.5, 9);
    expect(Number(await toEurAmount("1150", "SEK"))).toBeCloseTo(100, 6);
  });

  it("un taux réel récent survit à une panne, comme le veut le cache dégradé", async () => {
    fetchMock
      .mockResolvedValueOnce(reponse({ SEK: 11.5 }))
      .mockRejectedValue(new Error("FX HTTP 503"));
    const { fxRateToEur } = await moduleNeuf();

    await fxRateToEur("SEK"); // amorce le cache
    // Le cache reste frais : aucune nouvelle collecte, taux réel conservé.
    expect(Number(await fxRateToEur("SEK"))).toBeCloseTo(1 / 11.5, 9);
  });
});

describe("devises qu'aucune source ne fonde", () => {
  const NON_FONDEES = ["SEK", "NOK", "PLN", "TRY"];

  it("le taux est refusé, jamais rendu à 1", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { fxRateToEur, FxRateUnknownError } = await moduleNeuf();

    for (const devise of NON_FONDEES) {
      await expect(fxRateToEur(devise)).rejects.toBeInstanceOf(FxRateUnknownError);
    }
  });

  it("la conversion est refusée, jamais rendue à parité", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { toEurAmount, fromEurAmount } = await moduleNeuf();

    await expect(toEurAmount("1000", "SEK")).rejects.toThrow(/SEK/);
    await expect(fromEurAmount("1000", "SEK")).rejects.toThrow(/SEK/);
  });

  it("le convertisseur synchrone refuse aussi", async () => {
    const { convertToEurSync, convertFromEurSync } = await moduleNeuf();
    // Table de taux ne contenant pas la devise : le cas exact du repli.
    expect(() => convertToEurSync("1000", "SEK", { EUR: 1 })).toThrow(/SEK/);
    expect(() => convertFromEurSync("1000", "SEK", { EUR: 1 })).toThrow(/SEK/);
  });

  it("l'erreur nomme la devise et dit ce qui manque", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { fxRateToEur } = await moduleNeuf();
    await expect(fxRateToEur("SEK")).rejects.toThrow(
      /SEK.*indisponible.*fonder/
    );
  });

  it("un taux nul ou négatif rendu par le fournisseur n'est pas retenu", async () => {
    fetchMock.mockResolvedValue(reponse({ SEK: 0 }));
    const { fxRateToEur } = await moduleNeuf();
    await expect(fxRateToEur("SEK")).rejects.toThrow(/SEK/);
  });
});

describe("aucun un implicite ne subsiste", () => {
  it("le seul 1 possible est celui de l'euro", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { fxRateToEur } = await moduleNeuf();

    /*
      Contrôle de la doctrine, et non d'une ligne : parmi les devises servies,
      aucune ne rend exactement 1 hormis l'euro. Un `?? 1` réintroduit ailleurs
      ferait échouer ce test.
    */
    expect(await fxRateToEur("EUR")).toBe("1");
    for (const devise of ["USD", "CHF", "GBP", "JPY"]) {
      expect(Number(await fxRateToEur(devise))).not.toBe(1);
    }
    for (const devise of ["SEK", "NOK", "PLN"]) {
      await expect(fxRateToEur(devise)).rejects.toThrow();
    }
  });
});
