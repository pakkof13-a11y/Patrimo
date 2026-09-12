import { describe, expect, it, vi } from "vitest";

/**
 * Lecture des entrées d'épargne salariale : séparateurs décimaux, formats de
 * date, et jour civil.
 *
 * Les trois défauts couverts ici laissaient passer une valeur fausse en
 * silence : un montant français ramené à zéro, une date française ramenée à
 * `null`, une année civile lue dans le fuseau du serveur.
 */

const createMany = vi.fn();
createMany.mockImplementation(({ data }: { data: unknown[] }) => ({
  count: data.length,
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    employeeSavingsLine: {
      createMany: (arg: { data: unknown[] }) => createMany(arg),
      create: vi.fn(),
    },
  },
}));

const { importEmployeeSavingsLines } = await import(
  "@/app/lib/employee-savings/service"
);
const { num, groupIntoPlans } = await import(
  "@/app/lib/employee-savings/overview"
);
import type { OverviewLine } from "@/app/lib/employee-savings/overview";
const { buildUnlockTimeline, startOfDay, addYears } = await import(
  "@/app/lib/employee-savings/logic"
);
const { parseEmployeeSavingsCsv } = await import(
  "@/app/lib/employee-savings/csv"
);

type Written = {
  units: { toString(): string };
  nav: { toString(): string };
  contributedAmount: { toString(): string } | null;
  contributionDate: Date | null;
  unlockDate: Date | null;
};

async function writeOne(over: Record<string, unknown>): Promise<Written> {
  createMany.mockClear();
  const res = await importEmployeeSavingsLines("u1", [
    {
      planType: "PEE",
      manager: "Amundi",
      fundName: "Amundi Label Actions",
      units: "10",
      nav: "12.5",
      ...over,
    },
  ]);
  expect(res.errors).toEqual([]);
  return createMany.mock.calls[0][0].data[0] as Written;
}

describe("montants : séparateurs milliers / décimales", () => {
  it("lit un montant français sans le ramener à zéro", async () => {
    // « 1.234,56 » : le remplacement d'une seule virgule en faisait
    // « 1.234.56 », donc NaN, donc zéro — un versement effacé.
    const row = await writeOne({ nav: "1.234,56", contributedAmount: "1.234,56" });
    expect(row.nav.toString()).toBe("1234.56");
    expect(row.contributedAmount?.toString()).toBe("1234.56");
  });

  it("lit aussi l'écriture anglaise et l'espace insécable", async () => {
    const row = await writeOne({ nav: "1,234.56", contributedAmount: "1 234,56 €" });
    expect(row.nav.toString()).toBe("1234.56");
    expect(row.contributedAmount?.toString()).toBe("1234.56");
  });

  it("garde la précision d'une écriture déjà canonique", async () => {
    const row = await writeOne({ units: "12.123456789012" });
    expect(row.units.toString()).toBe("12.123456789012");
  });

  it("une entrée vide reste « non renseigné », jamais zéro", async () => {
    const row = await writeOne({ contributedAmount: "" });
    expect(row.contributedAmount).toBeNull();
  });

  it("num() de la vue d'ensemble suit la même lecture", () => {
    expect(num("1.234,56")).toBe(1234.56);
    expect(num("1,234.56")).toBe(1234.56);
    expect(num("6000")).toBe(6000);
    expect(num(null)).toBe(0);
  });
});

describe("dates : JJ/MM/AAAA, ISO, et refus explicite", () => {
  it("accepte le format français des relevés", async () => {
    const row = await writeOne({ unlockDate: "31/12/2030" });
    expect(row.unlockDate?.toISOString()).toBe("2030-12-31T00:00:00.000Z");
  });

  it("accepte l'ISO", async () => {
    const row = await writeOne({ contributionDate: "2021-06-15" });
    expect(row.contributionDate?.toISOString()).toBe("2021-06-15T00:00:00.000Z");
  });

  it("un format illisible est une erreur de ligne, pas un null silencieux", async () => {
    const res = await importEmployeeSavingsLines("u1", [
      {
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Label Actions",
        contributionDate: "hier",
      },
    ]);
    expect(res.created).toBe(0);
    expect(res.errors[0].message).toContain("Date de versement");
    expect(res.errors[0].message).toContain("format de date non reconnu");
  });

  it("une date qui n'existe pas est refusée, pas reportée au mois suivant", async () => {
    const res = await importEmployeeSavingsLines("u1", [
      {
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Label Actions",
        unlockDate: "31/02/2024",
      },
    ]);
    expect(res.errors[0].message).toContain("date inexistante");
  });

  it("le déblocage PEE à +5 ans reste sur le même jour civil", async () => {
    const row = await writeOne({ contributionDate: "01/01/2021" });
    expect(row.unlockDate?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("jour civil : une seule base, UTC", () => {
  it("startOfDay et addYears raisonnent en UTC", () => {
    expect(startOfDay(new Date("2026-01-01T00:30:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z"
    );
    expect(addYears(new Date("2021-01-01T00:00:00.000Z"), 5).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("un déblocage au 1er janvier se range dans son millésime", () => {
    const buckets = buildUnlockTimeline([
      {
        marketValue: 100,
        liquidityStatus: "BLOCKED",
        unlockMode: "DATE",
        unlockDate: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]);
    expect(buckets.find((b) => b.key === "2027")?.amount).toBe("100.00");
  });

  it("un versement du 1er janvier compte dans l'année en cours", () => {
    const line = (over: Partial<OverviewLine>): OverviewLine => ({
      id: "l1",
      planType: "PEE",
      manager: "Amundi",
      fundName: "FCPE",
      fundCategory: null,
      units: "10",
      nav: "100",
      currency: "EUR",
      sourceType: "PARTICIPATION",
      contributionDate: null,
      contributedAmount: null,
      unlockDate: null,
      unlockMode: "DATE",
      marketValue: "1000",
      liquidityStatus: "BLOCKED",
      unlockLabel: "n/a",
      ...over,
    });
    const plans = groupIntoPlans(
      [
        line({
          contributedAmount: "1000",
          contributionDate: "2026-01-01T00:00:00.000Z",
        }),
        line({
          id: "l2",
          contributedAmount: "4000",
          contributionDate: "2025-12-31T00:00:00.000Z",
        }),
      ],
      new Date("2026-01-01T00:00:00.000Z")
    );
    expect(plans[0].contributedThisYear).toBe(1000);
    expect(plans[0].contributed).toBe(5000);
  });
});

describe("CSV : parseur partagé", () => {
  it("lit des en-têtes accentués et un montant français", () => {
    const csv = `Gestionnaire;Fonds;Quantité;VL;Montant versé;Date versement
Amundi;FCPE Actions;12,5;28,40;1.234,56;31/12/2021
`;
    const { rows, errors, delimiter } = parseEmployeeSavingsCsv(csv);
    expect(errors).toEqual([]);
    expect(delimiter).toBe(";");
    expect(rows).toHaveLength(1);
    expect(rows[0].manager).toBe("Amundi");
    expect(rows[0].units).toBe("12,5");
    expect(rows[0].contributedAmount).toBe("1.234,56");
    expect(rows[0].contributionDate).toBe("31/12/2021");
  });

  it("récupère une ligne recollée par Excel en une seule cellule", () => {
    const csv = `plan_type,manager,fund_name,units,nav
"PEE,Amundi,FCPE Actions,10,12.5"
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0].manager).toBe("Amundi");
    expect(rows[0].fundName).toBe("FCPE Actions");
  });

  it("situe l'erreur sur sa ligne, en-tête comprise", () => {
    const csv = `plan_type;manager;fund_name;units;nav
PEE;Amundi;FCPE A;10;12.5
PEE;;FCPE B;10;12.5
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([{ line: 3, message: "manager et fund_name requis" }]);
  });
});
