import { beforeEach, describe, expect, it, vi } from "vitest";

import { toEur } from "@/app/lib/accounting/fx";
import { parisDayKey } from "@/app/lib/dates/paris";
import { d, toFixed } from "@/app/lib/money/decimal";

/**
 * Devise et taux d'un support repris depuis la table historique.
 *
 * ## Ce que ce fichier tient
 *
 * 1. **La devise du produit est la sienne**, pas celle du contrat.
 *    `LifeInsuranceProduct.currency` est un `String @default("EUR")` non
 *    nullable : chaque ligne porte sa devise. Le chargement la jetait et la
 *    migration écrivait `currency: c.currency` avec `fxRateToEur: "1"` — un
 *    produit de 10 000 USD devenait une position de 10 000 €, et un produit en
 *    euros dans un contrat en dollars subissait un change qu'il ne demandait
 *    pas.
 *
 * 2. **Le taux est celui du jour, la date est aujourd'hui.** La correction
 *    précédente datait la reprise de l'ouverture du contrat et convertissait au
 *    taux de ce jour-là (`fxRateToEurOnDate`). Le montant repris, lui, est la
 *    valorisation d'aujourd'hui : le prix de revient sortait à un taux et la
 *    valeur de marché à un autre, l'écart s'affichant en plus-value. Mesuré :
 *    +362,46 € sur un support de 10 000 USD, le jour même de la reprise.
 *
 *    D'où le test qui porte la décision : **plus-value latente nulle à la
 *    reprise**, vérifiée en confrontant les deux chaînes réelles — `toEur`
 *    côté journal, `convertToEurSync` côté positions.
 *
 * 3. **Une devise sans taux fondé n'écrit rien** : ligne de table conservée,
 *    `cashEuro` non soldé, erreur nommant le support, et une relance reprend le
 *    support quand le taux revient.
 */

const lifeInsuranceFindMany = vi.fn();
const lifeInsuranceUpdateMany = vi.fn();
const supportFindMany = vi.fn();
const productDeleteMany = vi.fn();
const platformFindFirst = vi.fn();
const getHoldings = vi.fn();
const createTransaction = vi.fn();
const assetCreate = vi.fn();
const fxRateToEur = vi.fn();
const fxRateToEurOnDate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    lifeInsurance: {
      findMany: (...a: unknown[]) => lifeInsuranceFindMany(...a),
      updateMany: (...a: unknown[]) => lifeInsuranceUpdateMany(...a),
    },
    lifeInsuranceSupport: { findMany: (...a: unknown[]) => supportFindMany(...a) },
    lifeInsuranceProduct: { deleteMany: (...a: unknown[]) => productDeleteMany(...a) },
    platform: { findFirst: (...a: unknown[]) => platformFindFirst(...a) },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        asset: {
          create: async (...a: unknown[]) => {
            assetCreate(...a);
            return { id: "asset-neuf" };
          },
        },
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

/*
  Mock partiel : `FxRateUnknownError` et `convertToEurSync` restent les vrais.

  La classe d'erreur doit être celle que le module sous test reconnaît par
  `instanceof`, et la conversion servant à mesurer la plus-value doit être celle
  que `getHoldings` utilise en production — pas une réimplémentation qui
  vérifierait l'arithmétique du test contre elle-même.

  `fxRateToEurOnDate` est enveloppé pour une seule raison : prouver qu'il n'est
  plus appelé sur le chemin de reprise.
*/
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return {
    ...actual,
    fxRateToEur: (...a: unknown[]) => fxRateToEur(...a),
    fxRateToEurOnDate: (...a: unknown[]) => fxRateToEurOnDate(...a),
  };
});

import { convertToEurSync, FxRateUnknownError } from "@/app/lib/market/fx";
import { migrateLifeInsuranceToLedger } from "@/app/lib/life-insurance/migrate-to-ledger";

const USER = "u1";
const CONTRAT = "contrat-linxea";
const OUVERTURE = new Date("2015-03-02T00:00:00.000Z");

/**
 * Taux tels que `rateOf` les fonde : 1 EUR = X devise.
 *
 * Ce sont les valeurs de la table déclarée de `app/lib/market/fx.ts`, celles
 * que le repli sert quand le fournisseur est muet.
 */
const TAUX_VIVANTS: Record<string, number> = { EUR: 1, USD: 1.08, CHF: 0.96, JPY: 160 };

/** Ce que rend `fxRateToEur(cur)` : 1 unité de `cur` en euros, dix décimales. */
const tauxToEur = (cur: string) =>
  cur === "EUR" ? "1" : toFixed(d(1).div(TAUX_VIVANTS[cur]!), 10);

const dec = (v: string) => ({ toString: () => v });

/** Un contrat en euros portant un seul produit, dont la devise est libre. */
function contratEnEuros(produit: {
  id: string;
  name: string;
  currentValue: string;
  currency: string;
}) {
  return [
    {
      id: CONTRAT,
      insurer: "Linxea",
      cashEuro: dec("0"),
      currency: "EUR",
      openDate: OUVERTURE,
      products: [{ ...produit, currentValue: dec(produit.currentValue) }],
    },
  ];
}

type TxArg = {
  currency: string;
  fxRateToEur: string;
  unitPrice: string;
  quantity: string;
  occurredAt: string;
};
const txArg = (i = 0) => createTransaction.mock.calls[i]![0] as TxArg;
type AssetArg = {
  data: { currency: string; manualPrice: { toString(): string }; acquisitionDate: Date };
};
const assetArg = (i = 0) => assetCreate.mock.calls[i]![0] as AssetArg;

beforeEach(() => {
  lifeInsuranceFindMany.mockReset().mockResolvedValue([]);
  lifeInsuranceUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  supportFindMany.mockReset().mockResolvedValue([]);
  productDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  platformFindFirst.mockReset().mockResolvedValue({ id: "plat-1" });
  getHoldings.mockReset().mockResolvedValue([]);
  createTransaction.mockReset().mockResolvedValue({ id: "tx-1" });
  assetCreate.mockReset();
  fxRateToEurOnDate.mockReset().mockResolvedValue(null);
  // Taux du jour, par devise demandée.
  fxRateToEur.mockReset().mockImplementation(async (cur: string) => {
    if (TAUX_VIVANTS[cur] == null) throw new FxRateUnknownError(cur);
    return tauxToEur(cur);
  });
});

describe("un produit en devise garde sa devise", () => {
  it("l'actif et la transaction portent USD, jamais l'EUR du contrat", async () => {
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-usd",
        name: "UC Amundi S&P 500",
        currentValue: "10000",
        currency: "USD",
      })
    );

    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.created).toBe(1);
    expect(r.errors).toEqual([]);
    // Le montant reste celui du relevé : 10 000, en dollars.
    expect(txArg().unitPrice).toBe("10000");
    expect(txArg().currency).toBe("USD");
    expect(assetArg().data.currency).toBe("USD");
    // Et surtout : jamais la parité par défaut, qui valait 10 000 €.
    expect(txArg().fxRateToEur).toBe("0.9259259259");
  });

  it("le taux demandé est celui du jour, jamais celui d'une date", async () => {
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-usd",
        name: "UC Amundi S&P 500",
        currentValue: "10000",
        currency: "USD",
      })
    );

    await migrateLifeInsuranceToLedger(USER);

    // Un seul argument : la devise. Aucune date n'entre dans la résolution.
    expect(fxRateToEur).toHaveBeenCalledWith("USD");
    // Et le taux historique a quitté le chemin de reprise.
    expect(fxRateToEurOnDate).not.toHaveBeenCalled();
  });
});

describe("la date de la reprise", () => {
  const produitUsd = () =>
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-usd",
        name: "UC Amundi S&P 500",
        currentValue: "10000",
        currency: "USD",
      })
    );

  it("la transaction est datée d'aujourd'hui, jour civil de Paris", async () => {
    produitUsd();
    const avant = Date.now();

    await migrateLifeInsuranceToLedger(USER);

    const occurredAt = new Date(txArg().occurredAt);
    expect(parisDayKey(occurredAt)).toBe(parisDayKey(new Date()));
    // Pas l'ouverture du contrat : c'était la valorisation d'aujourd'hui datée
    // d'il y a dix ans.
    expect(occurredAt.getTime()).not.toBe(OUVERTURE.getTime());
    /*
      L'instant courant, pas minuit heure de Paris.

      Les deux appartiennent au jour civil parisien d'aujourd'hui ; seul
      l'instant courant se range après les écritures déjà saisies dans la
      journée, et se rend en UTC sur la bonne date. Minuit Paris serait à
      plusieurs heures d'ici — la fenêtre de dix secondes les sépare.
    */
    expect(occurredAt.getTime()).toBeGreaterThanOrEqual(avant);
    expect(occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it("tous les supports d'un même passage portent le même instant", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      {
        id: CONTRAT,
        insurer: "Linxea",
        cashEuro: dec("15200"),
        currency: "EUR",
        openDate: OUVERTURE,
        products: [
          { id: "p1", name: "UC S&P 500", currentValue: dec("10000"), currency: "USD" },
          { id: "p2", name: "UC Small Caps", currentValue: dec("4000"), currency: "CHF" },
        ],
      },
    ]);

    const r = await migrateLifeInsuranceToLedger(USER);

    // Deux produits + le fonds euro du contrat.
    expect(r.created).toBe(3);
    const instants = new Set(
      createTransaction.mock.calls.map((c) => (c[0] as TxArg).occurredAt)
    );
    expect(instants.size).toBe(1);
  });
});

describe("la date d'acquisition de l'actif", () => {
  it("reste l'ouverture du contrat, quand la transaction est du jour", async () => {
    /*
      Deux dates, deux questions. `acquisitionDate` dit depuis quand la position
      est détenue ; `occurredAt` dit quand le journal l'a apprise. Un support
      souscrit en 2015 n'a pas été acquis ce matin, et ce champ ne porte aucun
      montant : il n'alimente ni prix de revient, ni série historique.
    */
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-usd",
        name: "UC Amundi S&P 500",
        currentValue: "10000",
        currency: "USD",
      })
    );

    await migrateLifeInsuranceToLedger(USER);

    expect(assetArg().data.acquisitionDate.getTime()).toBe(OUVERTURE.getTime());
    expect(new Date(txArg().occurredAt).getTime()).toBeGreaterThan(
      OUVERTURE.getTime()
    );
  });

  it("retombe sur l'instant de reprise si l'ouverture manque ou est future", async () => {
    // Une acquisition future n'est pas une acquisition : c'est une donnée fausse.
    const futur = new Date(Date.now() + 365 * 24 * 3600_000);
    for (const openDate of [null, futur]) {
      assetCreate.mockClear();
      createTransaction.mockClear();
      lifeInsuranceFindMany.mockResolvedValue([
        {
          id: CONTRAT,
          insurer: "Linxea",
          cashEuro: dec("0"),
          currency: "EUR",
          openDate,
          products: [
            { id: "p1", name: "UC S&P 500", currentValue: dec("10000"), currency: "USD" },
          ],
        },
      ]);

      await migrateLifeInsuranceToLedger(USER);

      expect(assetArg().data.acquisitionDate.toISOString()).toBe(
        txArg().occurredAt
      );
    }
  });
});

describe("plus-value latente nulle à la reprise", () => {
  it("le coût en euros du journal égale la valeur en euros des positions", async () => {
    /*
      Le cœur de la décision, mesuré sur les deux chaînes réelles :

      - journal    : `costBasisEur = toEur(unitPrice, fxRateToEur)`
                     (`accounting/ledger.ts`, cas ACHAT) ;
      - positions  : `priceEur = convertToEurSync(manualPrice, devise, taux)`
                     (`portfolio/service.ts`), × quantité.

      Même taux des deux côtés, donc même produit `montant × taux` : l'écart ne
      peut plus valoir que l'arrondi du taux à dix décimales.
    */
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-usd",
        name: "UC Amundi S&P 500",
        currentValue: "10000",
        currency: "USD",
      })
    );

    await migrateLifeInsuranceToLedger(USER);

    const tx = txArg();
    const coutEur = toEur(tx.unitPrice, tx.fxRateToEur).times(d(tx.quantity));
    const valeurEur = d(
      convertToEurSync(
        assetArg().data.manualPrice.toString(),
        assetArg().data.currency,
        TAUX_VIVANTS
      )
    ).times(d(tx.quantity));

    const plusValue = valeurEur.minus(coutEur);
    // Au centime, et bien au-delà : 2,6 x 10^-7 € sur 10 000 USD.
    expect(toFixed(plusValue, 2)).toBe("0.00");
    expect(plusValue.abs().lt(d("0.000001"))).toBe(true);
    // Le repère chiffré, pour que la mesure soit lisible sans la relancer.
    expect(toFixed(coutEur, 6)).toBe("9259.259259");
    expect(toFixed(valeurEur, 6)).toBe("9259.259259");
  });

  it("un taux historique produirait la plus-value que la décision supprime", async () => {
    /*
      Le contre-exemple, pour que la valeur du test précédent soit visible : au
      taux du 02/03/2015 (1 EUR = 1,124 USD), les 10 000 USD d'aujourd'hui
      entraient au journal pour 8 896,80 € tandis que les positions les
      valorisaient 9 259,26 €. La différence s'affichait comme un gain.
    */
    const tauxDe2015 = "0.8896797153";
    const coutHistorique = toEur("10000", tauxDe2015);
    const valeurDuJour = d(convertToEurSync("10000", "USD", TAUX_VIVANTS));

    expect(toFixed(coutHistorique, 2)).toBe("8896.80");
    expect(toFixed(valeurDuJour, 2)).toBe("9259.26");
    expect(toFixed(valeurDuJour.minus(coutHistorique), 2)).toBe("362.46");
  });
});

describe("les deux devises du contrat", () => {
  it("un produit en euros dans un contrat en dollars n'est pas converti", async () => {
    /*
      Le piège symétrique. Le contrat est libellé en dollars, le produit en
      euros : c'est la devise du produit qui commande, et `fxRateToEur` rend
      « 1 » pour l'euro sans rien demander à personne.
    */
    lifeInsuranceFindMany.mockResolvedValue([
      {
        id: CONTRAT,
        insurer: "Linxea",
        cashEuro: dec("0"),
        currency: "USD",
        openDate: OUVERTURE,
        products: [
          {
            id: "prod-eur",
            name: "UC Carmignac Patrimoine",
            currentValue: dec("8400"),
            currency: "EUR",
          },
        ],
      },
    ]);

    await migrateLifeInsuranceToLedger(USER);

    expect(fxRateToEur).toHaveBeenCalledWith("EUR");
    expect(txArg().currency).toBe("EUR");
    expect(txArg().fxRateToEur).toBe("1");
    expect(assetArg().data.currency).toBe("EUR");
  });

  it("le fonds euro du contrat, lui, prend la devise du contrat", async () => {
    /*
      `cashEuro` est un champ du contrat : aucune ligne de produit ne le porte,
      donc aucune devise de produit ne peut le décrire. C'est le seul support
      pour lequel la devise du contrat est la bonne réponse.
    */
    lifeInsuranceFindMany.mockResolvedValue([
      {
        id: CONTRAT,
        insurer: "Linxea",
        cashEuro: dec("15200"),
        currency: "CHF",
        openDate: OUVERTURE,
        products: [],
      },
    ]);

    await migrateLifeInsuranceToLedger(USER);

    expect(fxRateToEur).toHaveBeenCalledWith("CHF");
    expect(txArg().currency).toBe("CHF");
    expect(txArg().fxRateToEur).toBe(tauxToEur("CHF"));
  });
});

describe("taux non fondé", () => {
  /** Aucune source ne dit ce que vaut un dirham : ni le fournisseur, ni la table. */
  function produitEnAed() {
    lifeInsuranceFindMany.mockResolvedValue(
      contratEnEuros({
        id: "prod-aed",
        name: "UC Emirates",
        currentValue: "10000",
        currency: "AED",
      })
    );
  }

  it("le support n'est pas repris, et sa ligne de table survit", async () => {
    produitEnAed();
    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.created).toBe(0);
    expect(createTransaction).not.toHaveBeenCalled();
    /*
      Le point : la ligne historique reste en place. La supprimer sans avoir
      écrit sa position ferait disparaître 10 000 AED du patrimoine — et la
      migration étant idempotente, une relance après retour du taux la
      reprendra.
    */
    expect(productDeleteMany).not.toHaveBeenCalled();
  });

  it("l'erreur nomme le contrat, le support et la devise", async () => {
    produitEnAed();
    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("Linxea");
    expect(r.errors[0]).toContain("UC Emirates");
    expect(r.errors[0]).toContain("AED");
    expect(r.errors[0]).toContain("non repris");
  });

  it("le fonds euro du contrat n'est pas soldé quand son taux manque", async () => {
    /*
      Le seul cas de perte sèche que la migration pouvait produire : vider
      `cashEuro` sans qu'aucune position ne porte ces montants. La condition
      porte sur la création de SA position, pas sur l'absence globale d'erreurs.
    */
    lifeInsuranceFindMany.mockResolvedValue([
      {
        id: CONTRAT,
        insurer: "Linxea",
        cashEuro: dec("15200"),
        currency: "AED",
        openDate: OUVERTURE,
        products: [],
      },
    ]);

    const r = await migrateLifeInsuranceToLedger(USER);

    expect(r.created).toBe(0);
    expect(r.errors).toHaveLength(1);
    expect(lifeInsuranceUpdateMany).not.toHaveBeenCalled();
  });

  it("une relance reprend le support dès que le taux existe", async () => {
    produitEnAed();
    const premier = await migrateLifeInsuranceToLedger(USER);
    expect(premier.created).toBe(0);

    // Le fournisseur sait désormais coter le dirham (1 EUR = 4,05 AED).
    fxRateToEur.mockImplementation(async () => toFixed(d(1).div(4.05), 10));
    const second = await migrateLifeInsuranceToLedger(USER);

    expect(second.created).toBe(1);
    expect(second.errors).toEqual([]);
    expect(txArg().currency).toBe("AED");
    // La ligne de table n'est retirée qu'une fois la position écrite.
    expect(productDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("le mode à blanc ne l'annonce pas comme créable", async () => {
    /*
      Le nombre que l'opérateur lit avant `--apply`. Il comptait
      `pending.length` sans résoudre aucun taux : un support voué à l'échec
      était annoncé comme une position à créer.
    */
    produitEnAed();
    const r = await migrateLifeInsuranceToLedger(USER, { dryRun: true });

    expect(r.created).toBe(0);
    expect(r.errors).toHaveLength(1);
    // À blanc reste à blanc : aucune écriture, pas même une plateforme.
    expect(platformFindFirst).not.toHaveBeenCalled();
    expect(createTransaction).not.toHaveBeenCalled();
    expect(productDeleteMany).not.toHaveBeenCalled();
  });

  it("à blanc et pour de vrai comptent la même chose", async () => {
    lifeInsuranceFindMany.mockResolvedValue([
      {
        id: CONTRAT,
        insurer: "Linxea",
        cashEuro: dec("0"),
        currency: "EUR",
        openDate: OUVERTURE,
        products: [
          {
            id: "p-usd",
            name: "UC S&P 500",
            currentValue: dec("10000"),
            currency: "USD",
          },
          {
            id: "p-aed",
            name: "UC Emirates",
            currentValue: dec("10000"),
            currency: "AED",
          },
        ],
      },
    ]);

    const blanc = await migrateLifeInsuranceToLedger(USER, { dryRun: true });
    const reel = await migrateLifeInsuranceToLedger(USER);

    expect(blanc.created).toBe(1);
    expect(reel.created).toBe(1);
    expect(blanc.errors).toEqual(reel.errors);
  });
});
