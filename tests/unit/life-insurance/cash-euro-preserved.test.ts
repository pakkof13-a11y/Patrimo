import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un montant hérité ambigu ne doit pas être effacé sur une présomption.
 *
 * `cashEuro` était remis à zéro dès qu'un fonds euro existait par ailleurs,
 * « sur la foi de ce support » — sans qu'aucune position n'ait été créée pour
 * lui. Sur le contrat Spirica du compte de démonstration, `--apply` aurait
 * effacé 15 200 € au profit d'une position de 25 500 € dont rien ne prouve
 * qu'elle porte les mêmes euros : les deux montants diffèrent, et le
 * rapprochement repose sur un nom.
 *
 * La correction précédente empêchait déjà le doublon — le champ n'est pas
 * recréé en position. Elle laissait ouverte la perte symétrique : ne rien
 * créer, et effacer quand même. La règle retenue ferme les deux : on ne solde
 * le champ que lorsque **sa** position a été écrite.
 *
 * Le montant conservé ne double pas le patrimoine : `getExplicitCashTotalEur`
 * n'interroge pas la table AV (cf. `cash-excludes-av`), et l'API annonce le
 * reliquat hors encours sous `legacyOutstandingEur`.
 */

const lifeInsuranceFindMany = vi.fn();
const lifeInsuranceUpdateMany = vi.fn();
const supportFindMany = vi.fn();
const productDeleteMany = vi.fn();
const platformFindFirst = vi.fn();
const getHoldings = vi.fn();
const createTransaction = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    lifeInsurance: {
      findMany: (...a: unknown[]) => lifeInsuranceFindMany(...a),
      updateMany: (...a: unknown[]) => lifeInsuranceUpdateMany(...a),
    },
    lifeInsuranceSupport: { findMany: (...a: unknown[]) => supportFindMany(...a) },
    lifeInsuranceProduct: { deleteMany: (...a: unknown[]) => productDeleteMany(...a) },
    platform: { findFirst: (...a: unknown[]) => platformFindFirst(...a) },
    asset: { create: async () => ({ id: "asset-neuf" }) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        asset: { create: async () => ({ id: "asset-neuf" }) },
        lifeInsuranceSupport: { create: async () => ({ id: "sup-neuf" }) },
      }),
  },
}));

vi.mock("@/app/lib/portfolio/service", () => ({
  getHoldings: (...a: unknown[]) => getHoldings(...a),
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTransaction(...a),
}));

import { migrateLifeInsuranceToLedger } from "@/app/lib/life-insurance/migrate-to-ledger";

const USER = "u1";
const SPIRICA = "contrat-spirica";
const GENERALI = "contrat-generali";

const dec = (v: string) => ({ toString: () => v });

/** Un contrat de la table historique, réduit aux champs que lit la migration. */
function contrat(id: string, insurer: string, cashEuro: string) {
  return {
    id,
    insurer,
    cashEuro: dec(cashEuro),
    currency: "EUR",
    openDate: new Date("2015-03-01"),
    products: [],
  };
}

/** Une position du journal rattachée à un contrat. */
function positionAV(assetId: string, name: string, valueEur: string) {
  return {
    assetId,
    name,
    accountType: "AV",
    marketValueEur: valueEur,
  };
}

beforeEach(() => {
  lifeInsuranceFindMany.mockReset().mockResolvedValue([]);
  lifeInsuranceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  supportFindMany.mockReset().mockResolvedValue([]);
  productDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  platformFindFirst.mockReset().mockResolvedValue({ id: "plat-1" });
  getHoldings.mockReset().mockResolvedValue([]);
  createTransaction.mockReset().mockResolvedValue({ id: "tx-1" });
});

/** Le contrat porte 15 200 € au champ, et un fonds euro de 25 500 € au journal. */
function scenarioSpirica() {
  lifeInsuranceFindMany.mockResolvedValue([
    contrat(SPIRICA, "Spirica", "15200"),
  ]);
  getHoldings.mockResolvedValue([
    positionAV("a-fe", "Fonds euro Spirica", "25500"),
  ]);
  supportFindMany.mockResolvedValue([{ lifeInsuranceId: SPIRICA }]);
}

describe("contrat ambigu : fonds euro déjà au journal", () => {
  it("ne crée aucune position supplémentaire", async () => {
    scenarioSpirica();
    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(0);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("ne solde pas le champ : les 15 200 € survivent", async () => {
    /*
      Le point de ce test. Aucune écriture ne doit remettre `cashEuro` à zéro
      tant qu'aucune position ne porte ce montant.
    */
    scenarioSpirica();
    await migrateLifeInsuranceToLedger(USER);
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });

  it("relancer la migration ne change rien de plus", async () => {
    scenarioSpirica();
    await migrateLifeInsuranceToLedger(USER);
    await migrateLifeInsuranceToLedger(USER);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });
});

describe("contrat sans ambiguïté", () => {
  it("reprend le fonds euro, puis solde le champ", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(GENERALI, "Generali", "5000"),
    ]);

    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.created).toBe(1);
    expect(createTransaction).toHaveBeenCalledTimes(1);
    expect(lifeInsuranceUpdateMany).toHaveBeenCalledTimes(1);
    const arg = lifeInsuranceUpdateMany.mock.calls[0][0] as {
      where: { id: string };
      data: { cashEuro: { toString(): string } };
    };
    expect(arg.where.id).toBe(GENERALI);
    expect(arg.data.cashEuro.toString()).toBe("0");
  });

  it("un fonds euro sur un AUTRE contrat ne solde pas celui-ci", async () => {
    /*
      Le piège symétrique : le journal est rapproché contre un pool commun.
      Conclure au doublon depuis la position d'un autre contrat effacerait un
      `cashEuro` parfaitement légitime.
    */
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(GENERALI, "Generali", "5000"),
    ]);
    getHoldings.mockResolvedValue([
      positionAV("a-fe", "Fonds euro Spirica", "25500"),
    ]);
    supportFindMany.mockResolvedValue([{ lifeInsuranceId: SPIRICA }]);

    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(1);
  });
});

describe("échec de reprise", () => {
  it("n'efface pas le champ quand la position n'a pas pu être écrite", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(GENERALI, "Generali", "5000"),
    ]);
    createTransaction.mockRejectedValue(new Error("journal indisponible"));

    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.errors.length).toBe(1);
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });
});

describe("simulation", () => {
  it("n'écrit rien du tout", async () => {
    scenarioSpirica();
    await migrateLifeInsuranceToLedger(USER, { dryRun: true });
    expect(createTransaction).not.toHaveBeenCalled();
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
    expect(productDeleteMany).not.toHaveBeenCalled();
  });
});
