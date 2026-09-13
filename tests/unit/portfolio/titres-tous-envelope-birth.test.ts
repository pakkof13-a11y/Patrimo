/**
 * Titres « Tous » — l'enveloppe née le plus tôt ouvre la série.
 *
 * ## Le défaut mesuré
 *
 * Compte de démonstration, 2026-09-13, scope `listed`, fenêtre « Tout »
 * (2020-09-13 → 2026-09-12, 314 points hebdomadaires) :
 *
 * | vue                  | premier point servi | points |
 * | -------------------- | ------------------- | ------ |
 * | Titres / PEA seul    | 2020-09-13          | 314    |
 * | Titres / CTO seul    | 2023-11-03          | 150    |
 * | Titres / **Tous**    | **2023-11-03**      | 150    |
 *
 * « Tous » naissait donc avec l'enveloppe la **plus tardive**. La cause n'est
 * pas une borne de scope — `earliestDayForScope("listed")` servait bien
 * 2020-09-13 — mais la somme : `ACTIONS.CTO` valait `null` jusqu'au premier
 * achat en CTO, parce que le croisement refuse d'affirmer une enveloppe vide
 * tant qu'une ligne titre reste en suspens (416 494 € de CFD sur ce jeu). La
 * somme rendait `null`, et le point disparaissait — emportant les 38 164 € de
 * PEA que le journal démontrait pourtant dès le premier jour.
 *
 * ## Ce que ces tests fixent
 *
 * Une enveloppe dont la première écriture est postérieure au point contribue
 * **zéro** : elle n'était pas née, c'est un fait daté. `null` reste réservé à
 * ce qu'on ignore — une ligne orpheline sous une enveloppe déjà née.
 *
 * PEA seul et CTO seul ne bougent pas : leur série reste celle de leur propre
 * enveloppe, absente là où rien ne la démontre.
 */

import { describe, expect, it } from "vitest";
import {
  envelopeFirstWriteDays,
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import {
  dailyNavFromSeries,
  type DailyNavPoint,
} from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  envelopeBirthPoints,
  envelopeBornAt,
  titresValueAt,
  toPocketEvolutionPoints,
} from "@/app/lib/portfolio/pocket-series";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

function inputs(over: Partial<HistoricalInputs> = {}): HistoricalInputs {
  return {
    transactions: [],
    assetClassById: new Map(),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    excludedAssetIds: new Set(),
    closes: new Map(),
    cashAccounts: [],
    cashEvents: [],
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    employeeSavings: [],
    liabilities: [],
    ...over,
  };
}

function buy(
  id: string,
  assetId: string,
  jour: string,
  qty: number,
  unit: number
): LedgerTx {
  return {
    id,
    type: "ACHAT",
    platformId: "p1",
    toPlatformId: null,
    assetId,
    quantity: d(qty),
    unitPrice: d(unit),
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit),
    occurredAt: new Date(`${jour}T10:00:00Z`),
  } as unknown as LedgerTx;
}

function evt(
  jour: string,
  accountType: string,
  compte?: { id: string; envelopeType: string }
) {
  const occurredAt = new Date(`${jour}T12:00:00.000Z`);
  return {
    occurredAt,
    createdAt: occurredAt,
    accountType,
    securitiesAccountId: compte?.id ?? null,
    envelopeType: compte?.envelopeType ?? null,
  };
}

function closes(spec: Record<string, Record<string, number>>) {
  return new Map(
    Object.entries(spec).map(([id, byDay]) => [id, new Map(Object.entries(byDay))])
  );
}

/* ── Le décor du compte de démonstration, réduit à ce qui produit le défaut ──
   PEA démontré dès 2020 ; CTO ouvert en 2023 ; une ligne titre en suspens qui
   maintient `ACTIONS.UNKNOWN` non nul tout du long — c'est elle qui rendait
   `ACTIONS.CTO` absent avant 2023. */
function peaPuisCto() {
  return new PortfolioValuationEngine(
    inputs({
      transactions: [
        buy("t1", "pea", "2020-01-06", 10, 100),
        buy("t2", "susp", "2020-01-06", 5, 100),
        buy("t3", "cto", "2023-06-01", 2, 100),
      ],
      rawAssetClassById: new Map([
        ["pea", "ACTIONS"],
        ["susp", "ACTIONS"],
        ["cto", "ACTIONS"],
      ]),
      assetClassById: new Map([
        ["pea", "ACTIONS"],
        ["susp", "ACTIONS"],
        ["cto", "ACTIONS"],
      ]),
      envelopeEventsByAsset: new Map([
        ["pea", [evt("2020-01-06", "PEA")]],
        ["cto", [evt("2023-06-01", "CTO")]],
        ["susp", [evt("2030-01-01", "CTO")]],
      ]),
      closes: closes({
        pea: { "2020-01-06": 100 },
        susp: { "2020-01-06": 100 },
        cto: { "2023-06-01": 100 },
      }),
    })
  );
}

function serie(): DailyNavPoint[] {
  const e = peaPuisCto();
  return dailyNavFromSeries(
    e.buildSeries("2020-01-06", "2023-06-05"),
    "listed",
    "day",
    e.envelopeFirstWriteDays()
  );
}

const at = (pts: DailyNavPoint[], jour: string) => pts.find((p) => p.day === jour)!;

describe("mesure — le croisement rend bien `null` sur l'enveloppe pas encore née", () => {
  it("avant le premier achat CTO, `ACTIONS.CTO` est absent, pas zéro", () => {
    /*
      Le moteur n'est pas en cause et n'est pas modifié : tant qu'une ligne
      titre est en suspens, il refuse d'affirmer que le CTO est vide. C'est le
      point de départ du défaut, pas le défaut lui-même.
    */
    const p = at(serie(), "2022-01-01");
    expect(p.byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(p.byAssetClassAndEnvelope.ACTIONS.PEA).toBeCloseTo(1_000, 6);
    expect(p.byAssetClassAndEnvelope.ACTIONS.UNKNOWN).toBeCloseTo(500, 6);
  });

  it("sans date de naissance, la somme « Tous » reste absente — comportement d'avant", () => {
    /*
      La série d'avant le correctif, reproduite en retirant la seule donnée
      ajoutée : `dailyNavFromSeries` sans `envelopeFirstWriteDay`. C'est la
      mesure « avant », et elle doit continuer de valoir `null` — un appelant
      qui ne date pas les enveloppes n'acquiert aucune certitude nouvelle.
    */
    const avant = dailyNavFromSeries(
      peaPuisCto().buildSeries("2020-01-06", "2023-06-05"),
      "listed"
    );
    expect(titresValueAt(at(avant, "2022-01-01"))).toBeNull();
    expect(toPocketEvolutionPoints(avant, "TITRES")[0]!.label).toBe("2023-06-01");
  });
});

describe("Titres « Tous » démarre à l'enveloppe née le plus tôt", () => {
  it("la série commence au premier jour du PEA, pas à l'ouverture du CTO", () => {
    const points = toPocketEvolutionPoints(serie(), "TITRES");
    expect(points[0]!.label).toBe("2020-01-06");
  });

  it("avant l'ouverture du CTO, le total vaut le seul PEA démontré", () => {
    expect(titresValueAt(at(serie(), "2022-01-01"))).toBeCloseTo(1_000, 6);
  });

  it("le jour de l'ouverture, le CTO s'ajoute sans marche fabriquée", () => {
    const pts = serie();
    expect(titresValueAt(at(pts, "2023-05-31"))).toBeCloseTo(1_000, 6);
    expect(titresValueAt(at(pts, "2023-06-01"))).toBeCloseTo(1_200, 6);
  });

  it("aucun point n'est retiré entre les deux naissances", () => {
    const pts = serie();
    expect(toPocketEvolutionPoints(pts, "TITRES").length).toBe(pts.length);
  });
});

describe("PEA seul et CTO seul ne bougent pas", () => {
  it("PEA seul commence au premier jour démontré", () => {
    const pea = toPocketEvolutionPoints(serie(), "TITRES", "PEA");
    expect(pea[0]!.label).toBe("2020-01-06");
    expect(pea[0]!.total).toBeCloseTo(1_000, 6);
  });

  it("CTO seul commence à son ouverture, et pas un jour avant", () => {
    /*
      La règle « pas encore née = zéro » ne vaut que pour la **contribution à
      un total**. Une série qui n'est que le CTO n'a rien à tracer avant lui :
      la poser à zéro affirmerait un compte-titres vide là où le croisement dit
      « on ne sait pas ».
    */
    const cto = toPocketEvolutionPoints(serie(), "TITRES", "CTO");
    expect(cto[0]!.label).toBe("2023-06-01");
    expect(cto[0]!.total).toBeCloseTo(200, 6);
  });

  it("la date de naissance ne réécrit aucune valeur déjà démontrée", () => {
    for (const p of serie()) {
      const pea = p.byAssetClassAndEnvelope.ACTIONS.PEA;
      expect(titresValueAt(p, "PEA")).toBeCloseTo(pea as number, 6);
    }
  });
});

describe("`null` reste réservé à l'orphelin", () => {
  it("une ligne en suspens sous une enveloppe déjà née laisse le total absent", () => {
    /*
      Le CTO est né le 2024-01-01 — une ligne l'y a écrit ce jour-là, avant de
      quitter le périmètre. À partir de là, un `null` sur sa case est une vraie
      ignorance : la ligne en suspens pourrait s'y trouver, et le total doit le
      dire plutôt que de compter zéro.
    */
    const e = new PortfolioValuationEngine(
      inputs({
        transactions: [
          buy("t1", "pea", "2024-01-01", 10, 100),
          buy("t2", "susp", "2024-01-01", 5, 100),
        ],
        rawAssetClassById: new Map([
          ["pea", "ACTIONS"],
          ["susp", "ACTIONS"],
        ]),
        assetClassById: new Map([
          ["pea", "ACTIONS"],
          ["susp", "ACTIONS"],
        ]),
        envelopeEventsByAsset: new Map([
          ["pea", [evt("2024-01-01", "PEA")]],
          ["susp", [evt("2030-01-01", "CTO")]],
          ["fantome", [evt("2024-01-01", "CTO")]],
        ]),
        closes: closes({
          pea: { "2024-01-01": 100 },
          susp: { "2024-01-01": 100 },
        }),
      })
    );
    const pts = dailyNavFromSeries(
      e.buildSeries("2024-01-01", "2024-01-05"),
      "listed",
      "day",
      e.envelopeFirstWriteDays()
    );
    expect(at(pts, "2024-01-05").byAssetClassAndEnvelope.ACTIONS.CTO).toBeNull();
    expect(titresValueAt(at(pts, "2024-01-05"))).toBeNull();
  });

  it("un croisement absent reste absent — la date ne le remplace pas", () => {
    const p = {
      day: "2024-01-01",
      byAssetClassAndEnvelope: undefined,
      envelopeFirstWriteDay: { PEA: "2030-01-01", CTO: "2030-01-01" },
    } as unknown as DailyNavPoint;
    expect(titresValueAt(p)).toBeNull();
  });
});

describe("`envelopeFirstWriteDays` — la date vient du journal", () => {
  it("retient la plus ancienne écriture de chaque enveloppe", () => {
    const j = envelopeFirstWriteDays(
      new Map([
        ["a", [evt("2021-05-04", "CTO"), evt("2019-02-02", "CTO")]],
        ["b", [evt("2015-07-01", "PEA")]],
      ])
    );
    expect(j).toEqual({ PEA: "2015-07-01", CTO: "2019-02-02" });
  });

  it("PEA-PME date le PEA — trois seaux, pas quatre", () => {
    const j = envelopeFirstWriteDays(
      new Map([
        ["a", [evt("2018-01-01", "PEA", { id: "c1", envelopeType: "PEA_PME" })]],
      ])
    );
    expect(j.PEA).toBe("2018-01-01");
    expect(j.CTO).toBeNull();
  });

  it("une enveloppe jamais écrite reste `null` — indatable, pas née à zéro", () => {
    /*
      `null` n'est pas « née le premier jour » : `envelopeBornAt` rend alors
      `null`, et `titresValueAt` retombe sur la prudence du croisement.
    */
    const j = envelopeFirstWriteDays(new Map([["a", [evt("2020-01-01", "PEA")]]]));
    expect(j.CTO).toBeNull();
  });

  it("un détachement des comptes-titres ne date aucune enveloppe", () => {
    const j = envelopeFirstWriteDays(new Map([["a", [evt("2020-01-01", "AV")]]]));
    expect(j).toEqual({ PEA: null, CTO: null });
  });
});

describe("`envelopeBornAt` / `envelopeBirthPoints` — de quoi poser un marqueur", () => {
  it("distingue née, pas encore née, et indatable", () => {
    const pts = serie();
    const p = at(pts, "2022-01-01");
    expect(envelopeBornAt(p, "PEA")).toBe(true);
    expect(envelopeBornAt(p, "CTO")).toBe(false);
    expect(envelopeBornAt(at(pts, "2023-06-01"), "CTO")).toBe(true);
    expect(envelopeBornAt({ ...p, envelopeFirstWriteDay: undefined }, "CTO")).toBeNull();
  });

  it("le marqueur tombe sur le point qui inaugure l'enveloppe", () => {
    expect(envelopeBirthPoints(serie())).toEqual([
      { envelope: "CTO", day: "2023-06-01" },
    ]);
  });

  it("une enveloppe née avant la fenêtre n'est pas un marqueur", () => {
    /*
      Le premier point servi n'est pas une naissance : il n'a pas de veille à
      l'écran, et le signaler ferait passer une borne de fenêtre pour un
      événement. Le PEA, né au premier jour de cette série, en est exclu.
    */
    expect(envelopeBirthPoints(serie()).some((m) => m.envelope === "PEA")).toBe(false);
  });
});
