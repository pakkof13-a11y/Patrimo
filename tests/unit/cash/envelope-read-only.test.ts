import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Une lecture ne crée rien, et une poche vide n'est pas une donnée saisie.
 *
 * `listEnvelopeCash` appelait `getOrCreateEnvelopeCash` sur les trois
 * enveloppes : un simple `GET /api/envelopes` — déclenché par le seul fait
 * d'ouvrir l'onglet Titres, qui monte le panneau de trésorerie — matérialisait
 * trois lignes à zéro en base.
 *
 * Le coût n'était pas les trois lignes. C'était `loadPatrimonyPresence`, qui
 * teste la **présence** d'une `EnvelopeCash` et non son montant : un compte
 * neuf devenait « non vierge » pour avoir ouvert un onglet, et le cockpit
 * d'accueil ne revenait plus jamais.
 *
 * Les deux moitiés sont vérifiées ici : la lecture n'écrit plus, et la
 * présence se juge sur le montant — ce qui répare aussi les comptes déjà
 * pollués, dont personne ne peut retirer les lignes.
 */

const envelopeFindMany = vi.fn();
const envelopeFindFirst = vi.fn();
const envelopeUpsert = vi.fn();
const envelopeCreate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    envelopeCash: {
      findMany: (...a: unknown[]) => envelopeFindMany(...a),
      findFirst: (...a: unknown[]) => envelopeFindFirst(...a),
      upsert: (...a: unknown[]) => envelopeUpsert(...a),
      create: (...a: unknown[]) => envelopeCreate(...a),
    },
    bankAccount: { findMany: vi.fn(), findFirst: vi.fn() },
    savingsAccount: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, USD: 1.25 }) };
});

import { listEnvelopeCash } from "@/app/lib/cash/pockets";

function ligne(envelope: string, balance: string, currency = "EUR") {
  return {
    id: `env-${envelope.toLowerCase()}`,
    userId: "u1",
    envelope,
    balance: { toString: () => balance },
    currency,
  };
}

beforeEach(() => {
  envelopeFindMany.mockReset().mockResolvedValue([]);
  envelopeFindFirst.mockReset().mockResolvedValue(null);
  envelopeUpsert.mockReset();
  envelopeCreate.mockReset();
});

describe("listEnvelopeCash", () => {
  it("n'écrit rien, sur un compte qui n'a aucune poche", async () => {
    await listEnvelopeCash("u1");
    expect(envelopeCreate).not.toHaveBeenCalled();
    expect(envelopeUpsert).not.toHaveBeenCalled();
  });

  /*
    L'écran attend les trois enveloppes, qu'elles existent ou non en base : le
    panneau doit pouvoir proposer une saisie sur une poche jamais renseignée.
    Elles sont donc rendues sans être écrites — un fait affiché, pas une ligne
    créée.
  */
  it("rend quand même les trois enveloppes, à zéro", async () => {
    const out = await listEnvelopeCash("u1");
    expect(out.map((e) => e.envelope).sort()).toEqual(["AV", "CTO", "PEA"]);
    for (const e of out) {
      expect(e.balance).toBe("0");
      expect(e.id).toBeNull();
    }
  });

  it("rend le montant réel des poches qui existent", async () => {
    envelopeFindMany.mockResolvedValue([ligne("CTO", "-1200")]);
    const out = await listEnvelopeCash("u1");
    const cto = out.find((e) => e.envelope === "CTO")!;
    expect(cto.balance).toBe("-1200");
    expect(cto.id).toBe("env-cto");
    // Les deux autres restent des poches non écrites.
    expect(out.find((e) => e.envelope === "PEA")!.id).toBeNull();
  });

  it("convertit dans la devise demandée sans rien écrire", async () => {
    envelopeFindMany.mockResolvedValue([ligne("PEA", "1000", "EUR")]);
    const out = await listEnvelopeCash("u1", "USD");
    expect(Number(out.find((e) => e.envelope === "PEA")!.balanceBase)).toBeCloseTo(
      1250,
      6
    );
    expect(envelopeCreate).not.toHaveBeenCalled();
    expect(envelopeUpsert).not.toHaveBeenCalled();
  });
});

describe("présence d'une poche dans le recensement patrimonial", () => {
  it("une poche à zéro ne rend pas le compte actif", async () => {
    const { loadPatrimonyPresence } = await import(
      "@/app/lib/portfolio/patrimony-state"
    );
    await loadPatrimonyPresence("u1");

    const appel = envelopeFindFirst.mock.calls.at(-1)?.[0] as {
      where: Record<string, unknown>;
    };
    /*
      Le montant, pas l'existence. `NOT: { balance: 0 }` et non `gt: 0` : un
      découvert de compte-titres est une donnée saisie au même titre qu'un
      solde créditeur.
    */
    expect(appel.where).toMatchObject({ userId: "u1", NOT: { balance: 0 } });
  });
});
