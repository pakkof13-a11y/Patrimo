import { mondayOfWeek } from "@/app/lib/portfolio/historical/history-window";
import { navPointPeriodLabel } from "@/app/lib/portfolio/daily-nav-view";
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
 * D23 — l'ancrage de cette semaine passe du lundi au dimanche, et le dernier
 * point cesse d'être la borne demandée : c'est le dernier dimanche ≤ `to`.
 * D26 — le dimanche n'a jamais de cotation : chaque point hebdomadaire s'y
 * reportait donc systématiquement (`MARKET_CARRIED`), et la série entière se
 * déclarait `ESTIMATED` (mesuré : 314/314 sur `demo`, fenêtre « Tout »).
 * L'émission passe du dimanche au **vendredi** — dernier jour de bourse de la
 * semaine civile (lundi à vendredi) — et le libellé, du dimanche au lundi qui
 * ouvre la même semaine. Le regroupement hebdomadaire lui-même ne change pas.
 *
 * Ce fichier tient les deux moitiés de la promesse. La première est un gain :
 * le moteur ne valorise plus chaque jour civil sur 5A/Tout. La seconde est le
 * contrat métier qui la rend acceptable — `Δmarché = NAV_t − NAV_{t−1} − flux_t`
 * est indexée sur les **points émis**, donc les flux d'un point hebdomadaire
 * doivent être la somme de son intervalle. Sans cela un apport du mercredi
 * deviendrait de la performance de marché du vendredi suivant.
 *
 * Le point partiel de fin (dernier point = jour demandé, même sur une semaine
 * inachevée) a disparu avec D23 : il se justifiait par « sinon le hero
 * affiche une valorisation vieille de plusieurs jours », un raisonnement
 * caduc depuis que le gros chiffre du hero est un encours daté du jour
 * (hors courbe) et que la courbe s'arrête déjà à `lastCloseDay`. La semaine
 * en cours n'est donc plus servie, exactement comme le jour en cours ne l'est
 * plus sur les séries quotidiennes.
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

describe("seriesEmissionDays — vendredi, plus la borne de départ", () => {
  it("pas quotidien : tous les jours civils, contrat T-05 intact", () => {
    const days = enumerateDays("2024-01-03", "2024-02-14");
    expect(seriesEmissionDays("2024-01-03", "2024-02-14", "day")).toEqual(days);
  });

  it("pas hebdomadaire : la borne de départ, puis chaque vendredi — jamais la borne d'arrivée si elle n'en est pas un", () => {
    // 2024-01-03 mercredi → 2024-01-31 mercredi : aucune des deux bornes
    // n'est un vendredi, donc aucune des deux ne clôt une semaine de bourse.
    expect(seriesEmissionDays("2024-01-03", "2024-01-31", "week")).toEqual([
      "2024-01-03", // from, mercredi : seul intervalle encore partiel
      "2024-01-05",
      "2024-01-12",
      "2024-01-19",
      "2024-01-26",
      // pas de 2024-01-31 : la semaine du vendredi 26 janvier n'est pas close.
    ]);
  });

  it("le dernier point est le dernier vendredi ≤ to, jamais le jour demandé", () => {
    const jours = seriesEmissionDays("2024-01-03", "2024-06-11", "week");
    // 2024-06-11 est un mardi ; le dernier vendredi qui le précède est le 07.
    expect(jours[jours.length - 1]).toBe("2024-06-07");
    expect(jours[jours.length - 1]).not.toBe("2024-06-11");
  });

  it("une borne qui tombe un vendredi n'est pas émise deux fois, et clôt bien la série", () => {
    const jours = seriesEmissionDays("2024-01-05", "2024-02-02", "week");
    expect(jours).toEqual([
      "2024-01-05",
      "2024-01-12",
      "2024-01-19",
      "2024-01-26",
      "2024-02-02",
    ]);
    expect(new Set(jours).size).toBe(jours.length);
  });

  it("une fenêtre d'un seul jour rend ce jour, quel que soit le pas", () => {
    expect(seriesEmissionDays("2024-01-03", "2024-01-03", "week")).toEqual([
      "2024-01-03",
    ]);
  });

  it("une fenêtre plus courte qu'une semaine et sans vendredi ne rend que la borne de départ", () => {
    // 2024-01-02 mardi → 2024-01-04 jeudi : aucun vendredi dans l'intervalle.
    expect(seriesEmissionDays("2024-01-02", "2024-01-04", "week")).toEqual([
      "2024-01-02",
    ]);
  });
});

describe("buildSeries au pas hebdomadaire", () => {
  it("émet un point par semaine civile, pas un par jour", () => {
    const hebdo = fixture().buildSeries(FROM, TO, "week");
    const jours = enumerateDays(FROM, TO);
    expect(jours.length).toBeGreaterThan(500);
    // ~1 point pour 7 jours, plus la borne d'ouverture.
    expect(hebdo.length).toBeLessThan(jours.length / 6);
    expect(hebdo.length).toBeGreaterThan(jours.length / 8);
    expect(hebdo[0]!.day).toBe(FROM);
    // TO (2025-06-11, mercredi) n'est pas un vendredi : le dernier point est
    // le dernier vendredi qui le précède, pas la borne demandée — la semaine
    // du 9 au 15 juin n'est pas close et n'est donc pas servie.
    expect(hebdo[hebdo.length - 1]!.day).toBe("2025-06-06");
    expect(hebdo[hebdo.length - 1]!.day).not.toBe(TO);
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

  it("aucun flux n'est perdu jusqu'au dernier point émis : le cumul hebdomadaire égale le cumul quotidien sur le même intervalle", () => {
    const e = fixture();
    const cumul = (s: { externalFlows: number }[]) =>
      s.reduce((acc, p) => acc.plus(d(p.externalFlows)), d(0));
    // Tous les flux de la fixture tombent avant le dernier vendredi émis
    // (2025-06-06) : rien n'est perdu par la troncature de la série
    // quotidienne à ce même jour.
    const hebdo = e.buildSeries(FROM, TO, "week");
    const jour = cumul(e.buildSeries(FROM, hebdo[hebdo.length - 1]!.day, "day"));
    const hebdoCumul = cumul(hebdo);
    // 10×100 + 7×118 + 5×131 = 2 481 d'achats, + 5 000 + 4 000 de cash.
    expect(jour.toNumber()).toBeCloseTo(11_481, 6);
    expect(Math.abs(hebdoCumul.minus(jour).toNumber())).toBeLessThanOrEqual(0.01);
  });

  it("la semaine en cours (après le dernier vendredi émis) n'est pas servie : ses flux n'apparaissent dans aucun point hebdomadaire", () => {
    const e = fixture();
    const hebdo = e.buildSeries(FROM, TO, "week");
    const dernier = hebdo[hebdo.length - 1]!.day;
    expect(dernier).toBe("2025-06-06");
    // Le cumul quotidien complet, lui, inclut tout — y compris la semaine
    // encore ouverte au 11 juin.
    const cumul = (s: { externalFlows: number }[]) =>
      s.reduce((acc, p) => acc.plus(d(p.externalFlows)), d(0));
    const hebdoCumul = cumul(hebdo);
    const jourComplet = cumul(e.buildSeries(FROM, TO, "day"));
    // Aucun flux de la fixture ne tombe dans les jours 07→11 juin 2025 : les
    // deux cumuls restent donc égaux ici. C'est la troncature de la borne
    // (`hebdo` s'arrête au 6 juin) qui est la garantie testée, pas une
    // coïncidence arithmétique — cf. `seriesEmissionDays` pour la borne.
    expect(hebdoCumul.toNumber()).toBeCloseTo(jourComplet.toNumber(), 6);
  });

  it("un versement de poche daté d'un mercredi n'est pas oublié par le point du vendredi", () => {
    const e = fixture();
    const hebdo = e.buildSeries(FROM, TO, "week");
    // Le versement cash du 2024-08-07 doit se retrouver dans le point qui
    // clôt son intervalle, jamais nulle part.
    const porteur = hebdo.find(
      (p) => p.day > "2024-08-07" && p.flowsByAssetClass.CASH !== 0
    );
    expect(porteur).toBeDefined();
    expect(porteur!.day).toBe("2024-08-09"); // le vendredi suivant
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

  it("la position d'un vendredi émis tient compte des écritures du jeudi précédent", () => {
    const e = fixture();
    // t2 (jeudi 2024-04-11) porte la position de 10 à 17 titres : le
    // vendredi suivant doit déjà les valoriser.
    //
    // Ce que ce test ne prouve pas : que la boucle passe par chaque jour. Le
    // curseur de transactions rattrape son retard (`txDay > day` casse la
    // boucle), si bien qu'un état comptable resterait juste même en sautant des
    // jours. Ce qui ne le resterait pas, ce sont les flux de poches, lus dans
    // une table indexée **par jour** — c'est ce que vérifient les tests de
    // flux ci-dessus, et c'est la vraie raison pour laquelle la boucle avance
    // jour par jour.
    const hebdo = e.buildSeries(FROM, TO, "week");
    const vendredi = hebdo.find((p) => p.day === "2024-04-12")!;
    const jourRef = e
      .buildSeries("2024-04-12", "2024-04-12", "day")[0]!;
    expect(vendredi.positionsCostBasis).toBeCloseTo(jourRef.positionsCostBasis, 6);
    expect(vendredi.positionsCostBasis).toBeCloseTo(10 * 100 + 7 * 118, 6);
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

/*
  Le libellé d'une barre hebdomadaire.

  Une barre au pas semaine porte la performance et les flux de sept jours.
  L'annoncer par la seule date du point ferait lire ce mouvement comme celui
  d'un seul jour — et pour la borne d'ouverture de la fenêtre, qui ne tombe
  pas toujours un vendredi, comme celui d'une semaine qui commencerait un
  mercredi.
*/
describe("navPointPeriodLabel — ce qu'une barre désigne", () => {
  const pt = (day: string, intervalType: "day" | "week") =>
    ({ day, intervalType }) as unknown as Parameters<
      typeof navPointPeriodLabel
    >[0];

  it("au pas quotidien, la barre porte son jour", () => {
    expect(navPointPeriodLabel(pt("2026-09-04", "day"))).toBe("2026-09-04");
  });

  it("au pas hebdomadaire, elle porte la semaine qu'elle couvre — lundi 00:00 → lundi 00:00 suivant", () => {
    // 2026-09-04 est un vendredi, jour d'émission normal du pas hebdomadaire ;
    // le lundi qui ouvre sa semaine est le 2026-08-31.
    expect(navPointPeriodLabel(pt("2026-09-04", "week"))).toBe(
      "semaine du lundi 2026-08-31"
    );
  });

  it("un point qui ne tombe pas un vendredi (la borne d'ouverture) est rattaché à son lundi", () => {
    // Le point du mercredi 2 sept. ne peut être émis que comme borne
    // d'ouverture de fenêtre ; il appartient à la même semaine civile que le
    // vendredi 4 septembre, donc au même lundi.
    expect(navPointPeriodLabel(pt("2026-09-02", "week"))).toBe(
      "semaine du lundi 2026-08-31"
    );
  });

  it("mondayOfWeek est stable un lundi et traverse les mois", () => {
    expect(mondayOfWeek("2026-08-31")).toBe("2026-08-31");
    expect(mondayOfWeek("2026-01-01")).toBe("2025-12-29");
  });
});

/*
  D26 point 3 — la raison d'être du changement de jour d'émission.

  Le jeu `demo` ne suffit pas à observer l'effet : ses `AssetDailyClose` sont
  seedées pour **tous** les jours de la semaine, week-ends compris (vérifié en
  base — `source: "seed"` un samedi et un dimanche), ce qui masque le problème
  que cette section reproduit avec des cours réalistes, collectés seulement
  les jours ouvrés (lundi à vendredi). C'est le cas réel : aucun fournisseur
  de cours ne cote un dimanche.
*/
describe("D26 — un vendredi trouve sa clôture, là où un dimanche ne le pouvait pas", () => {
  const FROM3 = "2024-03-04"; // lundi
  const TO3 = "2024-05-10"; // vendredi, dix semaines pleines

  function ouvrablesSeulement(): PortfolioValuationEngine {
    const closes = new Map<string, number>();
    enumerateDays(FROM3, TO3).forEach((day, i) => {
      const [y, m, dd] = day.split("-").map(Number);
      const weekday = new Date(Date.UTC(y!, m! - 1, dd!, 12)).getUTCDay();
      if (weekday === 0 || weekday === 6) return; // aucun cours le week-end.
      closes.set(day, 100 + i / 10);
    });
    return new PortfolioValuationEngine(
      inputs({
        transactions: [buy("t1", FROM3, 10, 100)],
        assetClassById: new Map([["aapl", "ACTIONS"]]),
        rawAssetClassById: new Map([["aapl", "ACTIONS"]]),
        holdingMetaById: new Map([["aapl", { accountType: "CTO" }]]),
        closes: new Map([["aapl", closes]]),
      })
    );
  }

  it("un dimanche de la fenêtre n'a réellement aucun cours (le jeu de test, contrairement à `demo`, ne triche pas)", () => {
    const e = ouvrablesSeulement();
    expect(e.dailyCloses().get("aapl")?.has("2024-03-10")).toBe(false); // dimanche
    expect(e.dailyCloses().get("aapl")?.has("2024-03-08")).toBe(true); // vendredi
  });

  it("chaque point hebdomadaire (vendredi) trouve sa clôture exacte du jour", () => {
    const e = ouvrablesSeulement();
    const hebdo = e.buildSeries(FROM3, TO3, "week");
    expect(hebdo.length).toBeGreaterThan(5);
    for (const p of hebdo) {
      expect(p.status).toBe("EXACT");
      expect(p.estimatedComponents).not.toContain("securities");
    }
  });
});
