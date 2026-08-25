import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le planificateur de loyers touche la base : on isole Prisma et l'écriture au
 * journal pour tester ce qui lui appartient réellement — quelles échéances il
 * propose, ce qu'il refuse d'écrire deux fois, et où avance le curseur.
 */

const detailFindMany = vi.fn();
const detailFindFirst = vi.fn();
const detailUpdate = vi.fn();
const txFindFirst = vi.fn();
const createTx = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    realEstateDetail: {
      findMany: (...a: unknown[]) => detailFindMany(...a),
      findFirst: (...a: unknown[]) => detailFindFirst(...a),
      update: (...a: unknown[]) => detailUpdate(...a),
    },
    transaction: {
      findFirst: (...a: unknown[]) => txFindFirst(...a),
    },
  },
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTx(...a),
}));

import {
  CHARGES_NOTE_PREFIX,
  confirmEntries,
  listPendingEntries,
  RENT_NOTE_PREFIX,
} from "@/app/lib/real-estate/rent-schedule";

const USER = "user-1";
const NOW = new Date("2026-04-20T10:00:00.000Z");

function detail(over: Record<string, unknown> = {}) {
  return {
    assetId: "asset-1",
    usage: "LOCATIF_NU",
    rentDay: 5,
    monthlyRentEur: "850",
    monthlyChargesEur: "95",
    annualPropertyTaxEur: null,
    rentalStartDate: new Date("2026-01-01T00:00:00.000Z"),
    rentalEndDate: null,
    lastRentAppliedAt: null,
    lastChargesAppliedAt: null,
    asset: { name: "Studio Marseille", platformId: "plat-1" },
    ...over,
  };
}

beforeEach(() => {
  detailFindMany.mockReset();
  detailFindFirst.mockReset();
  detailUpdate.mockReset().mockResolvedValue({});
  txFindFirst.mockReset().mockResolvedValue(null);
  createTx.mockReset().mockResolvedValue({ id: "tx-1" });
});

/**
 * Les quatre notions de loyer, tenues séparées.
 *
 * L'audit B2 a établi qu'un loyer contractuel, une échéance due, un loyer
 * confirmé et un loyer encaissé sont quatre faits différents. Le moteur les
 * distingue déjà ; ces tests le figent, pour qu'aucune évolution ne fasse
 * glisser l'un vers l'autre — et surtout pour qu'une échéance échue ne
 * devienne jamais du cash sans confirmation.
 */
describe("échéance ≠ encaissement", () => {
  it("une échéance à venir n'est pas proposée", async () => {
    // Loyer du 5, on est le 20 avril : mai n'a pas à figurer.
    detailFindMany.mockResolvedValue([detail()]);
    const p = await listPendingEntries("u1", { now: NOW });
    const dates = p.map((x) => x.dueDate.slice(0, 10));
    expect(dates.every((d) => d <= "2026-04-20")).toBe(true);
    expect(dates).not.toContain("2026-05-05");
  });

  it("une échéance échue et non confirmée n'écrit rien", async () => {
    /*
      Le point le plus important du module : proposer n'est pas encaisser.
      `listPendingEntries` ne doit ni créer de transaction, ni avancer le
      curseur, ni toucher au cash.
    */
    detailFindMany.mockResolvedValue([detail()]);
    const p = await listPendingEntries("u1", { now: NOW });

    expect(p.length).toBeGreaterThan(0);
    expect(createTx).not.toHaveBeenCalled();
    expect(detailUpdate).not.toHaveBeenCalled();
  });

  it("l'ancienneté ne change pas le traitement d'une échéance", async () => {
    /*
      Une échéance de 2024 reste une proposition, exactement comme celle du
      mois dernier. Le moteur ne la requalifie pas en impayé — cette
      distinction demande une décision métier qui n'est pas prise.
    */
    detailFindMany.mockResolvedValue([
      detail({ rentalStartDate: new Date("2024-03-01T00:00:00.000Z") }),
    ]);
    const p = await listPendingEntries("u1", { now: NOW });
    const loyers = p.filter((x) => x.kind === "RENT");

    expect(loyers.length).toBeGreaterThan(20);
    expect(createTx).not.toHaveBeenCalled();
    // Toutes portent la même forme : aucun statut particulier n'apparaît.
    for (const l of loyers) {
      expect(Object.keys(l).sort()).toEqual(
        ["amountEur", "assetId", "dueDate", "kind", "note", "propertyName"]
      );
    }
  });

  it("seule la confirmation écrit au journal", async () => {
    detailFindFirst.mockResolvedValue(detail());
    await confirmEntries("u1", [
      { assetId: "asset-1", kind: "RENT", dueDate: "2026-03-05T12:00:00.000Z" },
    ]);
    expect(createTx).toHaveBeenCalledTimes(1);
    expect(createTx.mock.calls[0]![0]).toMatchObject({ type: "LOYER" });
  });
});

describe("listPendingEntries", () => {
  it("propose un loyer et une charge par mois échu", async () => {
    detailFindMany.mockResolvedValue([detail()]);

    const pending = await listPendingEntries(USER, { now: NOW });

    const rents = pending.filter((p) => p.kind === "RENT");
    const charges = pending.filter((p) => p.kind === "CHARGES");
    // Bail au 1er janvier, échéance le 5 : janvier à avril.
    expect(rents).toHaveLength(4);
    expect(charges).toHaveLength(4);
    expect(rents[0].amountEur).toBe("850.00");
    expect(charges[0].amountEur).toBe("95.00");
    expect(rents.every((r) => r.dueDate.slice(8, 10) === "05")).toBe(true);
  });

  it("classe les échéances par date", async () => {
    detailFindMany.mockResolvedValue([detail()]);
    const dates = (await listPendingEntries(USER, { now: NOW })).map(
      (p) => p.dueDate
    );
    expect([...dates].sort()).toEqual(dates);
  });

  it("ne propose rien pour une résidence principale, même loyer renseigné", async () => {
    detailFindMany.mockResolvedValue([
      detail({ usage: "RESIDENCE_PRINCIPALE" }),
    ]);
    expect(await listPendingEntries(USER, { now: NOW })).toEqual([]);
  });

  it("ignore un bien sans jour d'encaissement", async () => {
    detailFindMany.mockResolvedValue([detail({ rentDay: null })]);
    expect(await listPendingEntries(USER, { now: NOW })).toEqual([]);
  });

  it("n'invente pas de charges quand elles ne sont pas renseignées", async () => {
    detailFindMany.mockResolvedValue([detail({ monthlyChargesEur: null })]);
    const pending = await listPendingEntries(USER, { now: NOW });
    expect(pending.every((p) => p.kind === "RENT")).toBe(true);
    expect(pending.length).toBeGreaterThan(0);
  });

  it("reprend après le curseur, sans reproposer le déjà confirmé", async () => {
    detailFindMany.mockResolvedValue([
      detail({ lastRentAppliedAt: new Date("2026-03-05T00:00:00.000Z") }),
    ]);
    const rents = (await listPendingEntries(USER, { now: NOW })).filter(
      (p) => p.kind === "RENT"
    );
    expect(rents).toHaveLength(1);
    expect(rents[0].dueDate.slice(0, 7)).toBe("2026-04");
  });

  it("s'arrête à la fin du bail", async () => {
    detailFindMany.mockResolvedValue([
      detail({ rentalEndDate: new Date("2026-02-28T00:00:00.000Z") }),
    ]);
    const rents = (await listPendingEntries(USER, { now: NOW })).filter(
      (p) => p.kind === "RENT"
    );
    expect(rents).toHaveLength(2);
  });

  it("distingue deux biens dont les échéances tombent le même jour", async () => {
    detailFindMany.mockResolvedValue([
      detail(),
      detail({ assetId: "asset-2", asset: { name: "T2 Lyon", platformId: "plat-1" } }),
    ]);
    const notes = (await listPendingEntries(USER, { now: NOW })).map((p) => p.note);
    expect(new Set(notes).size).toBe(notes.length);
  });

  it("n'interroge que les biens de l'utilisateur", async () => {
    detailFindMany.mockResolvedValue([]);
    await listPendingEntries(USER, { now: NOW });
    expect(detailFindMany.mock.calls[0][0].where.asset.is.userId).toBe(USER);
  });
});

describe("confirmEntries", () => {
  const entry = {
    assetId: "asset-1",
    kind: "RENT" as const,
    dueDate: "2026-03-05T00:00:00.000Z",
  };

  it("écrit un LOYER rattaché au bien et avance le curseur", async () => {
    detailFindFirst.mockResolvedValue(detail());

    const res = await confirmEntries(USER, [entry]);

    expect(res).toEqual({ created: 1, skipped: 0, errors: [] });
    const arg = createTx.mock.calls[0][0];
    expect(arg.type).toBe("LOYER");
    expect(arg.assetId).toBe("asset-1");
    expect(arg.cashAmount).toBe("850.00");
    expect(arg.notes).toContain(RENT_NOTE_PREFIX);
    expect(detailUpdate.mock.calls[0][0].data).toHaveProperty(
      "lastRentAppliedAt"
    );
  });

  it("écrit les charges en FRAIS, sans actif", async () => {
    detailFindFirst.mockResolvedValue(detail());

    await confirmEntries(USER, [{ ...entry, kind: "CHARGES" }]);

    const arg = createTx.mock.calls[0][0];
    expect(arg.type).toBe("FRAIS");
    expect(arg.assetId).toBeNull();
    expect(arg.cashAmount).toBe("95.00");
    expect(arg.notes).toContain(CHARGES_NOTE_PREFIX);
  });

  it("porte l'identifiant du bien dans le marqueur — sinon deux biens se confondent", async () => {
    detailFindFirst.mockResolvedValue(detail());
    await confirmEntries(USER, [{ ...entry, kind: "CHARGES" }]);
    expect(createTx.mock.calls[0][0].notes).toContain("asset-1");
  });

  it("ignore une échéance déjà écrite plutôt que de la dupliquer", async () => {
    detailFindFirst.mockResolvedValue(detail());
    txFindFirst.mockResolvedValue({ id: "tx-existant" });

    const res = await confirmEntries(USER, [entry]);

    expect(res).toEqual({ created: 0, skipped: 1, errors: [] });
    expect(createTx).not.toHaveBeenCalled();
    expect(detailUpdate).not.toHaveBeenCalled();
  });

  it("refuse un bien qui n'appartient pas à l'utilisateur", async () => {
    detailFindFirst.mockResolvedValue(null);

    const res = await confirmEntries(USER, [entry]);

    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("introuvable");
    expect(createTx).not.toHaveBeenCalled();
  });

  it("rejette une date d'échéance illisible", async () => {
    detailFindFirst.mockResolvedValue(detail());
    const res = await confirmEntries(USER, [{ ...entry, dueDate: "pas-une-date" }]);
    expect(res.errors[0]).toContain("invalide");
    expect(createTx).not.toHaveBeenCalled();
  });

  it("refuse d'écrire un montant nul", async () => {
    detailFindFirst.mockResolvedValue(detail({ monthlyRentEur: null }));
    const res = await confirmEntries(USER, [entry]);
    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("Montant non renseigné");
  });

  it("n'avance pas le curseur quand l'écriture échoue", async () => {
    detailFindFirst.mockResolvedValue(detail());
    createTx.mockRejectedValue(new Error("solde insuffisant"));

    const res = await confirmEntries(USER, [entry]);

    expect(res.created).toBe(0);
    expect(res.errors[0]).toContain("solde insuffisant");
    expect(detailUpdate).not.toHaveBeenCalled();
  });

  it("poursuit les échéances suivantes après un échec isolé", async () => {
    detailFindFirst.mockResolvedValue(detail());
    createTx
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ id: "tx-2" });

    const res = await confirmEntries(USER, [
      entry,
      { ...entry, dueDate: "2026-04-05T00:00:00.000Z" },
    ]);

    expect(res.created).toBe(1);
    expect(res.errors).toHaveLength(1);
  });
});
