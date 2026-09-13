import { describe, expect, it, vi } from "vitest";
import { parseEmployeeSavingsCsv } from "../../../app/lib/employee-savings/csv";

/**
 * ES-01/ES-02/ES-03 (finance-metier) : trois replis silencieux qui écrivaient
 * une donnée plausible et fausse plutôt que de refuser une ligne.
 */

const createMany = vi.fn();

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

const row = (over: Record<string, unknown> = {}) => ({
  planType: "PEE",
  manager: "Amundi",
  fundName: "Amundi Label Actions",
  units: "10",
  nav: "12.5",
  ...over,
});

describe("ES-01 : PERECO classé PEE", () => {
  it("classe PERECO en PERCO, pas en PEE", () => {
    const csv = `plan_type;manager;fund_name;units;nav
PERECO;Amundi;FCPE Diversifié;10;10
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.planType).toBe("PERCO");
  });

  it.each(["PER COL", "PERCOL", "PER Collectif"])(
    "classe « %s » en PERCO",
    (libelle) => {
      const csv = `plan_type;manager;fund_name;units;nav\n${libelle};Amundi;FCPE Diversifié;10;10\n`;
      const { rows, errors } = parseEmployeeSavingsCsv(csv);
      expect(errors).toEqual([]);
      expect(rows[0]!.planType).toBe("PERCO");
    }
  );

  it("un plan_type non vide et non reconnu est une erreur de ligne, pas un repli PEE", () => {
    const csv = `plan_type;manager;fund_name;units;nav
XYZ;Amundi;FCPE Diversifié;10;10
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]!.message).toContain("plan_type");
    expect(errors[0]!.message).toContain("XYZ");
  });

  it("une colonne plan_type vide reste un repli légitime vers PEE", () => {
    const csv = `plan_type;manager;fund_name;units;nav
;Amundi;FCPE Diversifié;10;10
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(errors).toEqual([]);
    expect(rows[0]!.planType).toBe("PEE");
  });

  it("un source_type non vide et non reconnu est une erreur de ligne, pas un repli VOLUNTARY", () => {
    const csv = `plan_type;manager;fund_name;units;nav;source_type
PEE;Amundi;FCPE Diversifié;10;10;INCONNU
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]!.message).toContain("source_type");
    expect(errors[0]!.message).toContain("INCONNU");
  });

  it("planType/sourceType/unlockMode hors liste sont refusés côté service (chemin JSON direct)", async () => {
    createMany.mockClear();
    const res = await importEmployeeSavingsLines("u1", [row({ planType: "XYZ" })]);
    expect(res.created).toBe(0);
    expect(res.errors[0]!.message).toContain("plan_type");
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("ES-02 : devise libre à l'écriture", () => {
  it("rejette une devise hors liste à l'écriture, avec un message nommé", async () => {
    createMany.mockClear();
    const res = await importEmployeeSavingsLines("u1", [row({ currency: "SEK" })]);
    expect(res.created).toBe(0);
    expect(res.errors[0]!.message).toContain("currency");
    expect(res.errors[0]!.message).toContain("SEK");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("accepte une devise de la liste blanche", async () => {
    createMany.mockClear();
    createMany.mockImplementation(({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    const res = await importEmployeeSavingsLines("u1", [row({ currency: "CHF" })]);
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
  });
});

describe("ES-03 : repli silencieux sur 0", () => {
  it("colonne units absente de l'en-tête : erreur fichier, pas une ligne à 0", () => {
    const csv = `plan_type;manager;fund_name;nav
PEE;Amundi;FCPE Test;10
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(0);
    expect(errors[0]!.message).toContain("units");
  });

  it("colonne nav absente de l'en-tête : erreur fichier", () => {
    const csv = `plan_type;manager;fund_name;units
PEE;Amundi;FCPE Test;10
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(rows).toHaveLength(0);
    expect(errors[0]!.message).toContain("nav");
  });

  it("une valeur units illisible est une erreur de ligne nommée, pas un repli à 0", async () => {
    createMany.mockClear();
    const res = await importEmployeeSavingsLines("u1", [row({ units: "abc" })]);
    expect(res.created).toBe(0);
    expect(res.errors[0]!.message).toBe("units : valeur illisible (abc)");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("une cellule units vide (colonne présente) est une erreur de ligne, pas un repli à 0", async () => {
    createMany.mockClear();
    const res = await importEmployeeSavingsLines("u1", [row({ units: "" })]);
    expect(res.created).toBe(0);
    expect(res.errors[0]!.message).toContain("units");
    expect(createMany).not.toHaveBeenCalled();
  });

  it("un 0 explicitement saisi reste accepté", async () => {
    createMany.mockClear();
    createMany.mockImplementation(({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
    const res = await importEmployeeSavingsLines("u1", [row({ units: "0" })]);
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
  });

  it("bout en bout : une cellule 'abc' dans units via CSV est une erreur de ligne", async () => {
    const csv = `plan_type;manager;fund_name;units;nav
PEE;Amundi;FCPE Test;abc;10
`;
    const { rows, errors: parseErrors } = parseEmployeeSavingsCsv(csv);
    expect(parseErrors).toEqual([]);
    expect(rows).toHaveLength(1);

    createMany.mockClear();
    const res = await importEmployeeSavingsLines("u1", rows);
    expect(res.created).toBe(0);
    expect(res.errors[0]!.message).toBe("units : valeur illisible (abc)");
  });
});
