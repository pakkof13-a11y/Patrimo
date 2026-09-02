import { describe, expect, it } from "vitest";
import {
  buildContributionSeries,
  computeAllocation,
  computeTotals,
  groupIntoPlans,
  nextUnlock,
  planTitle,
  rangeStartDay,
  recentContributions,
  sliceSeries,
  type OverviewLine,
} from "@/app/lib/employee-savings/overview";

function line(over: Partial<OverviewLine> = {}): OverviewLine {
  const units = over.units ?? "10";
  const nav = over.nav ?? "100";
  return {
    id: over.id ?? "l1",
    planType: over.planType ?? "PEE",
    manager: over.manager ?? "Amundi",
    fundName: over.fundName ?? "Amundi Label Actions Euro",
    fundCategory: "fundCategory" in over ? over.fundCategory! : null,
    units,
    nav,
    currency: over.currency ?? "EUR",
    sourceType: over.sourceType ?? "PARTICIPATION",
    contributionDate:
      "contributionDate" in over
        ? over.contributionDate!
        : "2024-06-15T00:00:00.000Z",
    contributedAmount:
      "contributedAmount" in over ? over.contributedAmount! : null,
    unlockDate: "unlockDate" in over ? over.unlockDate! : null,
    unlockMode: over.unlockMode ?? "DATE",
    marketValue: over.marketValue ?? String(Number(units) * Number(nav)),
    liquidityStatus: over.liquidityStatus ?? "BLOCKED",
    unlockLabel: over.unlockLabel ?? "—",
  };
}

describe("computeTotals", () => {
  it("somme l'encours et sépare disponible et bloqué", () => {
    const totals = computeTotals([
      line({ marketValue: "1000", liquidityStatus: "AVAILABLE" }),
      line({ id: "l2", marketValue: "3000", liquidityStatus: "BLOCKED" }),
    ]);
    expect(totals.totalValue).toBe(4000);
    expect(totals.availableValue).toBe(1000);
    expect(totals.blockedValue).toBe(3000);
    expect(totals.availablePct).toBe(25);
  });

  it("ne calcule ni gain ni performance sans montant versé", () => {
    // `parts × VL` dit ce que ça vaut, jamais ce que ça a coûté : annoncer un
    // gain reviendrait à présenter tout l'encours comme un profit.
    const totals = computeTotals([line({ marketValue: "5000" })]);
    expect(totals.contributed).toBeNull();
    expect(totals.gain).toBeNull();
    expect(totals.gainPct).toBeNull();
    expect(totals.linesMissingContribution).toBe(1);
  });

  it("calcule le gain dès qu'un montant versé est connu", () => {
    const totals = computeTotals([
      line({ marketValue: "6000", contributedAmount: "5000" }),
    ]);
    expect(totals.contributed).toBe(5000);
    expect(totals.gain).toBe(1000);
    expect(totals.gainPct).toBeCloseTo(20, 9);
  });

  it("chiffre les lignes incomplètes plutôt que de les ignorer en silence", () => {
    const totals = computeTotals([
      line({ marketValue: "6000", contributedAmount: "5000" }),
      line({ id: "l2", marketValue: "2000" }),
    ]);
    // Le gain porte sur ce qui est connu ; l'écran doit pouvoir dire qu'il est
    // partiel, d'où le compte des lignes sans montant.
    expect(totals.contributed).toBe(5000);
    expect(totals.linesMissingContribution).toBe(1);
  });

  it("ne divise pas par zéro sur un portefeuille vide", () => {
    const totals = computeTotals([]);
    expect(totals.totalValue).toBe(0);
    expect(totals.availablePct).toBeNull();
    expect(totals.planCount).toBe(0);
  });
});

describe("computeAllocation", () => {
  it("range les supports par famille, dans un ordre fixe", () => {
    const slices = computeAllocation([
      line({ fundName: "Amundi Monétaire", marketValue: "1000" }),
      line({ id: "l2", fundName: "Amundi Actions Monde", marketValue: "3000" }),
    ]);
    // Actions d'abord malgré l'ordre de saisie : la lecture va du plus exposé
    // au moins exposé, et la couleur d'une famille ne doit pas se déplacer.
    expect(slices.map((s) => s.category)).toEqual(["EQUITY", "MONETARY"]);
    expect(slices[0]!.sharePct).toBe(75);
  });

  it("signale les familles déduites du nom du fonds", () => {
    const [slice] = computeAllocation([line({ fundName: "Actions Monde" })]);
    expect(slice!.hasInferred).toBe(true);

    const [declared] = computeAllocation([
      line({ fundCategory: "EQUITY", fundName: "Actions Monde" }),
    ]);
    expect(declared!.hasInferred).toBe(false);
  });

  it("ne crée pas de part pour une famille absente", () => {
    const slices = computeAllocation([line({ fundName: "Amundi Monétaire" })]);
    expect(slices).toHaveLength(1);
  });
});

describe("groupIntoPlans", () => {
  const now = new Date("2026-07-31T12:00:00Z");

  it("regroupe les lots par enveloppe et gestionnaire", () => {
    const plans = groupIntoPlans(
      [
        line({ planType: "PEE", manager: "Amundi", marketValue: "1000" }),
        line({ id: "l2", planType: "PEE", manager: "Amundi", marketValue: "2000" }),
        line({ id: "l3", planType: "PER", manager: "Natixis", marketValue: "5000" }),
      ],
      now
    );
    expect(plans).toHaveLength(2);
    expect(plans[0]!.planType).toBe("PER");
    expect(plans[0]!.value).toBe(5000);
    expect(plans[1]!.value).toBe(3000);
  });

  it("garde distincts deux PEE chez deux gestionnaires", () => {
    // Le cas d'un salarié qui a changé d'employeur : ce sont bien deux plans.
    const plans = groupIntoPlans(
      [
        line({ planType: "PEE", manager: "Amundi", marketValue: "1000" }),
        line({ id: "l2", planType: "PEE", manager: "Natixis", marketValue: "900" }),
      ],
      now
    );
    expect(plans).toHaveLength(2);
  });

  it("ne compte dans l'année que les versements de l'année", () => {
    const plans = groupIntoPlans(
      [
        line({
          contributedAmount: "1000",
          contributionDate: "2026-03-01T00:00:00.000Z",
        }),
        line({
          id: "l2",
          contributedAmount: "4000",
          contributionDate: "2024-03-01T00:00:00.000Z",
        }),
      ],
      now
    );
    expect(plans[0]!.contributedThisYear).toBe(1000);
    expect(plans[0]!.contributed).toBe(5000);
  });

  it("retient la prochaine échéance et le blocage retraite", () => {
    const plans = groupIntoPlans(
      [
        line({ unlockDate: "2029-01-01T00:00:00.000Z" }),
        line({ id: "l2", unlockDate: "2027-05-01T00:00:00.000Z" }),
        line({ id: "l3", unlockMode: "RETIREMENT", unlockDate: null }),
      ],
      now
    );
    expect(plans[0]!.nextUnlockDate?.slice(0, 10)).toBe("2027-05-01");
    expect(plans[0]!.hasRetirementLock).toBe(true);
  });

  it("ignore les échéances déjà passées", () => {
    const plans = groupIntoPlans(
      [line({ unlockDate: "2020-01-01T00:00:00.000Z" })],
      now
    );
    expect(plans[0]!.nextUnlockDate).toBeNull();
  });
});

describe("planTitle", () => {
  it("rend le nom long sans répéter le sigle", () => {
    expect(planTitle("PEE")).toBe("Plan d'épargne entreprise");
    expect(planTitle("PERCO")).toBe("Plan d'épargne retraite collectif");
  });

  it("laisse passer un type inconnu tel quel", () => {
    expect(planTitle("PEI")).toBe("PEI");
  });
});

describe("buildContributionSeries", () => {
  it("cumule les versements dans l'ordre des dates", () => {
    const series = buildContributionSeries([
      line({ contributedAmount: "1000", contributionDate: "2024-06-15T00:00:00.000Z" }),
      line({ id: "l2", contributedAmount: "500", contributionDate: "2023-01-10T00:00:00.000Z" }),
    ]);
    expect(series.map((p) => p.day)).toEqual(["2023-01-10", "2024-06-15"]);
    expect(series.map((p) => p.cumulative)).toEqual([500, 1500]);
  });

  it("agrège les versements d'un même jour", () => {
    const series = buildContributionSeries([
      line({ contributedAmount: "1000", contributionDate: "2024-06-15T00:00:00.000Z" }),
      line({ id: "l2", contributedAmount: "200", contributionDate: "2024-06-15T09:00:00.000Z" }),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]!.amount).toBe(1200);
  });

  it("ignore les lots sans date ou sans montant plutôt que de les dater au hasard", () => {
    const series = buildContributionSeries([
      line({ contributedAmount: null, contributionDate: "2024-06-15T00:00:00.000Z" }),
      line({ id: "l2", contributedAmount: "500", contributionDate: null }),
    ]);
    expect(series).toEqual([]);
  });
});

describe("sliceSeries / rangeStartDay", () => {
  const now = new Date("2026-07-31T12:00:00Z");
  const series = buildContributionSeries([
    line({ contributedAmount: "1000", contributionDate: "2023-01-10T00:00:00.000Z" }),
    line({ id: "l2", contributedAmount: "500", contributionDate: "2026-03-01T00:00:00.000Z" }),
    line({ id: "l3", contributedAmount: "500", contributionDate: "2026-07-01T00:00:00.000Z" }),
  ]);

  it("garde le point qui précède la fenêtre", () => {
    // Sans lui, la courbe partirait de zéro et laisserait croire que toute
    // l'épargne a été versée pendant la période affichée.
    const ytd = sliceSeries(series, "ytd", now);
    expect(ytd[0]!.day).toBe("2023-01-10");
    expect(ytd).toHaveLength(3);
  });

  it("borne les fenêtres au bon jour", () => {
    expect(rangeStartDay("1m", now)).toBe("2026-06-30");
    expect(rangeStartDay("ytd", now)).toBe("2026-01-01");
    expect(rangeStartDay("5y", now)).toBe("2021-07-31");
    expect(rangeStartDay("all", now)).toBeNull();
  });

  it("rend toute la série pour « Tout »", () => {
    expect(sliceSeries(series, "all", now)).toHaveLength(3);
  });
});

describe("nextUnlock", () => {
  const now = new Date("2026-07-31T00:00:00Z");

  it("retient la première échéance à venir et son montant", () => {
    const next = nextUnlock(
      [
        line({ unlockDate: "2027-05-01T00:00:00.000Z", marketValue: "2000" }),
        line({ id: "l2", unlockDate: "2029-01-01T00:00:00.000Z", marketValue: "9000" }),
      ],
      now
    );
    expect(next?.dateIso.slice(0, 10)).toBe("2027-05-01");
    expect(next?.amount).toBe(2000);
    expect(next?.daysAway).toBe(274);
  });

  it("additionne les lots qui se débloquent le même jour", () => {
    const next = nextUnlock(
      [
        line({ unlockDate: "2027-05-01T00:00:00.000Z", marketValue: "2000" }),
        line({ id: "l2", unlockDate: "2027-05-01T00:00:00.000Z", marketValue: "1000" }),
      ],
      now
    );
    expect(next?.amount).toBe(3000);
    expect(next?.lineCount).toBe(2);
  });

  it("ne rend rien quand tout est disponible ou bloqué jusqu'à la retraite", () => {
    expect(
      nextUnlock([line({ unlockMode: "RETIREMENT", unlockDate: null })], now)
    ).toBeNull();
    expect(
      nextUnlock([line({ unlockDate: "2020-01-01T00:00:00.000Z" })], now)
    ).toBeNull();
  });
});

describe("recentContributions", () => {
  it("classe du plus récent au plus ancien et borne la liste", () => {
    const ops = recentContributions(
      [
        line({ id: "a", contributionDate: "2024-01-01T00:00:00.000Z" }),
        line({ id: "b", contributionDate: "2026-01-01T00:00:00.000Z" }),
        line({ id: "c", contributionDate: "2025-01-01T00:00:00.000Z" }),
      ],
      2
    );
    expect(ops.map((o) => o.id)).toEqual(["b", "c"]);
  });

  it("laisse le montant à null quand il n'est pas renseigné", () => {
    const [op] = recentContributions([line({ contributedAmount: null })]);
    expect(op!.amount).toBeNull();
    expect(op!.sourceLabel).toBe("Participation");
  });

  it("écarte les lots sans date", () => {
    expect(recentContributions([line({ contributionDate: null })])).toEqual([]);
  });
});
