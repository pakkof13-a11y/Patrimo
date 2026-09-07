import { describe, expect, it } from "vitest";
import {
  PortfolioValuationEngine,
  type HistoricalInputs,
} from "@/app/lib/portfolio/historical/engine";
import { dailyNavFromSeries } from "@/app/lib/portfolio/historical/get-daily-nav";
import {
  WEEKLY_STEP_MIN_SPAN_DAYS,
  historyStepForWindow,
  seriesEmissionDays,
} from "@/app/lib/portfolio/historical/history-window";
import { enumerateDays } from "@/app/lib/portfolio/historical/timeline";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

/**
 * D19 — pas de la série : jour civil jusqu'à ~1 an, semaine civile au-delà.
 *
 * Ce fichier tient les deux moitiés de la promesse. La première est un gain :
 * le moteur ne valorise plus chaque jour civil sur 5A/Tout. La seconde est le
 * contrat métier qui la rend acceptable — `Δmarché = NAV_t − NAV_{t−1} − flux_t`
 * est indexée sur les **points émis**, donc les flux d'un point hebdomadaire
 * doivent être la somme de son intervalle. Sans cela un apport du mercredi
 * deviendrait de la performance de marché du lundi suivant.
 */

const DAY = (s: string) => new Date(`${s}T10:00:00Z`);

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

function buy(id: string, day: string, qty: number, unit: number): LedgerTx {
  return {
    id,
    type: "ACHAT",
    platformId: "p1",
    toPlatformId: null,
    assetId: "aapl",
    quantity: d(qty),
    unitPrice: d(unit),
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    grossOriginal: d(qty * unit),
    cashAmountOriginal: d(qty * unit),
    occurredAt: DAY(day),
  };
}

const FROM = "2024-01-03"; // un mercredi — la fenêtre n'ouvre pas sur un lundi
const TO = "2025-06-11"; // un mercredi — la dernière semaine est incomplète

/**
 * Fixture volontairement « en travers » de la semaine : deux achats un jeudi et
 * un vendredi, un versement de cash un mercredi. Aucun de ces trois flux ne
 * tombe un lundi ; s'ils survivent au pas hebdomadaire, c'est bien que les flux
 * sont sommés sur l'intervalle et non lus sur le seul jour du point.
 */
function fixture(): PortfolioValuationEngine {
  const closes = new Map<string, number>();
  enumerateDays(FROM, TO).forEach((day, i) => {
    closes.set(day, 100 + Math.sin(i / 5) * 12 + i / 40);
  });
  return new PortfolioValuationEngine(
    inputs({
      transactions: [
        buy("t1", FROM, 10, 100),
        buy("t2", "2024-04-11", 7, 118), // jeudi
        buy("t3", "2024-11-15", 5, 131), // vendredi
      ],
      assetClassById: new Map([["aapl", "ACTIONS"]]),
      rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
      holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
      closes: new Map([["aapl", closes]]),
      cashAccounts: [{ id: "b1", balanceEur: d(9_000), createdAt: DAY(FROM) }],
      cashEvents: [
        {
          accountId: "b1",
          occurredAt: DAY(FROM),
          amountEur: d(5_000),
          balanceAfterEur: d(5_000),
          type: "OPENING",
        },
        {
          accountId: "b1",
          occurredAt: DAY("2024-08-07"), // mercredi
          amountEur: d(4_000),
          balanceAfterEur: d(9_000),
          type: "DEPOSIT",
        },
      ],
    })
  );
}

describe("historyStepForWindow — une seule décision de granularité", () => {
  it("les fenêtres courtes (7J → 1A) restent au jour civil", () => {
    expect(historyStepForWindow("2026-08-31", "2026-09-06")).toBe("day"); // 7J
    expect(historyStepForWindow("2026-08-06", "2026-09-06")).toBe("day"); // 1M
    expect(historyStepForWindow("2026-06-06", "2026-09-06")).toBe("day"); // 3M
    expect(historyStepForWindow("2026-03-06", "2026-09-06")).toBe("day"); // 6M
    expect(historyStepForWindow("2026-01-01", "2026-09-06")).toBe("day"); // YTD
    expect(historyStepForWindow("2025-09-05", "2026-09-06")).toBe("day"); // 1A + ancre
  });

  it("les fenêtres longues (5A, Tout jusqu'au cap de six ans) passent à la semaine", () => {
    expect(historyStepForWindow("2021-09-06", "2026-09-06")).toBe("week"); // 5A
    expect(historyStepForWindow("2020-09-06", "2026-09-06")).toBe("week"); // Tout / cap
  });

  it("la bascule tient exactement à WEEKLY_STEP_MIN_SPAN_DAYS, bornes incluses", () => {
    const to = "2026-09-06";
    const dayBefore = (n: number) => {
      const t = Date.UTC(2026, 8, 6, 12) - (n - 1) * 86_400_000;
      return new Date(t).toISOString().slice(0, 10);
    };
    expect(historyStepForWindow(dayBefore(WEEKLY_STEP_MIN_SPAN_DAYS), to)).toBe(
      "week"
    );
    expect(
      historyStepForWindow(dayBefore(WEEKLY_STEP_MIN_SPAN_DAYS - 1), to)
    ).toBe("day");
  });

  it("une fenêtre inversée ne fabrique pas un pas hebdomadaire", () => {
    expect(historyStepForWindow("2026-09-06", "2020-09-06")).toBe("day");
  });
});

describe("seriesEmissionDays — lundi, plus les deux bornes", () => {
  it("pas quotidien : tous les jours civils, contrat T-05 intact", () => {
    const days = enumerateDays("2024-01-03", "2024-02-14");
    expect(seriesEmissionDays("2024-01-03", "2024-02-14", "day")).toEqual(days);
  });

  it("pas hebdomadaire : la borne de départ, chaque lundi, la borne d'arrivée", () => {
    // 2024-01-03 mercredi → 2024-01-31 mercredi.
    expect(seriesEmissionDays("2024-01-03", "2024-01-31", "week")).toEqual([
      "2024-01-03", // from, mercredi
      "2024-01-08",
      "2024-01-15",
      "2024-01-22",
      "2024-01-29",
      "2024-01-31", // to, mercredi : le dernier point est le jour demandé
    ]);
  });

  it("le dernier point est le jour demandé, jamais le lundi qui le précède", () => {
    const jours = seriesEmissionDays("2024-01-03", "2024-06-11", "week");
    expect(jours[jours.length - 1]).toBe("2024-06-11");
  });

  it("une borne qui tombe un lundi n'est pas émise deux fois", () => {
    const jours = seriesEmissionDays("2024-01-08", "2024-02-05", "week");
    expect(jours).toEqual([
      "2024-01-08",
      "2024-01-15",
      "2024-01-22",
      "2024-01-29",
      "2024-02-05",
    ]);
    expect(new Set(jours).size).toBe(jours.length);
  });

  it("une fenêtre d'un seul jour rend ce jour, quel que soit le pas", () => {
    expect(seriesEmissionDays("2024-01-03", "2024-01-03", "week")).toEqual([
      "2024-01-03",
    ]);
  });
});

describe("buildSeries au pas hebdomadaire", () => {
  it("émet un point par semaine civile, pas un par jour", () => {
    const hebdo = fixture().buildSeries(FROM, TO, "week");
    const jours = enumerateDays(FROM, TO);
    expect(jours.length).toBeGreaterThan(500);
    // ~1 point pour 7 jours, plus les deux bornes.
    expect(hebdo.length).toBeLessThan(jours.length / 6);
    expect(hebdo.length).toBeGreaterThan(jours.length / 8);
    expect(hebdo[0]!.day).toBe(FROM);
    expect(hebdo[hebdo.length - 1]!.day).toBe(TO);
  });

  it("valorise au même euro que la série quotidienne, aux jours qu'elle émet", () => {
    const e = fixture();
    const jour = new Map(
      e.buildSeries(FROM, TO, "day").map((p) => [p.day, p])
    );
    for (const p of e.buildSeries(FROM, TO, "week")) {
      const ref = jour.get(p.day)!;
      expect(p.grossAssets).toBeCloseTo(ref.grossAssets, 6);
      expect(p.net).toBeCloseTo(ref.net, 6);
      expect(p.financier).toBeCloseTo(ref.financier, 6);
      expect(p.status).toBe(ref.status);
    }
  });

  it("le flux d'un point hebdomadaire est la somme des flux de son intervalle", () => {
    const e = fixture();
    const jour = e.buildSeries(FROM, TO, "day");
    const hebdo = e.buildSeries(FROM, TO, "week");
    const idx = new Map(jour.map((p, i) => [p.day, i]));

    let precedent = idx.get(hebdo[0]!.day)!;
    for (let i = 1; i < hebdo.length; i++) {
      const courant = idx.get(hebdo[i]!.day)!;
      let somme = d(0);
      for (let k = precedent + 1; k <= courant; k++) {
        somme = somme.plus(d(jour[k]!.externalFlows));
      }
      expect(Math.abs(somme.minus(d(hebdo[i]!.externalFlows)).toNumber()))
        .toBeLessThanOrEqual(0.01);
      precedent = courant;
    }
  });

  it("aucun flux n'est perdu : le cumul hebdomadaire égale le cumul quotidien", () => {
    const e = fixture();
    const cumul = (s: { externalFlows: number }[]) =>
      s.reduce((acc, p) => acc.plus(d(p.externalFlows)), d(0));
    const jour = cumul(e.buildSeries(FROM, TO, "day"));
    const hebdo = cumul(e.buildSeries(FROM, TO, "week"));
    // 10×100 + 7×118 + 5×131 = 2 481 d'achats, + 5 000 + 4 000 de cash.
    expect(jour.toNumber()).toBeCloseTo(11_481, 6);
    expect(Math.abs(hebdo.minus(jour).toNumber())).toBeLessThanOrEqual(0.01);
  });

  it("un versement de poche daté d'un mercredi n'est pas oublié par le point du lundi", () => {
    const e = fixture();
    const hebdo = e.buildSeries(FROM, TO, "week");
    // Le versement cash du 2024-08-07 doit se retrouver dans le point qui
    // clôt son intervalle, jamais nulle part.
    const porteur = hebdo.find(
      (p) => p.day > "2024-08-07" && p.flowsByAssetClass.CASH !== 0
    );
    expect(porteur).toBeDefined();
    expect(porteur!.day).toBe("2024-08-12"); // le lundi suivant
    expect(porteur!.flowsByAssetClass.CASH).toBeCloseTo(4_000, 6);
  });

  it("Δmarché reste l'identité métier sur les points émis — |Δ| ≤ 0,01 €", () => {
    const e = fixture();
    const jour = e.buildSeries(FROM, TO, "day");
    const hebdo = e.buildSeries(FROM, TO, "week");
    const idx = new Map(jour.map((p, i) => [p.day, i]));

    let pire = 0;
    let precedent = idx.get(hebdo[0]!.day)!;
    for (let i = 1; i < hebdo.length; i++) {
      const courant = idx.get(hebdo[i]!.day)!;
      // Δmarché du point hebdomadaire, à la lettre de daily-nav-view.ts.
      const deltaHebdo = d(hebdo[i]!.grossAssets)
        .minus(d(hebdo[i - 1]!.grossAssets))
        .minus(d(hebdo[i]!.externalFlows));
      // La même chose, jour par jour, cumulée sur l'intervalle : c'est la
      // performance de marché réellement produite pendant la semaine.
      let deltaJour = d(0);
      for (let k = precedent + 1; k <= courant; k++) {
        deltaJour = deltaJour.plus(
          d(jour[k]!.grossAssets)
            .minus(d(jour[k - 1]!.grossAssets))
            .minus(d(jour[k]!.externalFlows))
        );
      }
      pire = Math.max(pire, Math.abs(deltaHebdo.minus(deltaJour).toNumber()));
      precedent = courant;
    }
    expect(pire).toBeLessThanOrEqual(0.01);
  });

  it("la position d'un lundi émis tient compte des écritures du jeudi précédent", () => {
    const e = fixture();
    // t2 (jeudi 2024-04-11) porte la position de 10 à 17 titres : le lundi
    // suivant doit déjà les valoriser.
    //
    // Ce que ce test ne prouve pas : que la boucle passe par chaque jour. Le
    // curseur de transactions rattrape son retard (`txDay > day` casse la
    // boucle), si bien qu'un état comptable resterait juste même en sautant des
    // jours. Ce qui ne le resterait pas, ce sont les flux de poches, lus dans
    // une table indexée **par jour** — c'est ce que vérifient les tests de
    // flux ci-dessus, et c'est la vraie raison pour laquelle la boucle avance
    // jour par jour.
    const hebdo = e.buildSeries(FROM, TO, "week");
    const lundi = hebdo.find((p) => p.day === "2024-04-15")!;
    const jourRef = e
      .buildSeries("2024-04-15", "2024-04-15", "day")[0]!;
    expect(lundi.positionsCostBasis).toBeCloseTo(jourRef.positionsCostBasis, 6);
    expect(lundi.positionsCostBasis).toBeCloseTo(10 * 100 + 7 * 118, 6);
  });
});

describe("dailyNavFromSeries — le pas est publié, pas deviné", () => {
  it("chaque point porte son intervalType", () => {
    const e = fixture();
    const hebdo = dailyNavFromSeries(e.buildSeries(FROM, TO, "week"), "financier", "week");
    expect(hebdo.every((p) => p.intervalType === "week")).toBe(true);
    const jour = dailyNavFromSeries(
      e.buildSeries("2024-01-03", "2024-01-10", "day"),
      "financier",
      "day"
    );
    expect(jour.every((p) => p.intervalType === "day")).toBe(true);
  });
});
