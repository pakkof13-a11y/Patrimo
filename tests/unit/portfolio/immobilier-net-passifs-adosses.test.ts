import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P-ID.4 — « Immobilier net » retranche la dette **adossée aux biens**.
 *
 * Mesuré sur le compte de démonstration (2026-09-13, lecture seule) : la page
 * Immobilier annonçait 515 363,34 € d'equity — 694 111,22 € de biens moins
 * 178 747,88 € de prêts rattachés — et le tableau de bord 509 163,34 € pour la
 * même poche, parce qu'il recomposait le net par
 * -- immobilier − passifs totaux --, donc en y comptant 6 200 € de crédit auto.
 * Un écart de 6 200,00 €, très au-delà du centime d'identité.
 *
 * Le contrat publie donc l'attribution : `liabilitiesRealEstate` (part adossée)
 * et `immobilierNet`. Rien n'est retranché de `pockets.immobilier`, qui reste
 * la valeur brute, et `net` continue de déduire **tous** les passifs — les deux
 * grandeurs déjà consommées ne changent pas de définition.
 *
 * L'attribution suit le lien `Liability.assetId` et la poche de l'actif pointé,
 * jamais `Liability.category` : un prêt étiqueté « IMMOBILIER » sans bien
 * rattaché ne dit pas quel bien il porte. Il pèse sur le patrimoine net et
 * laisse l'immobilier à sa valeur brute — la lecture prudente.
 */

import { d } from "@/app/lib/money/decimal";
import {
  checkPatrimonyIdentities,
  computePatrimonyMetrics,
  serializePatrimonyMetrics,
  type ClassifiableHolding,
} from "@/app/lib/portfolio/patrimony-metrics";

const BIENS: ClassifiableHolding[] = [
  {
    id: "apt",
    name: "Appartement Locatif Lyon",
    assetClass: "IMMOBILIER",
    accountType: "IMMOBILIER",
    marketValueEur: "624000.00",
    hasRealEstateDetail: true,
  },
  {
    id: "scpi",
    name: "SCPI Epargne Pierre",
    assetClass: "IMMOBILIER",
    accountType: "IMMOBILIER",
    marketValueEur: "70111.22",
    hasIndirectRealEstateDetail: true,
  },
  {
    id: "aapl",
    name: "Apple",
    assetClass: "ACTIONS",
    accountType: "CTO",
    marketValueEur: "100000.00",
  },
];

function metrics(liabilities: Parameters<typeof computePatrimonyMetrics>[0]["liabilities"]) {
  return computePatrimonyMetrics({
    holdings: BIENS,
    cash: "0",
    alternatives: "0",
    employeeSavings: "0",
    liabilities,
    asOf: "2026-09-13T08:00:00.000Z",
  });
}

describe("immobilierNet — la dette des biens, pas celle du patrimoine", () => {
  it("retranche la part adossee et laisse le credit auto de cote", () => {
    const m = metrics({ total: "184947.88", realEstateBacked: "178747.88" });

    expect(m.pockets.immobilier.toString()).toBe("694111.22");
    expect(m.immobilierNet.toString()).toBe("515363.34");
    // Le chiffre que le tableau de bord affichait, et qu'il ne doit plus
    // afficher : 6 200 € de crédit auto retirés de l'immobilier.
    expect(m.immobilierNet.toString()).not.toBe("509163.34");
    expect(
      m.pockets.immobilier.minus(m.pockets.passifs).toString()
    ).toBe("509163.34");
  });

  it("ne change ni le brut, ni le net, ni les passifs", () => {
    const m = metrics({ total: "184947.88", realEstateBacked: "178747.88" });
    // Brut : l'immobilier y entre brut, comme avant.
    expect(m.brut.toString()).toBe("794111.22");
    // Net : tous les passifs, y compris ceux qui ne portent aucun bien.
    expect(m.net.toString()).toBe("609163.34");
    expect(m.pockets.passifs.toString()).toBe("184947.88");
  });

  it("un montant de passifs nu reste accepte : aucune dette immobiliere supposee", () => {
    const m = metrics("184947.88");
    expect(m.liabilitiesRealEstate.toString()).toBe("0");
    // Prudence : sans attribution, l'immobilier ne se lit pas plus endette
    // qu'on ne peut le demontrer.
    expect(m.immobilierNet.toString()).toBe("694111.22");
  });

  it("un net negatif n'est pas clampe : la dette ne disparait pas de l'ecran", () => {
    const m = metrics({ total: "800000.00", realEstateBacked: "800000.00" });
    expect(m.immobilierNet.toString()).toBe("-105888.78");
  });

  it("les identites tiennent, et la part immobiliere reste un sous-ensemble", () => {
    const ok = checkPatrimonyIdentities(
      metrics({ total: "184947.88", realEstateBacked: "178747.88" })
    );
    expect(ok.ok).toBe(true);
    expect(ok.immoNetVsImmoMinusDette.lte(d("0.01"))).toBe(true);
    expect(ok.detteImmoMinusPassifs.lte(d("0.01"))).toBe(true);

    // Plus de dette immobiliere que de passifs : double attribution, refusee.
    const faux = checkPatrimonyIdentities(
      metrics({ total: "100.00", realEstateBacked: "200.00" })
    );
    expect(faux.ok).toBe(false);
    expect(faux.detteImmoMinusPassifs.toString()).toBe("100");
  });

  it("les deux champs sont serialises pour l'API", () => {
    const json = serializePatrimonyMetrics(
      metrics({ total: "184947.88", realEstateBacked: "178747.88" }),
      2
    );
    expect(json.liabilitiesRealEstate).toBe("178747.88");
    expect(json.immobilierNet).toBe("515363.34");
  });
});

/**
 * L'attribution elle-même, côté lecture.
 *
 * `getLiabilityTotalsEur` est la seule à décider quelle dette porte un bien.
 * Le test fournit les taux : aucune lecture ne doit appeler le réseau (T-04).
 */
const { db, fakePrisma } = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const db: { liabilities: Row[] } = { liabilities: [] };
  const fakePrisma = {
    liability: {
      findMany: async ({ where }: { where?: { userId?: string } }) =>
        db.liabilities.filter((l) => !where?.userId || l.userId === where.userId),
    },
  };
  return { db, fakePrisma };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

const TAUX = { EUR: 1, USD: 1.25 };

function pret(
  name: string,
  remainingAmount: string,
  asset: Record<string, unknown> | null,
  currency = "EUR"
) {
  return {
    id: name,
    userId: "u1",
    name,
    currency,
    remainingAmount,
    monthlyPayment: null,
    paymentDay: null,
    startDate: null,
    endDate: null,
    lastPaymentAppliedAt: null,
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    interestRate: null,
    asset,
  };
}

const BIEN = {
  id: "apt",
  assetClass: "IMMOBILIER",
  accountType: "IMMOBILIER",
  realEstate: { assetId: "apt" },
  indirectRealEstate: null,
};
const SCPI = {
  id: "scpi",
  assetClass: "IMMOBILIER",
  accountType: "IMMOBILIER",
  realEstate: null,
  indirectRealEstate: { assetId: "scpi" },
};
const TITRE = {
  id: "aapl",
  assetClass: "ACTIONS",
  accountType: "CTO",
  realEstate: null,
  indirectRealEstate: null,
};

describe("getLiabilityTotalsEur — quelle dette porte un bien", () => {
  beforeEach(() => {
    db.liabilities = [];
  });

  it("somme tout, n'attribue que les prets rattaches a un bien", async () => {
    db.liabilities = [
      pret("Credit immo Lyon", "178500", BIEN),
      pret("Credit immo Lyon 2006", "247.88", BIEN),
      pret("Credit conso auto", "6200", null),
      pret("Pret SCPI", "1000", SCPI),
      pret("Credit lombard", "5000", TITRE),
      pret("Pret en dollars sur le bien", "1250", BIEN, "USD"),
    ];
    const { getLiabilityTotalsEur } = await import("@/app/lib/portfolio/service");
    const t = await getLiabilityTotalsEur("u1", TAUX);

    expect(t.totalEur.toFixed(2)).toBe("191947.88");
    // 178 500 + 247,88 + 1 000 (SCPI) + 1 000 (1 250 USD converti) :
    // ni le credit auto sans bien, ni le lombard adosse a des titres.
    expect(t.realEstateBackedEur.toFixed(2)).toBe("180747.88");
  });

  it("aucun passif : deux zeros, pas un inconnu", async () => {
    const { getLiabilityTotalsEur } = await import("@/app/lib/portfolio/service");
    const t = await getLiabilityTotalsEur("u1", TAUX);
    expect(t.totalEur.toString()).toBe("0");
    expect(t.realEstateBackedEur.toString()).toBe("0");
  });

  it("un pret sans bien rattache laisse l'immobilier a sa valeur brute", async () => {
    db.liabilities = [pret("Credit immo non rattache", "50000", null)];
    const { getLiabilityTotalsEur } = await import("@/app/lib/portfolio/service");
    const t = await getLiabilityTotalsEur("u1", TAUX);
    expect(t.totalEur.toFixed(2)).toBe("50000.00");
    expect(t.realEstateBackedEur.toString()).toBe("0");
  });
});
