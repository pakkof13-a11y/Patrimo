import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le câblage du journal de trésorerie d'enveloppe.
 *
 * Les tests de règle vivent à côté, dans `envelope-cash-journal` : ils
 * décrivent ce que le moteur fait d'un constat. Mais ils injectent les constats
 * directement dans `cashEvents`, où le compartiment savait déjà les traiter —
 * ils passeraient donc sans la moindre ligne de câblage.
 *
 * Ce fichier couvre les deux maillons qui manquaient : la saisie qui écrit le
 * constat, et le chargement qui l'apporte au moteur. Sans eux, le journal reste
 * une table vide que personne ne remplit et que personne ne lit.
 */

const updateMany = vi.fn();
const eventCreate = vi.fn();
const findFirst = vi.fn();
const findUnique = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    envelopeCash: { updateMany: (...a: unknown[]) => updateMany(...a) },
    envelopeCashEvent: { create: (...a: unknown[]) => eventCreate(...a) },
  };
  return {
    prisma: {
      envelopeCash: {
        updateMany: (...a: unknown[]) => updateMany(...a),
        findFirst: (...a: unknown[]) => findFirst(...a),
        findUnique: (...a: unknown[]) => findUnique(...a),
      },
      envelopeCashEvent: { create: (...a: unknown[]) => eventCreate(...a) },
      $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    },
  };
});

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: async () => "u1",
}));

const listEnvelopeCash = vi.fn();
const getOrCreateEnvelopeCash = vi.fn();

vi.mock("@/app/lib/cash/pockets", () => ({
  listEnvelopeCash: (...a: unknown[]) => listEnvelopeCash(...a),
  getOrCreateEnvelopeCash: (...a: unknown[]) => getOrCreateEnvelopeCash(...a),
}));

import { PUT } from "@/app/api/envelopes/route";
import { Prisma } from "@/app/lib/prisma-client/client";

/** L'enveloppe telle qu'elle existe avant la saisie. */
function ligne(solde: string) {
  return {
    id: "env-cto",
    userId: "u1",
    envelope: "CTO",
    balance: new Prisma.Decimal(solde),
    currency: "EUR",
  };
}

function requete(body: unknown) {
  return new Request("http://localhost/api/envelopes", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  eventCreate.mockReset().mockResolvedValue({ id: "evt-1" });
  findFirst.mockReset().mockResolvedValue(ligne("5200"));
  findUnique.mockReset().mockResolvedValue(null);
  listEnvelopeCash.mockReset().mockResolvedValue([]);
  getOrCreateEnvelopeCash.mockReset().mockResolvedValue(ligne("5000"));
});

describe("la saisie écrit son constat", () => {
  it("un solde affirmé produit un constat", async () => {
    const res = await PUT(requete({ envelope: "CTO", balance: "5200" }));
    expect(res.status).toBe(200);

    expect(eventCreate).toHaveBeenCalledTimes(1);
    const data = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(data.data.envelopeCashId).toBe("env-cto");
    expect(data.data.userId).toBe("u1");
    expect(String(data.data.balanceAfter)).toBe("5200");
    // L'écart avec le constat précédent, et non le solde entier.
    expect(String(data.data.amount)).toBe("200");
  });

  it("le constat est daté de la saisie, seul instant que l'API connaisse", async () => {
    const avant = Date.now();
    await PUT(requete({ envelope: "CTO", balance: "5200" }));
    const apres = Date.now();

    const data = eventCreate.mock.calls[0]![0] as {
      data: { occurredAt: Date };
    };
    const t = data.data.occurredAt.getTime();
    expect(t).toBeGreaterThanOrEqual(avant);
    expect(t).toBeLessThanOrEqual(apres);
  });

  it("un premier solde sur une enveloppe vide entre entièrement en flux", async () => {
    getOrCreateEnvelopeCash.mockResolvedValue(ligne("0"));
    await PUT(requete({ envelope: "CTO", balance: "3000" }));

    const data = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data.data.amount)).toBe("3000");
    expect(String(data.data.balanceAfter)).toBe("3000");
  });

  it("un retrait produit un écart négatif", async () => {
    await PUT(requete({ envelope: "CTO", balance: "4500" }));
    const data = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data.data.amount)).toBe("-500");
  });

  it("le solde et son constat sont écrits dans la même transaction", async () => {
    /*
      Un solde modifié sans son constat rouvrirait le défaut sur cette
      saisie-là : l'ancre technique reprendrait la main et l'état précédent
      serait perdu. Les deux écritures passent donc par le même `tx`.
    */
    await PUT(requete({ envelope: "CTO", balance: "5200" }));
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });

  it("changer la seule devise n'affirme aucun solde et n'écrit aucun constat", async () => {
    /*
      Une correction administrative n'est pas une observation. Écrire un constat
      pour elle ferait passer un changement de libellé pour une mesure.
    */
    await PUT(requete({ envelope: "CTO", currency: "USD" }));
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("une enveloppe introuvable n'écrit pas de constat", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await PUT(requete({ envelope: "CTO", balance: "5200" }));
    expect(res.status).toBe(404);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("le chargement apporte les constats au moteur", () => {
  /*
    Contrôle de source plutôt que de comportement : le défaut à prévenir est un
    maillon débranché, et un test de comportement ne le verrait que si la
    fixture contenait justement un constat en base.
  */
  const source = () =>
    require("node:fs").readFileSync(
      require("node:path").resolve(
        process.cwd(),
        "app/lib/portfolio/historical/load.ts"
      ),
      "utf8"
    ) as string;

  it("les constats d'enveloppe sont chargés", () => {
    expect(source()).toContain("envelopeCashEvent.findMany");
  });

  it("ils sont versés dans le même tableau que ceux des comptes et livrets", () => {
    const code = source();
    const debut = code.indexOf("const cashEvents = [");
    expect(debut).toBeGreaterThan(-1);
    const bloc = code.slice(debut, code.indexOf("];", debut));
    expect(bloc).toContain("envelopeCashEvents.map");
    expect(bloc).toContain("accountId: e.envelopeCashId");
  });

  it("ils ne sont jamais typés INTEREST, qui les sortirait des flux", () => {
    /*
      `INTEREST` est le seul type que le compartiment traite comme de la
      performance. Un constat d'enveloppe ne doit jamais le porter : l'écart
      entre deux soldes saisis est du capital, faute de pouvoir prouver le
      contraire.
    */
    const code = source();
    const debut = code.indexOf("...envelopeCashEvents.map");
    const bloc = code.slice(debut, debut + 400);
    expect(bloc).toContain('type: "OBSERVED"');
    expect(bloc).not.toContain("INTEREST");
  });
});
