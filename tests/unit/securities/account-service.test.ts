import { describe, expect, it, beforeEach, vi } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * Service des comptes titres — Prisma mocké.
 *
 * Deux règles justifient ces tests plutôt qu'une couverture e2e seule :
 * l'unicité légale du PEA (qui doit produire un message lisible *avant* la
 * violation d'index) et le refus d'un rattachement à une enveloppe qui ne
 * correspond pas — un déplacement CTO → PEA n'est pas une correction de
 * saisie. Toutes deux se vérifient sans base.
 */

const accountFindFirst = vi.fn();
const accountFindMany = vi.fn();
const accountCreate = vi.fn();
const accountUpdateMany = vi.fn();
const accountDeleteMany = vi.fn();
const accountFindFirstOrThrow = vi.fn();
const platformFindFirst = vi.fn();
const assetFindFirst = vi.fn();
const assetUpdate = vi.fn();

/**
 * Journal d'enveloppe : les écritures passent désormais par une transaction.
 *
 * Le mock exécute le rappel avec le client lui-même — ces tests portent sur ce
 * que le service **écrit**, pas sur la sémantique transactionnelle de
 * PostgreSQL, qui n'est pas simulable ici et n'est pas ce qu'ils vérifient.
 */
const envelopeEventCreate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $transaction: (fn: (tx: unknown) => unknown) => fn(mockPrisma),
    assetEnvelopeEvent: {
      create: (...a: unknown[]) => envelopeEventCreate(...a),
    },
    securitiesAccount: {
      findFirst: (...a: unknown[]) => accountFindFirst(...a),
      findMany: (...a: unknown[]) => accountFindMany(...a),
      create: (...a: unknown[]) => accountCreate(...a),
      updateMany: (...a: unknown[]) => accountUpdateMany(...a),
      deleteMany: (...a: unknown[]) => accountDeleteMany(...a),
      findFirstOrThrow: (...a: unknown[]) => accountFindFirstOrThrow(...a),
    },
    platform: { findFirst: (...a: unknown[]) => platformFindFirst(...a) },
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
  },
}));

/** Le même objet que le mock ci-dessus, pour que `$transaction` s'y branche. */
const mockPrisma = {
  assetEnvelopeEvent: { create: (...a: unknown[]) => envelopeEventCreate(...a) },
  securitiesAccount: {
    deleteMany: (...a: unknown[]) => accountDeleteMany(...a),
  },
  asset: { update: (...a: unknown[]) => assetUpdate(...a) },
};

const {
  createAccount,
  deleteAccount,
  setAssetAccount,
  updateAccount,
  SecuritiesInputError,
} = await import("@/app/lib/securities/account-service");

const USER = "user-1";

function accountRow(over: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    envelopeType: "PEA",
    platformId: "plat-1",
    openDate: new Date("2019-03-01"),
    iban: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    platform: { name: "Boursorama", logoUrl: null },
    _count: { assets: 0 },
    ...over,
  };
}

function validInput(over: Record<string, unknown> = {}) {
  return {
    envelopeType: "PEA",
    platformId: "plat-1",
    openDate: "2019-03-01",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  platformFindFirst.mockResolvedValue({ id: "plat-1" });
  accountFindFirst.mockResolvedValue(null);
  accountCreate.mockResolvedValue(accountRow());
});

describe("createAccount — validations", () => {
  it("rejette un type de compte inconnu", async () => {
    await expect(
      createAccount(USER, validInput({ envelopeType: "AV" }))
    ).rejects.toThrow(/inconnu/i);
  });

  it("rejette un courtier qui n'appartient pas à l'utilisateur", async () => {
    platformFindFirst.mockResolvedValue(null);
    await expect(createAccount(USER, validInput())).rejects.toThrow(
      /courtier introuvable/i
    );
  });

  it("rejette une date d'ouverture invalide", async () => {
    await expect(
      createAccount(USER, validInput({ openDate: "pas une date" }))
    ).rejects.toThrow(/invalide/i);
  });

  it("rejette une date d'ouverture future — les 5 ans ne peuvent pas courir à l'envers", async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    await expect(
      createAccount(USER, validInput({ openDate: future }))
    ).rejects.toThrow(/futur/i);
  });
});

describe("createAccount — unicité légale", () => {
  it("refuse un second PEA avec un message lisible", async () => {
    accountFindFirst.mockResolvedValue({ id: "acc-existant" });
    await expect(createAccount(USER, validInput())).rejects.toThrow(
      /vous détenez déjà un PEA/i
    );
    expect(accountCreate).not.toHaveBeenCalled();
  });

  it("refuse un second PEA-PME", async () => {
    accountFindFirst.mockResolvedValue({ id: "acc-existant" });
    await expect(
      createAccount(USER, validInput({ envelopeType: "PEA_PME" }))
    ).rejects.toThrow(/PEA-PME/);
  });

  it("autorise plusieurs CTO — aucune vérification d'unicité déclenchée", async () => {
    accountCreate.mockResolvedValue(accountRow({ envelopeType: "CTO" }));
    await expect(
      createAccount(USER, validInput({ envelopeType: "CTO" }))
    ).resolves.toMatchObject({ envelopeType: "CTO" });
    expect(accountFindFirst).not.toHaveBeenCalled();
    expect(accountCreate).toHaveBeenCalled();
  });

  it("traduit une violation d'index concurrente (P2002) dans le même message", async () => {
    accountCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "7.0.0",
      })
    );
    await expect(createAccount(USER, validInput())).rejects.toThrow(
      /vous détenez déjà un PEA/i
    );
  });

  it("ne masque pas les autres erreurs Prisma", async () => {
    accountCreate.mockRejectedValue(new Error("panne réseau"));
    await expect(createAccount(USER, validInput())).rejects.toThrow(
      /panne réseau/
    );
  });
});

describe("createAccount — écriture", () => {
  it("scope la création sur l'utilisateur et normalise les champs libres", async () => {
    await createAccount(
      USER,
      validInput({ envelopeType: "CTO", iban: "  FR76  ", notes: "   " })
    );
    const data = accountCreate.mock.calls[0]![0].data;
    expect(data.userId).toBe(USER);
    expect(data.iban).toBe("FR76");
    expect(data.notes).toBeNull();
  });
});

describe("updateAccount", () => {
  it("scope la mise à jour par (id, userId)", async () => {
    accountUpdateMany.mockResolvedValue({ count: 1 });
    accountFindFirstOrThrow.mockResolvedValue(accountRow());
    await updateAccount(USER, "acc-1", { notes: "note" });
    expect(accountUpdateMany.mock.calls[0]![0].where).toEqual({
      id: "acc-1",
      userId: USER,
    });
  });

  it("échoue si le compte n'appartient pas à l'utilisateur", async () => {
    accountUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateAccount(USER, "acc-autrui", { notes: "x" })
    ).rejects.toThrow(/introuvable/i);
  });

  it("n'expose pas envelopeType : changer d'enveloppe, c'est ouvrir un autre compte", async () => {
    accountUpdateMany.mockResolvedValue({ count: 1 });
    accountFindFirstOrThrow.mockResolvedValue(accountRow());
    await updateAccount(USER, "acc-1", {
      notes: "x",
      // @ts-expect-error — le champ n'existe volontairement pas dans le type
      envelopeType: "CTO",
    });
    expect(accountUpdateMany.mock.calls[0]![0].data.envelopeType).toBeUndefined();
  });
});

describe("deleteAccount", () => {
  it("rapporte le nombre de positions détachées, sans les supprimer", async () => {
    /*
      Le service énumère désormais les lignes au lieu de les compter : c'est
      ce qui lui permet de journaliser chaque détachement avant que la base ne
      les délie par `SetNull`.
    */
    envelopeEventCreate.mockReset();
    accountFindFirst.mockResolvedValue({
      envelopeType: "CTO",
      assets: [
        { id: "a1", accountType: "CTO" },
        { id: "a2", accountType: "CTO" },
        { id: "a3", accountType: "CTO" },
      ],
    });
    accountDeleteMany.mockResolvedValue({ count: 1 });

    await expect(deleteAccount(USER, "acc-1")).resolves.toEqual({
      deleted: true,
      detachedPositions: 3,
    });
  });

  it("journalise le détachement de chaque ligne avant la suppression", async () => {
    /*
      La suppression détache par `SetNull`, sans code applicatif : c'était la
      seule porte capable de changer un rattachement sans laisser de trace.
      Chaque ligne doit donc enregistrer qu'elle devient non rattachée.
    */
    envelopeEventCreate.mockReset();
    accountFindFirst.mockResolvedValue({
      envelopeType: "PEA",
      assets: [
        { id: "a1", accountType: "PEA" },
        { id: "a2", accountType: "PEA" },
      ],
    });
    accountDeleteMany.mockResolvedValue({ count: 1 });

    await deleteAccount(USER, "acc-1");

    expect(envelopeEventCreate).toHaveBeenCalledTimes(2);
    for (const appel of envelopeEventCreate.mock.calls) {
      const data = appel[0]?.data;
      expect(data.kind).toBe("CHANGED");
      // Détachée : plus de compte, et le type d'enveloppe suit.
      expect(data.securitiesAccountId).toBeNull();
      expect(data.envelopeType).toBeNull();
      expect(data.accountType).toBe("PEA");
    }
  });

  it("compte inconnu ou d'autrui : rien de supprimé", async () => {
    accountFindFirst.mockResolvedValue(null);
    await expect(deleteAccount(USER, "acc-autrui")).resolves.toEqual({
      deleted: false,
      detachedPositions: 0,
    });
    expect(accountDeleteMany).not.toHaveBeenCalled();
  });
});

describe("setAssetAccount", () => {
  it("rattache une ligne PEA à un PEA", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", accountType: "PEA" });
    accountFindFirst.mockResolvedValue({ envelopeType: "PEA" });
    await setAssetAccount(USER, "a1", "acc-1");
    expect(assetUpdate.mock.calls[0]![0].data).toEqual({
      securitiesAccountId: "acc-1",
    });
  });

  it("rattache une ligne PEA à un PEA-PME — même famille fiscale", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", accountType: "PEA" });
    accountFindFirst.mockResolvedValue({ envelopeType: "PEA_PME" });
    await expect(setAssetAccount(USER, "a1", "acc-1")).resolves.toBeUndefined();
  });

  it("refuse de déplacer une ligne CTO dans un PEA", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", accountType: "CTO" });
    accountFindFirst.mockResolvedValue({ envelopeType: "PEA" });
    await expect(setAssetAccount(USER, "a1", "acc-1")).rejects.toThrow(
      /ne peut pas être rattachée/i
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("détache sans vérifier d'enveloppe", async () => {
    assetFindFirst.mockResolvedValue({ id: "a1", accountType: "CTO" });
    await setAssetAccount(USER, "a1", null);
    expect(accountFindFirst).not.toHaveBeenCalled();
    expect(assetUpdate.mock.calls[0]![0].data).toEqual({
      securitiesAccountId: null,
    });
  });

  it("refuse une position qui n'appartient pas à l'utilisateur", async () => {
    assetFindFirst.mockResolvedValue(null);
    await expect(setAssetAccount(USER, "a-autrui", null)).rejects.toThrow(
      SecuritiesInputError
    );
  });
});
