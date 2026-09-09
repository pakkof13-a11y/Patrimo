import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Le câblage du journal de trésorerie d'enveloppe.
 *
 * Les tests de règle vivent à côté, dans `envelope-cash-journal` : ils
 * décrivent ce que le moteur fait d'un constat. Mais ils injectent les constats
 * directement dans `cashEvents`, où le compartiment savait déjà les traiter —
 * ils passeraient donc sans la moindre ligne de câblage.
 *
 * Ce fichier couvre les maillons qui manquaient : la saisie qui écrit le
 * constat — écart, ouverture, conversion de devise, lecture concurrente — et
 * le chargement qui l'apporte au moteur. Sans eux, le journal reste une table
 * vide que personne ne remplit et que personne ne lit correctement.
 */

const updateMany = vi.fn();
const eventCreate = vi.fn();
const eventCount = vi.fn();
const findFirst = vi.fn();
const findUnique = vi.fn();

vi.mock("@/app/lib/prisma", () => {
  const tx = {
    envelopeCash: {
      updateMany: (...a: unknown[]) => updateMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
    envelopeCashEvent: {
      create: (...a: unknown[]) => eventCreate(...a),
      count: (...a: unknown[]) => eventCount(...a),
    },
  };
  return {
    prisma: {
      envelopeCash: {
        updateMany: (...a: unknown[]) => updateMany(...a),
        findFirst: (...a: unknown[]) => findFirst(...a),
        findUnique: (...a: unknown[]) => findUnique(...a),
      },
      envelopeCashEvent: {
        create: (...a: unknown[]) => eventCreate(...a),
        count: (...a: unknown[]) => eventCount(...a),
      },
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

// Taux fixes et déterministes : la conversion (point 2) doit être exercée sans
// toucher le réseau. `convertToEurSync` / `convertFromEurSync` / `FxRateUnknownError`
// restent les implémentations réelles — seule la table de taux est figée.
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, USD: 1.25 }) };
});

import { PUT } from "@/app/api/envelopes/route";
import { Prisma } from "@/app/lib/prisma-client/client";

/** L'état de la ligne tel que la transaction le relit (`current`). */
function ligne(
  solde: string,
  over: Partial<{ currency: string; updatedAt: Date; createdAt: Date }> = {}
) {
  return {
    id: "env-cto",
    userId: "u1",
    envelope: "CTO",
    balance: new Prisma.Decimal(solde),
    currency: over.currency ?? "EUR",
    createdAt: over.createdAt ?? new Date("2020-01-01T00:00:00Z"),
    updatedAt: over.updatedAt ?? new Date("2020-01-01T00:00:00Z"),
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
  // Un historique existe déjà par défaut : la plupart des tests exercent le
  // cas « écart », pas le cas « ouverture ». Les tests d'ouverture le mettent
  // explicitement à 0.
  eventCount.mockReset().mockResolvedValue(1);
  findFirst.mockReset().mockResolvedValue(ligne("5200"));
  // Solde relu *dans* la transaction — c'est lui qui fait foi pour l'écart.
  findUnique.mockReset().mockResolvedValue(ligne("5000"));
  listEnvelopeCash.mockReset().mockResolvedValue([]);
  // Effet de bord seulement (garantit l'existence de la ligne) : sa valeur de
  // retour n'est plus utilisée par la route pour calculer quoi que ce soit.
  getOrCreateEnvelopeCash.mockReset().mockResolvedValue(ligne("5000"));
});

describe("la saisie écrit son constat, quand un historique existe déjà", () => {
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
    findUnique.mockResolvedValue(ligne("0"));
    eventCount.mockResolvedValue(0);
    await PUT(requete({ envelope: "CTO", balance: "3000" }));

    // Un solde antérieur nul n'a rien à ouvrir : un seul constat, qui porte
    // le solde entier.
    expect(eventCreate).toHaveBeenCalledTimes(1);
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

  it("une enveloppe introuvable n'écrit pas de constat", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const res = await PUT(requete({ envelope: "CTO", balance: "5200" }));
    expect(res.status).toBe(404);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("une poche seedée sans aucun événement — le premier constat ouvre l'histoire", () => {
  /*
    Le cœur du point 1. `EnvelopeCash` portait déjà un solde (seed, saisie
    d'avant ce journal) sans qu'aucun `EnvelopeCashEvent` ne le relate. Le
    traiter comme un écart depuis zéro ferait passer ce solde pour de la
    performance de marché le jour de la première saisie. Deux événements sont
    donc attendus : l'ouverture au solde d'avant, datée du dernier instant où
    il a été connu, puis le constat du jour, qui ne porte que l'écart réel.
  */
  const connuLe = new Date("2026-08-20T10:00:00.000Z");

  beforeEach(() => {
    findUnique.mockResolvedValue(
      ligne("5200", { updatedAt: connuLe, createdAt: new Date("2020-01-01T00:00:00Z") })
    );
    eventCount.mockResolvedValue(0);
  });

  it("écrit une ouverture au solde d'avant, puis l'écart du jour", async () => {
    const avant = Date.now();
    const res = await PUT(requete({ envelope: "AV", balance: "5400" }));
    const apres = Date.now();
    expect(res.status).toBe(200);

    expect(eventCreate).toHaveBeenCalledTimes(2);

    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    // Le solde entier, mais celui d'AVANT — pas le nouveau.
    expect(String(ouverture.data.amount)).toBe("5200");
    expect(String(ouverture.data.balanceAfter)).toBe("5200");
    expect(ouverture.data.occurredAt).toEqual(connuLe);

    const constat = eventCreate.mock.calls[1]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(constat.data.amount)).toBe("200");
    expect(String(constat.data.balanceAfter)).toBe("5400");
    const t = (constat.data.occurredAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(avant);
    expect(t).toBeLessThanOrEqual(apres);
  });

  it("l'ouverture ne se répète pas une fois l'historique entamé", async () => {
    eventCount.mockResolvedValue(1);
    await PUT(requete({ envelope: "AV", balance: "5400" }));
    expect(eventCreate).toHaveBeenCalledTimes(1);
    const data = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(String(data.data.amount)).toBe("200");
  });
});

describe("l'écart se lit dans la transaction, pas dans un état déjà périmé", () => {
  it("part du solde relu au moment de l'écriture", async () => {
    /*
      `getOrCreateEnvelopeCash` (appelé avant la transaction) rend un solde
      déjà périmé : un PUT concurrent a écrit entre-temps. La route doit
      calculer l'écart depuis ce qui est relu *dans* la transaction
      (`findUnique`), jamais depuis ce premier appel.
    */
    getOrCreateEnvelopeCash.mockResolvedValue(ligne("1000"));
    findUnique.mockResolvedValue(ligne("1200"));

    await PUT(requete({ envelope: "CTO", balance: "1500" }));

    const data = eventCreate.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    // 1500 − 1200, jamais 1500 − 1000.
    expect(String(data.data.amount)).toBe("300");
  });
});

describe("la devise se convertit, elle ne se réétiquette pas", () => {
  it("changer la devise convertit le solde et n'écrit aucun constat", async () => {
    findUnique.mockResolvedValue(ligne("5000", { currency: "EUR" }));
    /*
      Le panneau renvoie le même nominal à chaque changement de devise
      (`envelope-cash-panel.tsx:84`) : ce `balance: "5000"` ne dit rien d'une
      intention de dépôt, seulement de la valeur affichée avant conversion.
    */
    const res = await PUT(requete({ envelope: "CTO", currency: "USD", balance: "5000" }));
    expect(res.status).toBe(200);

    const maj = updateMany.mock.calls[0]![0] as {
      data: { balance: { toString(): string }; currency: string };
    };
    // 5000 EUR → 5000 × 1,25 = 6250 USD : la valeur en euros est conservée,
    // le nominal ne l'est pas.
    expect(String(maj.data.balance)).toBe("6250");
    expect(maj.data.currency).toBe("USD");
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("une devise sans taux connu répond 400, jamais 500", async () => {
    findUnique.mockResolvedValue(ligne("5000"));
    const res = await PUT(requete({ envelope: "CTO", currency: "SEK", balance: "5000" }));
    expect(res.status).toBe(400);
    expect(eventCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("changer la seule devise n'affirme aucun solde et n'écrit aucun constat", async () => {
    await PUT(requete({ envelope: "CTO", currency: "USD" }));
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("ce que la route refuse, et comment", () => {
  /*
    Un corps illisible est une requête invalide, pas une panne.

    `await req.json()` jetait avant que zod n'entre en scène : la route rendait
    un 500 opaque là où elle rend des 400 partout ailleurs.
  */
  it("un corps malformé répond 400, jamais 500", async () => {
    const req = new Request("http://localhost/api/envelopes", {
      method: "PUT",
      body: "{ pas du json",
    });
    const res = await PUT(req);
    expect(res.status).toBe(400);
    expect(updateMany).not.toHaveBeenCalled();
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("un corps vide répond 400", async () => {
    const res = await PUT(requete({}));
    expect(res.status).toBe(400);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  /*
    Changer la devise et affirmer un autre montant sont deux gestes que cette
    route ne peut pas distinguer : le solde y est reconstruit par conversion,
    donc le montant soumis serait avalé sans un mot. On refuse plutôt que de
    perdre une saisie en silence.
  */
  it("solde et devise dans la même requête : 400, et rien n'est écrit", async () => {
    findUnique.mockResolvedValue(ligne("10000", { currency: "USD" }));
    const res = await PUT(requete({ envelope: "CTO", currency: "EUR", balance: "9000" }));
    expect(res.status).toBe(400);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("le même nominal renvoyé avec la devise passe : c'est ce que fait le panneau", async () => {
    /*
      Le panneau renvoie le nominal stocké quand seule la devise bouge. La
      comparaison est numérique pour que « 10000 » et « 10000.000000000000 »
      ne s'opposent pas.
    */
    findUnique.mockResolvedValue(ligne("10000", { currency: "USD" }));
    const res = await PUT(requete({ envelope: "CTO", currency: "EUR", balance: "10000" }));
    expect(res.status).toBe(200);
    expect(eventCreate).not.toHaveBeenCalled();
  });
});

describe("l'ancre de la poche est lue avant toute écriture", () => {
  /*
    `updatedAt` est la seule date que cette table possède, et c'est sur elle
    que l'ouverture se pose. Toute écriture de la ligne la ramène au présent :
    lire l'ancre après l'une d'elles, c'est la perdre, et la poche perd tout
    son passé avec.

    La route lisait bien avant, mais appelait ensuite l'`upsert` sans
    condition — donc un `update: {}` sur une ligne déjà là, et sur un chemin
    qui pouvait finir en 400. Le remède ne cherche pas à savoir ce que Prisma
    fait d'un `update` vide : il ne lui en demande plus.
  */
  it("ne touche pas à la ligne quand elle existe déjà", async () => {
    await PUT(requete({ envelope: "CTO", balance: "5200" }));
    expect(getOrCreateEnvelopeCash).not.toHaveBeenCalled();
  });

  /*
    Le refus arrive dans la transaction, bien après l'endroit où l'`upsert`
    s'exécutait. Une requête rejetée ne doit rien laisser derrière elle.
  */
  it("ne touche à rien non plus quand la requête finit en 400", async () => {
    findUnique.mockResolvedValue(ligne("5000", { currency: "EUR" }));
    const res = await PUT(
      requete({ envelope: "CTO", currency: "USD", balance: "9999" })
    );
    expect(res.status).toBe(400);
    expect(getOrCreateEnvelopeCash).not.toHaveBeenCalled();
  });

  /*
    La ligne manquante reste le cas de l'`upsert` : lui seul ferme la course
    entre deux onglets sur le `@@unique([userId, envelope])`. La lecture le
    précède quand même — l'ordre est ce qui rend l'ancre sûre.
  */
  it("crée la ligne absente, et la lecture le précède", async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue(ligne("5000"));

    await PUT(requete({ envelope: "CTO", balance: "5200" }));

    expect(getOrCreateEnvelopeCash).toHaveBeenCalledTimes(1);
    expect(findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      getOrCreateEnvelopeCash.mock.invocationCallOrder[0]!
    );
  });

  it("l'ouverture porte cette date-là, pas celle relue après coup", async () => {
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    eventCount.mockResolvedValue(0);
    // La ligne lue avant toute écriture porte l'ancre ; celle relue dans la
    // transaction pourrait porter une date déjà réécrite. L'ouverture doit
    // s'en tenir à la première.
    findUnique
      .mockResolvedValueOnce(ligne("5200", { updatedAt: connuLe }))
      .mockResolvedValue(ligne("5200", { updatedAt: new Date() }));

    await PUT(requete({ envelope: "CTO", balance: "5400" }));

    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: { occurredAt: Date; amount: unknown };
    };
    expect(ouverture.data.occurredAt).toEqual(connuLe);
    expect(String(ouverture.data.amount)).toBe("5200");
  });
});

/*
  L'ouverture appartient à l'écriture de la ligne, pas à l'écart du jour.

  Elle était enfermée dans `if (maj.count > 0 && affirmeUnSolde)`. Un
  changement de devise seul écrit pourtant la ligne — donc réécrit son
  `updatedAt` — sans rien affirmer : le solde y est reconstruit par
  conversion, l'écart en euros est nul. La poche perdait sa seule ancre
  sans qu'aucun événement ne la remplace.
*/
describe("la poche sans historique s'ouvre dès qu'on écrit sa ligne", () => {
  /*
    La mesure du chantier : AV du seed à 5 200 €, aucun événement, bascule
    en USD. Un seul événement doit naître — l'ouverture — daté du dernier
    instant où la poche a été connue, et non un apport de 6 500 aujourd'hui.
  */
  it("un changement de devise seul ouvre l'histoire au solde d'avant", async () => {
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    eventCount.mockResolvedValue(0);
    findUnique.mockResolvedValue(
      ligne("5200", { currency: "EUR", updatedAt: connuLe })
    );

    const res = await PUT(
      requete({ envelope: "CTO", currency: "USD", balance: "5200" })
    );
    expect(res.status).toBe(200);

    // La ligne bascule bien : 5 200 EUR → 6 500 USD, même valeur en euros.
    const maj = updateMany.mock.calls[0]![0] as {
      data: { balance: { toString(): string }; currency: string };
    };
    expect(String(maj.data.balance)).toBe("6500");
    expect(maj.data.currency).toBe("USD");

    // Un seul événement, et c'est l'ouverture : aucun constat, rien n'a bougé.
    expect(eventCreate).toHaveBeenCalledTimes(1);
    const ouverture = eventCreate.mock.calls[0]![0] as {
      data: {
        occurredAt: Date;
        amount: unknown;
        balanceAfter: unknown;
        currency: string;
      };
    };
    expect(ouverture.data.occurredAt).toEqual(connuLe);
    /*
      Le solde d'avant, dans la devise d'avant. `load.ts` convertit chaque
      événement avec la sienne (`eur(e.amount, e.currency, rates)`) : la
      valeur en euros de la poche est donc la même de part et d'autre de la
      bascule, ce qu'une conversion ne fait ni gagner ni perdre.
    */
    expect(String(ouverture.data.amount)).toBe("5200");
    expect(String(ouverture.data.balanceAfter)).toBe("5200");
    expect(ouverture.data.currency).toBe("EUR");
  });

  /*
    Le pendant : une poche qui a déjà un historique n'a rien à ouvrir. C'est
    ce que vérifiaient déjà les deux contrôles de conversion, avec le
    `eventCount` par défaut à 1 — dit ici explicitement.
  */
  it("n'ouvre rien quand la poche a déjà des événements", async () => {
    eventCount.mockResolvedValue(1);
    findUnique.mockResolvedValue(ligne("5200", { currency: "EUR" }));

    await PUT(requete({ envelope: "CTO", currency: "USD", balance: "5200" }));

    expect(eventCreate).not.toHaveBeenCalled();
  });

  /*
    Et une ligne neuve n'a rien à ouvrir non plus : le constat qui suit porte
    alors le solde entier, ce qui est exact.
  */
  it("n'ouvre rien sur une poche dont le solde d'avant est nul", async () => {
    eventCount.mockResolvedValue(0);
    findUnique.mockResolvedValue(ligne("0"));

    await PUT(requete({ envelope: "CTO", balance: "5200" }));

    expect(eventCreate).toHaveBeenCalledTimes(1);
    const constat = eventCreate.mock.calls[0]![0] as {
      data: { amount: unknown };
    };
    expect(String(constat.data.amount)).toBe("5200");
  });
});

describe("le chargement apporte les constats au moteur", () => {
  /*
    Contrôle de source plutôt que de comportement : le défaut à prévenir est un
    maillon débranché, et un test de comportement ne le verrait que si la
    fixture contenait justement un constat en base.
  */
  const source = () =>
    readFileSync(
      resolve(process.cwd(), "app/lib/portfolio/historical/load.ts"),
      "utf8"
    );

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

describe("mesure du chantier — la NAV ne saute pas le jour de la première saisie", () => {
  it("poche seed à 5 200 €, saisie à 5 400 € : flux du jour +200 €, Δmarché nul", async () => {
    /*
      Traverse la chaîne réelle : les événements sont ceux que la route écrit
      (capturés via le mock Prisma), pas une reconstitution indépendante. Ils
      sont ensuite injectés dans le moteur exactement comme `load.ts` le fait,
      pour vérifier que `buildCashSleeve` les résout comme attendu.
    */
    const connuLe = new Date("2026-08-20T10:00:00.000Z");
    findUnique.mockResolvedValue(
      ligne("5200", { updatedAt: connuLe, createdAt: new Date("2020-01-01T00:00:00Z") })
    );
    eventCount.mockResolvedValue(0);

    await PUT(requete({ envelope: "AV", balance: "5400" }));
    expect(eventCreate).toHaveBeenCalledTimes(2);

    const ecrits = eventCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data
    );

    const { buildCashSleeve } = await import(
      "@/app/lib/portfolio/historical/components"
    );
    const { PortfolioValuationEngine } = await import(
      "@/app/lib/portfolio/historical/engine"
    );
    const { toDayKey } = await import(
      "@/app/lib/portfolio/historical/timeline"
    );
    const { d } = await import("@/app/lib/money/decimal");

    const events = ecrits.map((e) => ({
      accountId: "env-av",
      occurredAt: e.occurredAt as Date,
      amountEur: d(String(e.amount)),
      balanceAfterEur: d(String(e.balanceAfter)),
      type: "OBSERVED",
    }));

    const accounts = [
      {
        id: "env-av",
        balanceEur: d("5400"),
        createdAt: new Date("2020-01-01T00:00:00Z"),
        knownAt: connuLe,
      },
    ];

    // Le compartiment lui-même, en direct — c'est la pièce que le brief
    // désigne nommément.
    const build = buildCashSleeve(accounts, events);
    expect(build.flows).toHaveLength(2);
    expect(
      build.flows.find((f) => f.day === toDayKey(connuLe))?.amountEur.toNumber()
    ).toBeCloseTo(5200, 6);

    const engine = new PortfolioValuationEngine({
      transactions: [],
      assetClassById: new Map(),
      rawAssetClassById: new Map(),
      envelopeEventsByAsset: new Map(),
      excludedAssetIds: new Set(),
      closes: new Map(),
      cashAccounts: accounts,
      cashEvents: events,
      metals: [],
      privateEquity: [],
      crowdlending: [],
      tangibles: [],
      employeeSavings: [],
      liabilities: [],
    });

    const veille = toDayKey(connuLe);
    const aujourdhui = toDayKey(new Date());
    const points = engine.buildSeries(veille, aujourdhui);

    const pointConnu = points.find((p) => p.day === veille)!;
    const pointDuJour = points.find((p) => p.day === aujourdhui)!;

    // Le solde d'avant reste visible — la poche n'a pas perdu son passé.
    expect(pointConnu.cash).toBeCloseTo(5200, 6);
    // Le solde du jour est le nouveau, mais le flux du jour ne vaut que
    // l'écart : la NAV ne saute pas de +5 400 €.
    expect(pointDuJour.cash).toBeCloseTo(5400, 6);
    expect(pointDuJour.externalFlows).toBeCloseTo(200, 6);
    expect(pointDuJour.investmentPerformance).toBeCloseTo(0, 6);
  });
});
