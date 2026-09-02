import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aucun contrat ne doit revendiquer la position d'un autre.
 *
 * Le rapprochement entre la table historique et le journal se fait par **nom**,
 * contre un pool commun à tous les contrats. Il le faut : rien ne relie
 * techniquement un contrat de la table à une plateforme du journal.
 *
 * Mais le nom seul ne dit pas à qui la position appartient, et deux contrats
 * peuvent parfaitement détenir le même support — un ETF World se retrouve dans
 * la moitié des assurances-vie. Le premier contrat servi emporte alors la
 * position, et sa ligne de table est supprimée comme « doublon » d'une position
 * qui n'est pas la sienne. Le second, lui, la migre. Résultat : une valeur
 * historique effacée sans contrepartie, et une position attribuée au mauvais
 * contrat.
 *
 * L'information manquante existe pourtant : `LifeInsuranceSupport.lifeInsuranceId`
 * dit à quel contrat chaque position du journal appartient. Elle n'était lue que
 * pour les fonds euro.
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

import {
  auditLifeInsurance,
  migrateLifeInsuranceToLedger,
} from "@/app/lib/life-insurance/migrate-to-ledger";

const USER = "u1";
/** Volontairement dans cet ordre alphabétique : Aviva est servi en premier. */
const AVIVA = "contrat-aviva";
const ZURICH = "contrat-zurich";

const dec = (v: string) => ({ toString: () => v });

function contrat(
  id: string,
  insurer: string,
  cashEuro: string,
  products: Array<{ id: string; name: string; currentValue: string }> = []
) {
  return {
    id,
    insurer,
    cashEuro: dec(cashEuro),
    currency: "EUR",
    openDate: new Date("2015-03-01"),
    products: products.map((p) => ({ ...p, currentValue: dec(p.currentValue) })),
  };
}

function positionAV(assetId: string, name: string, valueEur: string) {
  return { assetId, name, accountType: "AV", marketValueEur: valueEur };
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

/**
 * Deux contrats détiennent chacun « Amundi World ».
 *
 * Une seule position existe au journal, et elle appartient à Zurich — sa fiche
 * `LifeInsuranceSupport` le dit. Aviva n'a donc rien au journal : son support
 * est à migrer, pas à supprimer.
 */
function scenarioHomonyme() {
  lifeInsuranceFindMany.mockResolvedValue([
    contrat(AVIVA, "Aviva", "0", [
      { id: "prod-aviva", name: "Amundi World", currentValue: "10000" },
    ]),
    contrat(ZURICH, "Zurich", "0", [
      { id: "prod-zurich", name: "Amundi World", currentValue: "40000" },
    ]),
  ]);
  getHoldings.mockResolvedValue([
    positionAV("a-world-zurich", "Amundi World", "40000"),
  ]);
  supportFindMany.mockResolvedValue([
    { lifeInsuranceId: ZURICH, assetId: "a-world-zurich", kind: "UC" },
  ]);
}

describe("un support homonyme n'est pas revendiqué par le mauvais contrat", () => {
  it("Aviva ne prend pas la position de Zurich pour un doublon", async () => {
    scenarioHomonyme();
    const audit = await auditLifeInsurance(USER);

    const aviva = audit.contracts.find((c) => c.lifeInsuranceId === AVIVA)!;
    const zurich = audit.contracts.find((c) => c.lifeInsuranceId === ZURICH)!;

    // Aviva n'a rien au journal : son support est à reprendre.
    expect(aviva.duplicates).toHaveLength(0);
    expect(aviva.toMigrate).toEqual([
      { name: "Amundi World", valueEur: "10000" },
    ]);

    // Zurich, lui, a bien son doublon : table et journal portent la même ligne.
    expect(zurich.duplicates).toHaveLength(1);
    expect(zurich.toMigrate).toHaveLength(0);
  });

  it("la valeur d'Aviva n'est pas effacée comme doublon d'autrui", async () => {
    scenarioHomonyme();
    await migrateLifeInsuranceToLedger(USER);

    /*
      La ligne de table d'Aviva ne doit jamais être supprimée sans qu'une
      position ait été créée pour elle. La supprimer comme doublon d'une
      position appartenant à Zurich ferait disparaître 10 000 € sans trace.
    */
    const supprimees = productDeleteMany.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id
    );
    expect(supprimees).toContain("prod-zurich");
    // Aviva n'est supprimé qu'après création de SA position, pas avant.
    const creees = createTransaction.mock.calls.length;
    expect(creees).toBe(1);
  });

  it("le total à migrer compte la ligne d'Aviva, jamais deux fois celle de Zurich", async () => {
    scenarioHomonyme();
    const audit = await auditLifeInsurance(USER);
    expect(audit.toMigrateEur).toBe("10000.00");
    expect(audit.doubleCountedEur).toBe("40000.00");
  });
});

/**
 * Idempotence : rejouer la migration ne doit rien produire de nouveau.
 *
 * La propriété est structurelle, pas conditionnelle. Une ligne de table migrée
 * est supprimée, un champ `cashEuro` repris est mis à zéro, et un support déjà
 * au journal est reconnu comme tel. Chacun de ces trois états supprime sa propre
 * cause : la seconde passe ne trouve plus de quoi travailler.
 */
describe("rejouer la migration", () => {
  /**
   * Simule l'état de la base après une première migration réussie.
   *
   * La ligne de table a disparu, la position existe au journal et lui est
   * rattachée, le champ a été soldé. C'est exactement ce que `--apply` laisse
   * derrière lui.
   */
  function apresPremierePasse() {
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(AVIVA, "Aviva", "0", []),
    ]);
    getHoldings.mockResolvedValue([
      positionAV("a-fe-aviva", "Fonds euro Aviva", "5000"),
    ]);
    supportFindMany.mockResolvedValue([
      { lifeInsuranceId: AVIVA, assetId: "a-fe-aviva", kind: "FONDS_EURO" },
    ]);
  }

  it("la deuxième passe ne crée rien", async () => {
    apresPremierePasse();
    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(0);
    expect(r.duplicatesRemoved).toBe(0);
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("la troisième passe rend le même état que la deuxième", async () => {
    apresPremierePasse();
    const deux = await migrateLifeInsuranceToLedger(USER);
    const trois = await migrateLifeInsuranceToLedger(USER);
    expect(trois).toEqual(deux);
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });

  it("l'audit n'annonce plus rien à reprendre", async () => {
    apresPremierePasse();
    const audit = await auditLifeInsurance(USER);
    expect(audit.toMigrateEur).toBe("0.00");
    expect(audit.doubleCountedEur).toBe("0.00");
    expect(audit.contracts[0]!.cashEuroNeedsReview).toBe(false);
  });
});

describe("contrats aux limites", () => {
  it("un contrat sans support ni fonds euro ne produit rien", async () => {
    lifeInsuranceFindMany.mockResolvedValue([contrat(AVIVA, "Aviva", "0", [])]);
    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(0);
    expect(r.errors).toEqual([]);
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });

  it("aucun contrat du tout : la migration se termine sans erreur", async () => {
    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r).toEqual({ created: 0, duplicatesRemoved: 0, errors: [] });
  });

  it("un doublon est retiré de la table, et sa valeur reste au journal", async () => {
    /*
      Le doublon n'est pas une perte : la position du journal porte déjà la
      valeur, et c'est la ligne de table — qui la comptait une seconde fois —
      qui disparaît. Aucune position n'est créée pour elle.
    */
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(AVIVA, "Aviva", "0", [
        { id: "prod-dup", name: "UC Amundi World", currentValue: "40000" },
      ]),
    ]);
    getHoldings.mockResolvedValue([
      positionAV("a-world", "Amundi World", "40000"),
    ]);
    supportFindMany.mockResolvedValue([
      { lifeInsuranceId: AVIVA, assetId: "a-world", kind: "UC" },
    ]);

    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(0);
    expect(r.duplicatesRemoved).toBe(1);
    expect(createTransaction).not.toHaveBeenCalled();
    const supprimees = productDeleteMany.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id
    );
    expect(supprimees).toEqual(["prod-dup"]);
  });

  it("une UC neuve donne exactement une position", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(AVIVA, "Aviva", "0", [
        { id: "prod-neuf", name: "UC Carmignac", currentValue: "8400" },
      ]),
    ]);
    const r = await migrateLifeInsuranceToLedger(USER);
    expect(r.created).toBe(1);
    expect(createTransaction).toHaveBeenCalledTimes(1);
    // Et la ligne de table cède la place à la position qui la remplace.
    const supprimees = productDeleteMany.mock.calls.map(
      (c) => (c[0] as { where: { id: string } }).where.id
    );
    expect(supprimees).toEqual(["prod-neuf"]);
  });

  it("le mode à blanc n'écrit jamais", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      contrat(AVIVA, "Aviva", "5000", [
        { id: "prod-neuf", name: "UC Carmignac", currentValue: "8400" },
      ]),
    ]);
    const r = await migrateLifeInsuranceToLedger(USER, { dryRun: true });
    expect(r.created).toBe(2);
    expect(createTransaction).not.toHaveBeenCalled();
    expect(productDeleteMany).not.toHaveBeenCalled();
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
    expect(platformFindFirst).not.toHaveBeenCalled();
  });
});
