import { describe, expect, it } from "vitest";

/**
 * Un fonds euro déjà repris au journal ne doit pas être repris une seconde fois.
 *
 * La migration testait la présence d'un fonds euro parmi les seuls supports
 * « à migrer » (`tableOnly`). Or un fonds euro déjà repris tombe par
 * construction dans `duplicates` ou dans `ledgerOnly` — jamais dans
 * `tableOnly`. Le seul panier consulté était donc le seul où il ne pouvait pas
 * se trouver, et le champ `cashEuro` du contrat créait une position en trop :
 * 15 200 € sur le contrat Spirica du compte de démonstration.
 *
 * Le piège de la correction est symétrique et coûte de l'argent plutôt que d'en
 * inventer : les positions du journal sont rapprochées contre un pool commun à
 * tous les contrats. Chercher « un fonds euro quelque part au journal »
 * conclurait au doublon pour un contrat qui n'en a pas, et solderait un
 * `cashEuro` légitime — 5 000 € sur le contrat Generali. D'où la clé de
 * contrat, et le test F qui la verrouille.
 */

import {
  euroFundAlreadyTaken,
  reconcileSupports,
} from "@/app/lib/life-insurance/reconcile";

const SPIRICA = "contrat-spirica";
const GENERALI = "contrat-generali";

const t = (name: string) => ({ id: `t-${name}`, name, valueEur: "15200" });

describe("euroFundAlreadyTaken", () => {
  it("A. aucun fonds euro nulle part : la reprise doit avoir lieu", () => {
    expect(
      euroFundAlreadyTaken({
        contractId: SPIRICA,
        tableOnly: [t("UC Carmignac Patrimoine")],
        contractsWithLedgerEuroFund: new Set(),
      })
    ).toBe(false);
  });

  it("B. fonds euro déjà au journal du même contrat : ne rien reprendre", () => {
    expect(
      euroFundAlreadyTaken({
        contractId: SPIRICA,
        tableOnly: [t("UC Carmignac Patrimoine")],
        contractsWithLedgerEuroFund: new Set([SPIRICA]),
      })
    ).toBe(true);
  });

  it("C. fonds euro dans la table ET au journal : ne rien reprendre", () => {
    /*
      Le cas le plus dommageable avant correction : la ligne de table partait
      comme doublon — donc hors de `tableOnly` — et le champ créait quand même
      une position. Le journal y gagnait un fantôme au lieu d'en perdre un.
    */
    expect(
      euroFundAlreadyTaken({
        contractId: SPIRICA,
        tableOnly: [],
        contractsWithLedgerEuroFund: new Set([SPIRICA]),
      })
    ).toBe(true);
  });

  it("C'. fonds euro dans la table seule : une reprise, une seule", () => {
    expect(
      euroFundAlreadyTaken({
        contractId: SPIRICA,
        tableOnly: [t("Fonds euro Spirica")],
        contractsWithLedgerEuroFund: new Set(),
      })
    ).toBe(true);
  });

  it("E. UC neuve et fonds euro déjà au journal : l'UC seule est reprise", () => {
    // La fonction ne décide que du fonds euro ; l'UC suit son propre chemin.
    expect(
      euroFundAlreadyTaken({
        contractId: SPIRICA,
        tableOnly: [t("UC Carmignac Patrimoine")],
        contractsWithLedgerEuroFund: new Set([SPIRICA]),
      })
    ).toBe(true);
  });

  it("F. le fonds euro d'un AUTRE contrat ne bloque pas celui-ci", () => {
    /*
      Le test qui protège les 5 000 € de Generali. Spirica porte un fonds euro
      au journal, Generali non : la reprise de Generali doit avoir lieu.
    */
    expect(
      euroFundAlreadyTaken({
        contractId: GENERALI,
        tableOnly: [t("ETF World tracker")],
        contractsWithLedgerEuroFund: new Set([SPIRICA]),
      })
    ).toBe(false);
  });

  it("F′. et réciproquement, chaque contrat répond pour lui-même", () => {
    const deux = new Set([SPIRICA, GENERALI]);
    expect(
      euroFundAlreadyTaken({ contractId: SPIRICA, tableOnly: [], contractsWithLedgerEuroFund: deux })
    ).toBe(true);
    expect(
      euroFundAlreadyTaken({ contractId: GENERALI, tableOnly: [], contractsWithLedgerEuroFund: deux })
    ).toBe(true);
  });

  it("un Euro Stoxx n'est pas un fonds en euros", () => {
    // `isEuroFundName` sait déjà faire la différence — on verrouille qu'elle
    // reste utilisée, sinon Generali serait bloqué par son Amundi Euro Stoxx 50.
    expect(
      euroFundAlreadyTaken({
        contractId: GENERALI,
        tableOnly: [t("Amundi Euro Stoxx 50")],
        contractsWithLedgerEuroFund: new Set(),
      })
    ).toBe(false);
  });

  it("idempotence : une fois repris, le fonds euro reste reconnu", () => {
    /*
      Après une exécution réelle, la position créée porte `kind = FONDS_EURO` et
      son contrat : le tour suivant la retrouve dans l'ensemble et ne recrée
      rien. C'est cette propriété qui manquait.
    */
    const apresMigration = new Set([SPIRICA]);
    for (const _ of [1, 2, 3]) {
      expect(
        euroFundAlreadyTaken({
          contractId: SPIRICA,
          tableOnly: [],
          contractsWithLedgerEuroFund: apresMigration,
        })
      ).toBe(true);
    }
  });
});

describe("le compte de démonstration, reconstitué", () => {
  /*
    Les deux contrats du seed, avec leurs positions AV au journal. On rejoue la
    décision de la migration sur ces données pour figer le montant proposé : le
    test échoue si la reprise du fonds euro Spirica revenait.
  */
  const LEDGER = [
    { assetId: "a1", name: "Amundi MSCI World", marketValueEur: "87300.00" },
    { assetId: "a2", name: "Fonds euro Linxea", marketValueEur: "25500.00" },
    { assetId: "a3", name: "Amundi Euro Stoxx 50", marketValueEur: "5568.00" },
  ];
  // Seul Spirica porte un support `kind = FONDS_EURO` au journal.
  const AVEC_FONDS_EURO = new Set([SPIRICA]);

  const CONTRATS = [
    {
      id: GENERALI,
      cash: 5000,
      produits: [{ id: "p1", name: "ETF World tracker", valueEur: "9200" }],
    },
    {
      id: SPIRICA,
      cash: 15200,
      produits: [{ id: "p2", name: "UC Carmignac Patrimoine", valueEur: "8400" }],
    },
  ];

  /** Reproduit la boucle de `migrateLifeInsuranceToLedger`, pool compris. */
  const proposer = () => {
    const restant = [...LEDGER];
    const creees: Array<{ name: string; valueEur: string }> = [];
    for (const c of CONTRATS) {
      const r = reconcileSupports(c.produits, restant);
      const pris = new Set(r.duplicates.map((dp) => dp.ledger.assetId));
      for (let i = restant.length - 1; i >= 0; i -= 1) {
        if (pris.has(restant[i]!.assetId)) restant.splice(i, 1);
      }
      creees.push(...r.tableOnly.map((x) => ({ name: x.name, valueEur: x.valueEur })));
      const dejaPris = euroFundAlreadyTaken({
        contractId: c.id,
        tableOnly: r.tableOnly,
        contractsWithLedgerEuroFund: AVEC_FONDS_EURO,
      });
      if (c.cash > 0 && !dejaPris) {
        creees.push({ name: `Fonds euro ${c.id}`, valueEur: String(c.cash) });
      }
    }
    return creees;
  };

  it("propose 22 600 € et trois positions, jamais 37 800 €", () => {
    const creees = proposer();
    const total = creees.reduce((a, x) => a + Number(x.valueEur), 0);

    expect(creees).toHaveLength(3);
    expect(total).toBe(22600);
    // Le montant d'avant correction, qui gonflait le patrimoine de 15 200 €.
    expect(total).not.toBe(37800);
  });

  it("reprend le fonds euro de Generali et pas celui de Spirica", () => {
    const noms = proposer().map((x) => x.name);
    expect(noms).toContain(`Fonds euro ${GENERALI}`);
    expect(noms).not.toContain(`Fonds euro ${SPIRICA}`);
    expect(noms).toContain("ETF World tracker");
    expect(noms).toContain("UC Carmignac Patrimoine");
  });

  it("porte l'encours AV à 140 968 €, pas à 156 168 €", () => {
    const AVANT = 118368;
    const apres = AVANT + proposer().reduce((a, x) => a + Number(x.valueEur), 0);
    expect(apres).toBe(140968);
    expect(apres).not.toBe(156168);
  });

  it("idempotence : la seconde passe ne propose plus rien", () => {
    /*
      Après reprise, le fonds euro de Generali porte à son tour
      `kind = FONDS_EURO` et son contrat, et ses UC sont au journal : la passe
      suivante ne trouve plus rien à créer. C'est la propriété qui manquait.
    */
    const apresMigration = new Set([SPIRICA, GENERALI]);
    for (const c of CONTRATS) {
      expect(
        euroFundAlreadyTaken({
          contractId: c.id,
          tableOnly: [],
          contractsWithLedgerEuroFund: apresMigration,
        }),
        c.id
      ).toBe(true);
    }
  });
});
