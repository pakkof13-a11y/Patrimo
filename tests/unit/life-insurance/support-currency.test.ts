import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saisie en euros, écriture en devise de l'actif — les deux côtés à la fois.
 *
 * ## Le défaut mesuré
 *
 * `getHoldings` lit `Asset.manualPrice` comme un prix **dans `asset.currency`**
 * puis le convertit (`portfolio/service.ts:338-340`), et le rejeu convertit
 * `Transaction.unitPrice` par `fxRateToEur` (`accounting/ledger.ts`).
 * `createSupport` et `revalueSupport` y écrivaient un montant **en euros**, avec
 * `fxRateToEur: "1"` que `resolveFx` remplaçait par le taux vivant.
 *
 * Sur un contrat en dollars, 10 000 € saisis au taux 1,08 donnaient donc
 * 9 259,26 € de coût **et** 9 259,26 € de valeur : plus-value nulle, position
 * sous-évaluée de 740,74 €. Les deux erreurs se masquaient l'une l'autre — d'où
 * un test qui refuse de se contenter de la plus-value.
 *
 * ## Ce que ce fichier interdit
 *
 * Trois faux verts sont écartés par construction :
 *
 * - **un taux de 1** : les taux injectés sont 1,08 (USD) et 160 (JPY) ;
 * - **un `convertFromEurSync` mocké en identité** : la conversion, le rejeu du
 *   journal et la valorisation sont ceux de production. Seul `getEurRates` est
 *   remplacé, pour ne pas appeler le réseau et pour que l'écriture et la
 *   lecture partagent **le même objet de taux** ;
 * - **`toFixed(pnl, 2) === "0.00"`**, qui tolère 0,004 € : la borne est
 *   `10⁻⁶ €`, et le discriminant vis-à-vis de l'état fautif est
 *   `costBasisEur = 10 000` et non 9 259,26 — la plus-value, elle, était déjà
 *   quasi nulle avant correction.
 *
 * La base est un magasin en mémoire : `createSupport` → `createTransaction` →
 * rejeu CUMP → `getHoldings` s'exécutent pour de vrai.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: {
    contracts: Row[];
    platforms: Row[];
    assets: Row[];
    supports: Row[];
    transactions: Row[];
    quotes: Row[];
  } = {
    contracts: [],
    platforms: [],
    assets: [],
    supports: [],
    transactions: [],
    quotes: [],
  };

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  /** `where` plat : égalité stricte, plus la forme `{ in: [...] }`. */
  const matches = (row: Row, where: Where = {}): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      if (expected === undefined) continue;
      if (
        expected !== null &&
        typeof expected === "object" &&
        "in" in (expected as Row)
      ) {
        const list = (expected as { in: unknown[] }).in;
        if (!list.includes(row[key])) return false;
      } else if (row[key] !== expected) return false;
    }
    return true;
  };

  const find = (rows: Row[], where?: Where) =>
    rows.find((r) => matches(r, where)) ?? null;
  const filter = (rows: Row[], where?: Where) =>
    rows.filter((r) => matches(r, where));

  const fakePrisma = {
    lifeInsurance: {
      findFirst: async ({ where }: { where?: Where }) =>
        find(db.contracts, where),
    },
    platform: {
      findFirst: async ({ where }: { where?: Where }) =>
        find(db.platforms, where),
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.platforms, where),
      create: async ({ data }: { data: Row }) => {
        const row = { id: nextId("plat"), ...data };
        db.platforms.push(row);
        return row;
      },
    },
    asset: {
      create: async ({ data }: { data: Row }) => {
        const row = {
          // Relations lues par `getHoldings` — absentes, jamais indéfinies.
          priceQuote: null,
          defiPosition: null,
          nftItem: null,
          id: nextId("asset"),
          ...data,
        };
        db.assets.push(row);
        return row;
      },
      findFirst: async ({ where }: { where?: Where }) => find(db.assets, where),
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.assets, where).map((a) => ({
          ...a,
          platform: db.platforms.find((p) => p.id === a.platformId) ?? null,
        })),
      update: async ({ where, data }: { where: Where; data: Row }) => {
        const row = find(db.assets, { id: where.id });
        if (!row) throw new Error("asset absent");
        Object.assign(row, data);
        return row;
      },
    },
    lifeInsuranceSupport: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: nextId("sup"), ...data };
        db.supports.push(row);
        return row;
      },
    },
    transaction: {
      create: async ({ data }: { data: Row }) => {
        const row = { id: nextId("tx"), ...data };
        db.transactions.push(row);
        return row;
      },
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where),
      count: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where).length,
      findFirst: async ({ where }: { where?: Where }) => {
        const rows = filter(db.transactions, where);
        return rows[rows.length - 1] ?? null;
      },
    },
    priceQuote: {
      deleteMany: async ({ where }: { where?: Where }) => {
        const before = db.quotes.length;
        db.quotes = db.quotes.filter((q) => !matches(q, where));
        return { count: before - db.quotes.length };
      },
    },
    // Aucune clôture collectée : la valorisation reste sur le prix manuel.
    assetDailyClose: {
      groupBy: async () => [] as Row[],
      findMany: async () => [] as Row[],
    },
    // Transaction interactive : le même client, donc les mêmes données.
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fakePrisma),
  };

  const reset = () => {
    db.contracts = [];
    db.platforms = [];
    db.assets = [];
    db.supports = [];
    db.transactions = [];
    db.quotes = [];
    seq = 0;
  };

  return { db, fakePrisma, reset };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

const getEurRates = vi.fn();
const fxRateToEur = vi.fn();

/*
  Mock partiel, et volontairement minimal.

  `convertFromEurSync` / `convertToEurSync` restent ceux de production : c'est
  la chaîne réelle qui est mesurée, pas une réimplémentation qui vérifierait
  l'arithmétique du test contre elle-même.

  `fxRateToEur` est enveloppé pour une seule raison : prouver qu'aucun second
  relevé de taux n'est demandé pendant une écriture.
*/
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return {
    ...actual,
    getEurRates: (...a: unknown[]) => getEurRates(...a),
    fxRateToEur: (...a: unknown[]) => fxRateToEur(...a),
  };
});

import { d, toFixed } from "@/app/lib/money/decimal";
import {
  createSupport,
  LifeInsuranceInputError,
  revalueSupport,
} from "@/app/lib/life-insurance/support-service";
import { getHoldings } from "@/app/lib/portfolio/service";
import { invalidateLedgerCache } from "@/app/lib/portfolio/ledger-cache";

const USER = "u-av";
const CONTRAT = "contrat-1";

/**
 * Le relevé de taux de l'écriture **et** de la lecture : 1 EUR = X devise.
 *
 * Un seul objet, injecté aux deux bouts — c'est la condition sans laquelle la
 * mesure ne veut rien dire, puisqu'un écart de taux entre l'écriture et la
 * lecture s'afficherait exactement comme une plus-value.
 */
const RATES: Record<string, number> = { EUR: 1, USD: 1.08, JPY: 160 };

/** Ce que vaut une unité de devise en euros, dix décimales — comme en base. */
const versEur = (cur: string) => toFixed(d(1).div(RATES[cur]!), 10);

function contrat(currency: string) {
  db.contracts.push({
    id: CONTRAT,
    userId: USER,
    insurer: "Linxea",
    currency,
    openDate: new Date("2015-03-02T00:00:00.000Z"),
  });
}

const assetRow = () => db.assets[0]!;
const txRow = () => db.transactions[0]!;
const supportRow = () => db.supports[0]!;
const nombre = (v: unknown) => Number(String(v));

async function positionAv() {
  const rows = await getHoldings(USER, "EUR", RATES);
  const row = rows.find((r) => r.accountType === "AV");
  if (!row) throw new Error("aucune position AV");
  return row;
}

async function creer(over: Record<string, string> = {}) {
  return createSupport(USER, {
    lifeInsuranceId: CONTRAT,
    name: "UC Amundi S&P 500",
    kind: "UC",
    amountEur: "10000",
    investedAt: "2026-09-01T09:00:00.000Z",
    ...over,
  });
}

beforeEach(() => {
  reset();
  invalidateLedgerCache(USER);
  getEurRates.mockReset().mockResolvedValue(RATES);
  fxRateToEur
    .mockReset()
    .mockRejectedValue(
      new Error("second relevé de taux interdit pendant une écriture")
    );
});

describe("createSupport — contrat en devise", () => {
  it("écrit le montant converti, et le taux qui l'a converti", async () => {
    contrat("USD");

    await creer();

    // 10 000 € × 1,08 : un prix en dollars, comme le relira `getHoldings`.
    expect(nombre(assetRow().manualPrice)).toBe(10_800);
    expect(assetRow().currency).toBe("USD");
    expect(nombre(txRow().unitPrice)).toBe(10_800);
    expect(txRow().currency).toBe("USD");
    // Plus jamais "1" : c'est ce que `resolveFx` conservait tel quel sur un
    // ACHAT, faisant valoir un dollar un euro. Et le taux fourni traverse
    // `resolveFx` intact — vérifié, pas supposé.
    expect(String(txRow().fxRateToEur)).toBe(versEur("USD"));
    expect(String(txRow().fxRateToEur)).toBe("0.9259259259");
  });

  it("10 000 € saisis valent 10 000 € de valeur ET 10 000 € de coût", async () => {
    contrat("USD");

    await creer();
    const h = await positionAv();

    // Valeur : égalité à douze décimales, la précision de `convertToEurSync`.
    expect(d(h.marketValueEur).toFixed(12)).toBe("10000.000000000000");
    // Coût : borne 10 000 × 1,08 × 5·10⁻¹¹, l'arrondi du taux à dix décimales.
    const ecartCout = d(h.costBasisEur).minus(10_000).abs();
    expect(ecartCout.lte(d(10_000).times(1.08).times(5e-11))).toBe(true);
    expect(ecartCout.lte(1e-6)).toBe(true);
    // Le discriminant : l'état fautif écrivait 9 259,26 de coût, et une
    // plus-value déjà nulle. C'est le coût qui distingue les deux états.
    expect(nombre(h.costBasisEur)).toBeGreaterThan(9_999);
    expect(d(h.unrealizedPnlEur).abs().lte(1e-6)).toBe(true);
    expect(nombre(h.quantity)).toBe(1);
  });

  it("les frais suivent le montant : P&L = −frais, pas −frais × taux", async () => {
    contrat("USD");

    await creer({ entryFeesEur: "50" });
    const h = await positionAv();

    // 50 € × 1,08 = 54 USD, que le journal ramène à 50,00000000 €.
    expect(nombre(txRow().fees)).toBe(54);
    expect(
      d(String(txRow().feesEur)).minus(50).abs().lte(1e-6)
    ).toBe(true);

    // Le CUMP capitalise les frais d'acquisition : coût = montant + frais.
    expect(d(h.costBasisEur).minus(10_050).abs().lte(1e-6)).toBe(true);
    // Le piège que ce test existe pour attraper : frais non convertis, donc
    // 50 USD au lieu de 54 → 10 046,30 € de coût.
    expect(nombre(h.costBasisEur)).toBeGreaterThan(10_049.9);
    expect(d(h.marketValueEur).toFixed(12)).toBe("10000.000000000000");
    // L'identité avec frais : P&L = −frais, à 10⁻⁶ € près.
    expect(d(h.unrealizedPnlEur).toFixed(2)).toBe("-50.00");
    expect(d(h.unrealizedPnlEur).plus(50).abs().lte(1e-6)).toBe(true);
  });

  it("tient l'égalité exacte quand l'inverse du taux l'est aussi", async () => {
    // 1 EUR = 160 JPY → 0,00625 € le yen, sans arrondi à dix décimales.
    contrat("JPY");

    await creer();
    const h = await positionAv();

    expect(nombre(assetRow().manualPrice)).toBe(1_600_000);
    // `Prisma.Decimal` normalise les zéros de queue : 0,00625, pas 0,0062500000.
    expect(nombre(txRow().fxRateToEur)).toBe(0.00625);
    expect(d(h.costBasisEur).toFixed(12)).toBe("10000.000000000000");
    expect(d(h.marketValueEur).toFixed(12)).toBe("10000.000000000000");
    expect(d(h.unrealizedPnlEur).toFixed(12)).toBe("0.000000000000");
  });
});

describe("createSupport — un seul relevé de taux, et l'euro inchangé", () => {
  it("ne demande qu'un relevé pour une écriture en devise", async () => {
    contrat("USD");

    await creer();

    // Le taux persisté vient du même objet que la conversion, pas d'un second
    // appel tombé de l'autre côté du TTL d'une heure.
    expect(getEurRates).toHaveBeenCalledTimes(1);
    expect(fxRateToEur).not.toHaveBeenCalled();
  });

  it("n'en demande aucun pour un contrat en euros", async () => {
    contrat("EUR");

    await creer();

    // Rien à convertir : aucun appel sortant, comme le retour immédiat de
    // `resolveFx` pour l'euro.
    expect(getEurRates).not.toHaveBeenCalled();
    expect(String(txRow().fxRateToEur)).toBe("1");
    expect(nombre(assetRow().manualPrice)).toBe(10_000);
  });

  it("garde le comportement du contrat en euros, frais compris", async () => {
    contrat("EUR");

    await creer({ entryFeesEur: "50" });
    const h = await positionAv();

    expect(nombre(txRow().fees)).toBe(50);
    expect(d(h.costBasisEur).toFixed(2)).toBe("10050.00");
    expect(d(h.marketValueEur).toFixed(2)).toBe("10000.00");
    expect(d(h.unrealizedPnlEur).toFixed(2)).toBe("-50.00");
  });

  it("garde le nominal du structuré en euros", async () => {
    contrat("USD");

    await creer({
      kind: "STRUCTURED",
      maturityDate: "2030-06-30T00:00:00.000Z",
    });

    // `coupon-schedule.ts` relit ce champ comme des euros : le repli doit
    // porter la saisie, jamais le montant converti — sinon un structuré de
    // 10 000 € annoncerait un nominal de 10 800 €.
    expect(nombre(supportRow().nominalEur)).toBe(10_000);
    expect(nombre(assetRow().manualPrice)).toBe(10_800);
  });

  it("refuse une devise que rien ne fonde, sans rien écrire", async () => {
    contrat("SEK");

    await expect(creer()).rejects.toThrow(LifeInsuranceInputError);

    // `LifeInsuranceInputError` : la route n'en traduit qu'elle en 400.
    // Et rien d'écrit — ni actif, ni fiche, ni versement : la conversion
    // précède `prisma.$transaction`.
    expect(db.assets).toHaveLength(0);
    expect(db.supports).toHaveLength(0);
    expect(db.transactions).toHaveLength(0);
  });
});

describe("revalueSupport — contrat en devise", () => {
  it("convertit le relevé avant de l'écrire", async () => {
    contrat("USD");
    const { assetId } = await creer();
    invalidateLedgerCache(USER);

    await revalueSupport(USER, assetId, "12000");

    // 12 000 € × 1,08, quantité 1.
    expect(nombre(assetRow().manualPrice)).toBe(12_960);
    const h = await positionAv();
    expect(d(h.marketValueEur).toFixed(12)).toBe("12000.000000000000");
    // Le relevé monte de 2 000 € : la plus-value les suit — et non 1 851,85 €,
    // ce que rendait un relevé euro écrit dans un champ en dollars.
    expect(d(h.unrealizedPnlEur).minus(2_000).abs().lte(1e-6)).toBe(true);
  });

  it("lit la devise de l'actif, pas celle du contrat", async () => {
    contrat("USD");
    const { assetId } = await creer();
    invalidateLedgerCache(USER);

    // Le contrat passe en euros après coup ; l'actif reste en dollars et son
    // prix continue d'être relu comme tel par `getHoldings`.
    db.contracts[0]!.currency = "EUR";

    await revalueSupport(USER, assetId, "12000");

    expect(nombre(assetRow().manualPrice)).toBe(12_960);
    const h = await positionAv();
    expect(d(h.marketValueEur).toFixed(12)).toBe("12000.000000000000");
  });

  it("refuse une devise que rien ne fonde sans toucher au prix", async () => {
    contrat("USD");
    const { assetId } = await creer();
    const avant = String(assetRow().manualPrice);
    assetRow().currency = "SEK";

    await expect(revalueSupport(USER, assetId, "12000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(String(assetRow().manualPrice)).toBe(avant);
  });
});
