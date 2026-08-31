import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cache des taux de change en mode dégradé.
 *
 * Le repli écrivait `fetchedAt: 0`, ce qui rendait l'entrée perpétuellement
 * périmée : chaque lecture relançait un appel sortant vers un fournisseur qu'on
 * venait de voir échouer, avec 2 500 ms de budget. Mesuré sur une suite E2E de
 * 27 minutes, 1 913 tentatives — pour une donnée dont le TTL normal est d'une
 * heure.
 *
 * Il écrasait aussi les derniers taux réels par la table figée : un fournisseur
 * tombé cinq minutes après une réponse correcte faisait basculer l'application
 * sur des approximations, alors qu'elle venait de connaître les vraies valeurs.
 *
 * ## Ce que ces tests contrôlent
 *
 * Le fournisseur est entièrement simulé — aucun de ces tests ne touche le
 * réseau — et l'horloge est pilotée, parce que tout le sujet est une affaire de
 * délais. Le module portant son cache en variables de module, chaque test le
 * réimporte à neuf.
 */

/** Réponse Frankfurter, telle que la lit `getEurRates`. */
function reponseOk(usd: number) {
  return new Response(JSON.stringify({ rates: { USD: usd, GBP: 0.9 } }), {
    status: 200,
  });
}

/** Module réimporté à neuf, cache vide. */
async function moduleNeuf() {
  vi.resetModules();
  return import("@/app/lib/market/fx");
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-02T09:00:00.000Z"));
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Le repli journalise l'échec ; on ne veut pas en polluer la sortie de test.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Avance l'horloge sans exécuter de minuteur : seul `Date.now()` nous importe. */
function avancer(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

const MINUTE = 60 * 1000;
const HEURE = 60 * MINUTE;
const JOUR = 24 * HEURE;

describe("fournisseur disponible", () => {
  it("sert les taux du fournisseur", async () => {
    fetchMock.mockResolvedValue(reponseOk(1.11));
    const { getEurRates } = await moduleNeuf();

    const rates = await getEurRates();
    expect(rates.USD).toBe(1.11);
    expect(rates.EUR).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un cache frais n'entraîne aucune collecte", async () => {
    fetchMock.mockResolvedValue(reponseOk(1.11));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    avancer(59 * MINUTE); // encore dans le TTL d'une heure
    const rates = await getEurRates();

    expect(rates.USD).toBe(1.11);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un cache expiré est rafraîchi", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockResolvedValueOnce(reponseOk(1.15));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    avancer(HEURE + MINUTE);
    const rates = await getEurRates();

    expect(rates.USD).toBe(1.15);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("une nouvelle valeur remplace bien l'ancienne", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockResolvedValueOnce(reponseOk(1.25));
    const { getEurRates } = await moduleNeuf();

    expect((await getEurRates()).USD).toBe(1.11);
    avancer(HEURE + MINUTE);
    expect((await getEurRates()).USD).toBe(1.25);
    // Et la nouvelle valeur est à son tour servie sans collecte.
    avancer(MINUTE);
    expect((await getEurRates()).USD).toBe(1.25);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fournisseur indisponible", () => {
  it("réutilise les derniers taux réels plutôt que la table figée", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockRejectedValue(new Error("FX HTTP 403"));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    avancer(HEURE + MINUTE); // le cache expire
    const rates = await getEurRates(); // la collecte échoue

    /*
      1,11 et non 1,08 : la table statique n'est pas reprise tant qu'un taux
      réel récent existe. C'est le second défaut que ce chantier corrige.
    */
    expect(rates.USD).toBe(1.11);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ne retente pas à chaque lecture pendant la fenêtre de repli", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockRejectedValue(new Error("FX HTTP 403"));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    avancer(HEURE + MINUTE);
    await getEurRates(); // première tentative, échoue

    // Vingt lectures pendant la minute qui suit.
    for (let i = 0; i < 20; i++) {
      avancer(2_000);
      expect((await getEurRates()).USD).toBe(1.11);
    }

    /*
      Le comportement d'avant : une tentative par lecture, soit vingt-et-une.
      Le palier d'une minute les ramène à deux — celle du départ, et une seule
      après l'expiration de la fenêtre.
    */
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("retente après la fenêtre, et reprend les taux dès le retour", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockRejectedValueOnce(new Error("FX HTTP 403"))
      .mockResolvedValueOnce(reponseOk(1.2));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    avancer(HEURE + MINUTE);
    await getEurRates(); // échec

    avancer(30 * 1000); // encore dans la fenêtre : aucune tentative
    await getEurRates();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    avancer(31 * 1000); // fenêtre écoulée : on retente, et ça repasse
    expect((await getEurRates()).USD).toBe(1.2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sans aucun cache, retombe sur la table déclarée", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 403"));
    const { getEurRates } = await moduleNeuf();

    const rates = await getEurRates();
    expect(rates.USD).toBe(1.08);
    expect(rates.EUR).toBe(1);
  });

  it("sans cache, les lectures suivantes ne rappellent pas le fournisseur", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 403"));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    for (let i = 0; i < 10; i++) {
      avancer(2_000);
      expect((await getEurRates()).USD).toBe(1.08);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("le repli ne devient jamais permanent", () => {
  it("des taux réels de plus d'un jour cessent d'être servis", async () => {
    fetchMock
      .mockResolvedValueOnce(reponseOk(1.11))
      .mockRejectedValue(new Error("FX HTTP 403"));
    const { getEurRates } = await moduleNeuf();

    await getEurRates();
    // Panne qui dure : on dépasse la borne d'une journée.
    avancer(JOUR + HEURE);
    const rates = await getEurRates();

    /*
      Passé une journée, on ne peut plus prétendre que la valeur décrit le
      marché du jour. La table déclarée reprend la main — c'est une
      approximation assumée, pas un taux périmé présenté comme réel.
    */
    expect(rates.USD).toBe(1.08);
  });

  it("le budget de repli est bien d'une minute et d'une journée", async () => {
    /*
      Contrôle explicite des deux paliers, demandé par le chantier. On les
      éprouve par leur effet plutôt qu'en exportant des constantes : à 59
      secondes on ne retente pas, à 61 secondes on retente ; à 23 heures le taux
      réel survit, à 25 heures il cède.
    */
    /**
     * Joue une panne, puis relit après un certain âge total du cache.
     *
     * `ageTotal` se compte depuis la dernière réponse valide du fournisseur,
     * car c'est cet âge que borne `STALE_MAX_MS` — et non le temps écoulé
     * depuis l'échec, qui est ce que borne la fenêtre de retentative.
     */
    const cas = async (ageTotal: number) => {
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      fetchMock
        .mockResolvedValueOnce(reponseOk(1.11))
        .mockRejectedValue(new Error("FX HTTP 403"));
      vi.setSystemTime(new Date("2026-03-02T09:00:00.000Z"));
      const { getEurRates } = await moduleNeuf();
      await getEurRates(); // réponse valide, âge 0
      avancer(HEURE + MINUTE);
      await getEurRates(); // premier échec, ouvre la fenêtre de retentative
      const appelsApresEchec = fetchMock.mock.calls.length;
      avancer(ageTotal - (HEURE + MINUTE));
      const rates = await getEurRates();
      return {
        retente: fetchMock.mock.calls.length > appelsApresEchec,
        usd: rates.USD,
      };
    };

    // Fenêtre de retentative : une minute après l'échec.
    expect((await cas(HEURE + MINUTE + 59 * 1000)).retente).toBe(false);
    expect((await cas(HEURE + MINUTE + 61 * 1000)).retente).toBe(true);
    // Borne de péremption : une journée depuis la dernière réponse valide.
    expect((await cas(23 * HEURE)).usd).toBe(1.11);
    expect((await cas(25 * HEURE)).usd).toBe(1.08);
  });
});

describe("les conversions restent inchangées", () => {
  it("convertit avec les taux servis, fournisseur disponible ou non", async () => {
    fetchMock.mockResolvedValue(reponseOk(1.11));
    const { toEurAmount, fromEurAmount, fxRateToEur } = await moduleNeuf();

    // 111 USD à 1 EUR = 1,11 USD → 100 EUR.
    expect(Number(await toEurAmount("111", "USD"))).toBeCloseTo(100, 9);
    expect(Number(await fromEurAmount("100", "USD"))).toBeCloseTo(111, 9);
    expect(Number(await fxRateToEur("USD"))).toBeCloseTo(1 / 1.11, 9);
    // L'euro ne passe jamais par un taux.
    expect(await fxRateToEur("EUR")).toBe("1");
  });
});
