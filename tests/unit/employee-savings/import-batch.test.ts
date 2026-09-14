import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * L'import en masse écrit en un seul aller-retour, sans perdre le rapport
 * ligne par ligne : une ligne refusée reste située, et les autres entrent.
 */

const createMany = vi.fn();
const create = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    employeeSavingsLine: {
      createMany: (...args: unknown[]) => createMany(...args),
      create: (...args: unknown[]) => create(...args),
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

describe("importEmployeeSavingsLines", () => {
  beforeEach(() => {
    createMany.mockReset();
    create.mockReset();
    createMany.mockImplementation(({ data }: { data: unknown[] }) => ({
      count: data.length,
    }));
  });

  it("N lignes valides = un seul aller-retour base", async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ fundName: `Fonds ${i}` })
    );

    const res = await importEmployeeSavingsLines("u1", rows);

    expect(res).toEqual({ created: 25, errors: [] });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    expect(createMany.mock.calls[0][0].data).toHaveLength(25);
  });

  it("situe la ligne fautive et importe les autres", async () => {
    const res = await importEmployeeSavingsLines("u1", [
      row(),
      row({ manager: "  " }),
      row({ fundName: "" }),
      row({ contributionDate: "31/02/2024" }),
      row({ contributionDate: "hier" }),
      row(),
    ]);

    expect(res.created).toBe(2);
    expect(res.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(res.errors[0].message).toBe("Gestionnaire requis");
    expect(res.errors[1].message).toBe("Nom du fonds requis");
    expect(res.errors[2].message).toContain("date inexistante");
    expect(res.errors[3].message).toContain("format de date non reconnu");
    // Toujours une seule écriture, malgré quatre refus.
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it("aucune ligne retenue : aucune écriture", async () => {
    const res = await importEmployeeSavingsLines("u1", [row({ manager: "" })]);

    expect(res).toEqual({
      created: 0,
      errors: [{ line: 1, message: "Gestionnaire requis" }],
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it("lot refusé par la base : repli ligne à ligne, erreur imputée", async () => {
    createMany.mockRejectedValue(new Error("value out of range"));
    create.mockImplementation(({ data }: { data: { fundName: string } }) => {
      if (data.fundName === "Fonds 1") throw new Error("value out of range");
      return { id: "x" };
    });

    const res = await importEmployeeSavingsLines("u1", [
      row({ fundName: "Fonds 0" }),
      row({ manager: "" }),
      row({ fundName: "Fonds 1" }),
      row({ fundName: "Fonds 2" }),
    ]);

    expect(res.created).toBe(2);
    expect(res.errors).toEqual([
      { line: 2, message: "Gestionnaire requis" },
      { line: 3, message: "value out of range" },
    ]);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("isolation utilisateur : chaque ligne du lot porte le userId", async () => {
    await importEmployeeSavingsLines("u42", [row(), row()]);

    for (const line of createMany.mock.calls[0][0].data) {
      expect(line.userId).toBe("u42");
    }
  });
});
