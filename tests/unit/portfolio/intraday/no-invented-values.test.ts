import { describe, expect, it } from "vitest";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { buildIntradaySeries } from "@/app/lib/portfolio/intraday/series";
import { resolverAt } from "@/app/lib/market/market-data-repository";
import { isCollectableSource } from "@/app/lib/market/intraday-collector";
import type { IntradayBarIndex } from "@/app/lib/portfolio/intraday/bar-index";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * Garde-fou : aucune valeur n'est fabriquée.
 *
 * Trois réponses sont légitimes à « que valait cet actif à cet instant » :
 * une observation, un report d'observation réelle, ou rien. Une quatrième est
 * interdite — une valeur calculée pour combler le vide.
 *
 * Ces tests vérifient les **valeurs et les statuts**, pas la présence d'un
 * point : c'est la seule façon de distinguer un report légitime d'une
 * interpolation, puisque les deux produisent un nombre.
 */

const t = (iso: string) => new Date(iso);
const H = 3_600_000;

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [], assetClassById: new Map(), excludedAssetIds: new Set(),
    closes: new Map(), cashAccounts: [], cashEvents: [], metals: [],
    privateEquity: [], crowdlending: [], tangibles: [], employeeSavings: [],
    liabilities: [], ...over,
  };
}

function buy(id: string, assetId: string, iso: string, qty: number, unit: number): LedgerTx {
  return {
    id, type: "ACHAT", platformId: "p1", toPlatformId: null, assetId,
    quantity: d(qty), unitPrice: d(unit), fees: d(0), currency: "EUR",
    fxRateToEur: d(1), grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit), occurredAt: t(iso),
  };
}

const bars = (m: Record<string, Array<[string, number]>>): IntradayBarIndex =>
  new Map(Object.entries(m).map(([id, l]) => [
    id, l.map(([iso, priceEur]) => ({ at: t(iso).getTime(), priceEur })),
  ]));

const closes = (m: Record<string, Record<string, number>>) =>
  new Map(Object.entries(m).map(([id, days]) => [id, new Map(Object.entries(days))]));

/** Cotations d'une action : vendredi en séance, rien après la clôture. */
const ACTION_VENDREDI = bars({
  action: [
    ["2026-08-21T13:00:00Z", 100],
    ["2026-08-21T14:00:00Z", 101],
    ["2026-08-21T15:00:00Z", 100],
  ],
});

describe("1 — en séance, la cotation du moment est utilisée", () => {
  it("la valeur est celle de la barre, et le statut dit qu'elle est observée", () => {
    const r = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-21T14:30:00Z"), {
      intervalMs: H,
    })("action")!;
    expect(r.priceEur).toBe(101);
    expect(r.origin).toBe("MARKET_EXACT");
    expect(r.appliesAt!.toISOString()).toBe("2026-08-21T14:00:00.000Z");
  });
});

describe("2, 3 et 4 — hors séance, week-end, jour férié", () => {
  it("aucune cotation n'est créée après la clôture : la dernière tient", () => {
    /*
      Vendredi 17 h → samedi 12 h. Le marché est fermé, aucune barre n'existe.
      Le moteur rend le dernier cours réel, et dit qu'il est reporté. Il ne
      crée pas un « cours de samedi 12 h ».
    */
    const r = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-22T12:00:00Z"), {
      intervalMs: H,
    })("action")!;
    expect(r.priceEur).toBe(100);
    expect(r.origin).toBe("MARKET_CARRIED");
    // La valeur s'applique à vendredi, pas à samedi : c'est ce que dit `appliesAt`.
    expect(r.appliesAt!.toISOString()).toBe("2026-08-21T15:00:00.000Z");
  });

  it("dimanche donne exactement la même valeur, sans dérive", () => {
    const samedi = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-22T12:00:00Z"), { intervalMs: H })("action")!;
    const dimanche = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-23T18:00:00Z"), { intervalMs: H })("action")!;
    expect(dimanche.priceEur).toBe(samedi.priceEur);
    expect(dimanche.appliesAt!.getTime()).toBe(samedi.appliesAt!.getTime());
  });

  it("un jour férié se comporte comme un week-end : rien n'est inventé", () => {
    // Le moteur n'a pas de calendrier : il ne connaît que la disponibilité de
    // la donnée. Un férié est donc un jour sans barre, traité comme tel.
    const ferie = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-24T10:00:00Z"), { intervalMs: H })("action")!;
    expect(ferie.priceEur).toBe(100);
    expect(ferie.origin).toBe("MARKET_CARRIED");
  });
});

describe("5 et 6 — pré-marché et after-market réellement fournis", () => {
  it("une barre hors séance fournie par le fournisseur est une observation", () => {
    /*
      Rien n'est supposé : si une barre existe à 7 h du matin, c'est que le
      fournisseur l'a rendue. Elle vaut alors observation comme une autre, avec
      son horodatage réel.
    */
    const avecPreMarche = bars({
      action: [
        ["2026-08-21T07:00:00Z", 98],   // pré-marché
        ["2026-08-21T13:00:00Z", 100],  // séance
        ["2026-08-21T19:00:00Z", 103],  // after-market
      ],
    });
    const pre = resolverAt({ intraday: avecPreMarche }, t("2026-08-21T07:30:00Z"), { intervalMs: H })("action")!;
    expect(pre).toMatchObject({ priceEur: 98, origin: "MARKET_EXACT" });

    const apres = resolverAt({ intraday: avecPreMarche }, t("2026-08-21T19:30:00Z"), { intervalMs: H })("action")!;
    expect(apres).toMatchObject({ priceEur: 103, origin: "MARKET_EXACT" });
  });

  it("sans barre hors séance, aucune n'est supposée", () => {
    const r = resolverAt({ intraday: ACTION_VENDREDI }, t("2026-08-21T07:30:00Z"), { intervalMs: H })("action");
    // Avant la première observation du jour : rien à reporter, rien à inventer.
    expect(r).toBeNull();
  });
});

describe("7 et 9 — fournisseur muet, absence totale", () => {
  it("aucune donnée du tout : rien n'est rendu", () => {
    expect(resolverAt({}, t("2026-08-21T14:00:00Z"), { intervalMs: H })("action")).toBeNull();
  });

  it("un échec fournisseur ne devient pas silencieusement une valeur", async () => {
    /*
      Le fournisseur n'a rien écrit : la position est retenue à son prix de
      revient — il faut bien un nombre — mais elle est **comptée** comme non
      valorisée, et le point le dit.
    */
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T10:00:00Z"),
      deps: {
        loadBars: async () => new Map(),
        buildEngine: async () =>
          new PortfolioValuationEngine(
            inputs({
              transactions: [buy("t1", "muet", "2020-01-01T10:00:00Z", 10, 100)],
              assetClassById: new Map([["muet", "ACTIONS"]]),
              closes: closes({ autre: { "2026-08-25": 1 } }),
            })
          ),
      },
    });
    const p = s.points[0]!;
    expect(p.securities).toBe(1000);          // le coût, pas un cours
    expect(p.priceOrigins).toContain("UNAVAILABLE");
    expect(p.priceCoverage).toBe(0);
    expect(p.status).toBe("ESTIMATED");
  });
});

describe("8, 10 et 11 — trou au milieu d'une série, jamais comblé par un calcul", () => {
  const AVEC_TROU = bars({
    a1: [
      ["2026-08-25T10:00:00Z", 100],
      ["2026-08-25T11:00:00Z", 101],
      // 12:00 absent
      ["2026-08-25T13:00:00Z", 99],
    ],
  });

  it("midi rend 101 — la dernière valeur réelle — et jamais 100", () => {
    const r = resolverAt({ intraday: AVEC_TROU }, t("2026-08-25T12:00:00Z"), { intervalMs: H })("a1")!;
    expect(r.priceEur).toBe(101);
    expect(r.origin).toBe("MARKET_CARRIED");
    // Les valeurs interdites : moyenne des voisins, ou tendance.
    expect(r.priceEur).not.toBe(100);
    expect(r.priceEur).not.toBe(100.5);
    expect(r.priceEur).not.toBe(99);
  });

  it("la valeur reportée ne dérive pas avec le temps écoulé", () => {
    /*
      Une extrapolation se reconnaîtrait à ceci : la valeur changerait selon
      l'instant demandé. Un report, non — il rend toujours la même observation.
    */
    const a = resolverAt({ intraday: AVEC_TROU }, t("2026-08-25T11:30:00Z"), { intervalMs: H })("a1")!;
    const b = resolverAt({ intraday: AVEC_TROU }, t("2026-08-25T12:59:00Z"), { intervalMs: H })("a1")!;
    expect(a.priceEur).toBe(101);
    expect(b.priceEur).toBe(101);
    expect(a.appliesAt!.getTime()).toBe(b.appliesAt!.getTime());
  });

  it("le report reste borné : au-delà, plus rien", () => {
    const tres_tard = resolverAt({ intraday: AVEC_TROU }, t("2026-09-30T12:00:00Z"), { intervalMs: H })("a1");
    expect(tres_tard).toBeNull();
  });
});

describe("12 — crypto la nuit : la donnée décide, pas l'horloge", () => {
  it("une observation nocturne est une observation", () => {
    /*
      Aucune règle de fermeture n'est appliquée à l'aveugle : le résolveur ne
      regarde ni l'heure ni le jour de la semaine, seulement si une barre
      couvre l'instant. Un marché continu en profite automatiquement.
    */
    const nuit = bars({
      btc: [
        ["2026-08-22T02:00:00Z", 55_000],  // samedi, 2 h du matin
        ["2026-08-22T03:00:00Z", 55_400],
      ],
    });
    const r = resolverAt({ intraday: nuit }, t("2026-08-22T03:30:00Z"), { intervalMs: H })("btc")!;
    expect(r).toMatchObject({ priceEur: 55_400, origin: "MARKET_EXACT" });
  });

  it("action et crypto suivent la même règle au même instant", () => {
    const serie = new Map([
      ...bars({ btc: [["2026-08-22T02:00:00Z", 55_000]] }),
      ...ACTION_VENDREDI,
    ]);
    const at = t("2026-08-22T02:30:00Z");
    const resolve = resolverAt({ intraday: serie }, at, { intervalMs: H });
    // La crypto a une barre à cet instant : observée.
    expect(resolve("btc")!.origin).toBe("MARKET_EXACT");
    // L'action n'en a pas : reportée. Même règle, résultats différents parce
    // que les données diffèrent — pas parce qu'on a codé un calendrier.
    expect(resolve("action")!.origin).toBe("MARKET_CARRIED");
  });
});

describe("13 — composantes non cotées : aucune pseudo-variation intraday", () => {
  it("immobilier, alternatifs et cash gardent la même valeur toute la journée", async () => {
    const commun = {
      cashAccounts: [
        { id: "b1", balanceEur: d(10_000), createdAt: t("2020-01-01T00:00:00Z") },
      ],
      tangibles: [
        {
          id: "tg1", purchaseDate: t("2020-01-01T00:00:00Z"),
          createdAt: t("2020-01-01T00:00:00Z"), updatedAt: t("2020-01-01T00:00:00Z"),
          costEur: d(50_000), estimatedValueEur: d(60_000), valuations: [],
        },
      ],
    };
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T09:00:00Z"),
      to: t("2026-08-25T17:00:00Z"),
      deps: {
        loadBars: async () => bars({ ancre: [["2026-08-25T09:00:00Z", 1]] }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(commun)),
      },
    });

    expect(s.points.length).toBeGreaterThan(4);
    expect(new Set(s.points.map((p) => p.cash)).size).toBe(1);
    expect(new Set(s.points.map((p) => p.alternatives)).size).toBe(1);
  });

  it("une valeur constatée ne bouge pas entre deux constats", () => {
    const events = new Map([
      ["bien", [
        { at: t("2024-01-01T00:00:00Z").getTime(), valueEur: 250_000 },
        { at: t("2025-01-01T00:00:00Z").getTime(), valueEur: 290_000 },
      ]],
    ]);
    const resolve = (iso: string) =>
      resolverAt({ valuationEvents: events }, t(iso), { intervalMs: H })("bien")!;
    // Six mois après le premier constat : toujours 250 000, pas une valeur
    // « en route » vers 290 000.
    expect(resolve("2024-07-01T00:00:00Z").priceEur).toBe(250_000);
    expect(resolve("2024-12-31T23:00:00Z").priceEur).toBe(250_000);
    expect(resolve("2024-07-01T00:00:00Z").origin).toBe("VALUATION_EVENT");
  });
});

describe("14 — ESTIMATED ne veut jamais dire « deviné »", () => {
  it("tout point estimé porte une origine, donc une source", async () => {
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T14:00:00Z"),
      deps: {
        loadBars: async () => bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
        buildEngine: async () =>
          new PortfolioValuationEngine(
            inputs({
              transactions: [buy("t1", "a1", "2020-01-01T10:00:00Z", 10, 100)],
              assetClassById: new Map([["a1", "ACTIONS"]]),
            })
          ),
      },
    });

    const estimes = s.points.filter((p) => p.status === "ESTIMATED");
    expect(estimes.length).toBeGreaterThan(0);
    for (const p of estimes) {
      // Une origine identifiée pour chaque point estimé : jamais un statut
      // sans source.
      expect(p.priceOrigins.length).toBeGreaterThan(0);
      expect(p.priceOrigin).toBeTruthy();
    }
  });

  it("la valeur d'un point reporté est exactement celle de l'observation", async () => {
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T13:00:00Z"),
      deps: {
        loadBars: async () => bars({ a1: [["2026-08-25T10:00:00Z", 100]] }),
        buildEngine: async () =>
          new PortfolioValuationEngine(
            inputs({
              transactions: [buy("t1", "a1", "2020-01-01T10:00:00Z", 10, 100)],
              assetClassById: new Map([["a1", "ACTIONS"]]),
            })
          ),
      },
    });
    // 10 × 100 à chaque point : la valeur reportée est celle observée, à
    // l'euro près, sans dérive d'aucune sorte.
    expect(new Set(s.points.map((p) => p.securities))).toEqual(new Set([1000]));
  });
});

describe("15 — aucune donnée fabriquée n'atteint la valorisation", () => {
  it("les séries mock sont refusées à la collecte", () => {
    expect(isCollectableSource("mock")).toBe(false);
    expect(isCollectableSource("db")).toBe(false);
  });
});

describe("la limite connue : trésorerie rétro-projetée", () => {
  it("un compte sans événement porte son solde actuel dès sa création", async () => {
    /*
      Ce test ne célèbre pas ce comportement, il le **fixe**.

      Sans aucun événement, le seul fait connu est le solde d'aujourd'hui, et il
      est rattaché à la date de création : la valeur est réelle, mais appliquée
      en arrière sur une durée que rien ne borne. C'est le report le moins bien
      étayé du moteur.

      Ce qui est vérifiable — et vérifié ici — c'est qu'il ne s'en cache pas :
      le point est estimé, jamais exact.
    */
    const compte = {
      cashAccounts: [
        { id: "b1", balanceEur: d(10_000), createdAt: t("2020-01-01T00:00:00Z") },
      ],
    };
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-25T10:00:00Z"),
      to: t("2026-08-25T10:00:00Z"),
      deps: {
        loadBars: async () => bars({ ancre: [["2026-08-25T10:00:00Z", 1]] }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(compte)),
      },
    });

    const p = s.points[0]!;
    expect(p.cash).toBe(10_000);
    // Et le compartiment ne se prétend pas mesuré.
    expect(p.estimatedComponents).toContain("cash");
    expect(p.status).toBe("ESTIMATED");
  });

  it("un compte avec des événements suit ses soldes réels, sans rétro-projection", async () => {
    /*
      Le contraste qui rend la limite lisible : dès qu'un solde daté existe, il
      fait foi, et rien n'est appliqué en arrière.
    */
    const avecEvenements = {
      cashAccounts: [
        { id: "b1", balanceEur: d(10_000), createdAt: t("2020-01-01T00:00:00Z") },
      ],
      cashEvents: [
        {
          accountId: "b1",
          occurredAt: t("2026-08-20T00:00:00Z"),
          amountEur: d(4_000),
          balanceAfterEur: d(4_000),
          type: "OPENING",
        },
        {
          accountId: "b1",
          occurredAt: t("2026-08-24T00:00:00Z"),
          amountEur: d(6_000),
          balanceAfterEur: d(10_000),
          type: "DEPOSIT",
        },
      ],
    };
    const s = await buildIntradaySeries({
      userId: "u1",
      from: t("2026-08-21T10:00:00Z"),
      to: t("2026-08-25T10:00:00Z"),
      deps: {
        loadBars: async () => bars({ ancre: [["2026-08-21T10:00:00Z", 1]] }),
        buildEngine: async () => new PortfolioValuationEngine(inputs(avecEvenements)),
      },
    });

    const avant = s.points.find((p) => p.day === "2026-08-21")!;
    const apres = s.points[s.points.length - 1]!;
    // Le 21 : le solde réel de l'époque, pas celui d'aujourd'hui.
    expect(avant.cash).toBe(4_000);
    expect(apres.cash).toBe(10_000);
  });
});
