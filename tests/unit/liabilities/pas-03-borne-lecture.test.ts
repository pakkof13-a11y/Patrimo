import { describe, expect, it } from "vitest";

/**
 * PAS-03 — la borne de PAS-02 s'applique aussi a la lecture.
 *
 * PAS-02 a scelle `lastPaymentAppliedAt` sur le chemin d'ecriture : une dette
 * anterieure a PAS-01 ne voit plus des annees d'echeances s'inscrire d'un coup.
 * Les lecteurs, eux, passaient la ligne brute a `remainingAmountAt` : faute de
 * borne, `duePaymentDates` repartait de `startDate` et l'affichage rejouait
 * l'amortissement depuis l'origine du pret — sur un solde stocke deja a jour.
 *
 * Les deux dettes non bornees du compte de demonstration en donnent la mesure,
 * reprise ici a l'identique :
 *
 *     pret                stocke        affiche avant   ecart
 *     Credit immo Lyon    178 500,00    136 720,72      −41 779,28
 *     Credit conso auto     6 200,00          0,00       −6 200,00
 *
 * La regle appliquee est celle de l'ecriture, sans ecrire : la seule date ou
 * `remainingAmount` soit connu vrai est `updatedAt`. Aucune echeance anterieure
 * n'est rejouee, et celles qui tombent apres cette date le sont toujours.
 */

import {
  duePaymentDates,
  effectivePaymentBaseline,
  projectDuePayments,
  projectDuePaymentsForLiability,
  remainingAmountAt,
  startOfUtcDay,
} from "@/app/lib/liabilities/amortization";
import { paymentBaselineFor } from "@/app/lib/liabilities/payment-baseline";

/** Jour du seed sur la base de demonstration : derniere ecriture des lignes. */
const MAJ = new Date("2026-09-13T09:47:24.285Z");
/** Meme jour : aucun jour de prelevement n'est encore passe depuis `MAJ`. */
const MAINTENANT = new Date("2026-09-13T22:00:00.000Z");

/** « Credit immo Lyon » — non borne, depart il y a bientot cinq ans. */
const IMMO = {
  remainingAmount: "178500",
  monthlyPayment: "980",
  interestRate: "2.15",
  paymentDay: 5,
  startDate: new Date("2021-10-04T14:05:00.000Z"),
  endDate: new Date("2051-09-07T03:35:00.000Z"),
  lastPaymentAppliedAt: null as Date | null,
  updatedAt: MAJ,
};

/** « Credit conso auto » — non borne, et que le rattrapage affichait soldee. */
const AUTO = {
  remainingAmount: "6200",
  monthlyPayment: "320",
  interestRate: "3.9",
  paymentDay: 12,
  startDate: new Date("2024-10-13T08:00:00.000Z"),
  endDate: new Date("2027-04-01T04:00:00.000Z"),
  lastPaymentAppliedAt: null as Date | null,
  updatedAt: MAJ,
};

describe("l'ampleur du rattrapage a l'affichage", () => {
  it("avant : sans borne, la lecture rejoue cinq ans d'echeances", () => {
    /*
      La mesure « avant », prise sur la primitive telle que les lecteurs
      l'appelaient : `lastPaymentAppliedAt: null` y vaut encore « repartir de
      `startDate` », et c'est bien 60 echeances qui defilaient.
    */
    const avant = projectDuePayments({ ...IMMO, now: MAINTENANT });
    expect(avant.payments).toHaveLength(60);
    expect(avant.remaining).toBe("136720.72041758");

    /*
      23 jours de prelevement depuis le depart, dont 21 seulement trouvent
      encore du capital a amortir : la dette etait affichee soldee.
    */
    expect(duePaymentDates({ ...AUTO, now: MAINTENANT })).toHaveLength(23);
    const avantAuto = projectDuePayments({ ...AUTO, now: MAINTENANT });
    expect(avantAuto.payments).toHaveLength(21);
    expect(avantAuto.remaining).toBe("0.00000000");
  });

  it("apres : la lecture ne rejoue aucune echeance", () => {
    expect(projectDuePaymentsForLiability(IMMO, MAINTENANT).payments).toHaveLength(0);
    expect(projectDuePaymentsForLiability(AUTO, MAINTENANT).payments).toHaveLength(0);
  });

  it("apres : le montant affiche egale le solde stocke au centime", () => {
    // Pas « plus proche » : identique.
    expect(remainingAmountAt(IMMO, MAINTENANT)).toBe("178500.00000000");
    expect(remainingAmountAt(AUTO, MAINTENANT)).toBe("6200.00000000");
  });
});

describe("ce que la borne ne fait pas", () => {
  it("les echeances posterieures a la borne restent dues", () => {
    /*
      La correction coupe le rattrapage, pas l'amortissement : passe le premier
      jour de prelevement suivant `updatedAt`, la mensualite tombe et le solde
      lu baisse — sans quoi l'egalite au centime ci-dessus ne serait qu'un gel.
    */
    const p = projectDuePaymentsForLiability(IMMO, new Date("2026-10-06T00:00:00.000Z"));
    expect(p.payments).toHaveLength(1);
    expect(p.payments[0]!.eventDate.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(p.remaining).toBe("177839.81250000");
  });

  it("une dette deja bornee est lue exactement comme avant", () => {
    /*
      Garde de regression : tout ce qui a ete cree depuis PAS-01 porte une
      borne, et `updatedAt` ne doit jamais s'y substituer — ici il est bien
      posterieur au dernier prelevement, et n'a pourtant aucun effet.
    */
    const bornee = {
      ...IMMO,
      remainingAmount: "137454.44786515",
      lastPaymentAppliedAt: new Date("2026-06-05T00:00:00.000Z"),
    };
    const attendu = projectDuePayments({ ...bornee, now: MAINTENANT });

    const lu = projectDuePaymentsForLiability(bornee, MAINTENANT);
    expect(lu.payments).toHaveLength(3); // juillet, aout, septembre
    expect(lu.payments).toHaveLength(attendu.payments.length);
    expect(lu.remaining).toBe(attendu.remaining);
    expect(remainingAmountAt(bornee, MAINTENANT)).toBe(attendu.remaining);
  });

  it("la primitive partagee garde sa semantique — les loyers en dependent", () => {
    /*
      `duePaymentDates` est aussi celle du module Loyers, ou l'absence de
      curseur veut dire « proposer tous les loyers non constates depuis le debut
      du bail ». Elle n'est donc pas touchee : la borne est resolue en amont,
      dans le versant dettes.
    */
    expect(
      duePaymentDates({
        paymentDay: 5,
        startDate: new Date("2024-01-10T00:00:00.000Z"),
        endDate: null,
        lastPaymentAppliedAt: null,
        now: new Date("2024-06-30T00:00:00.000Z"),
      })
    ).toHaveLength(5);
  });
});

describe("la borne effective", () => {
  it("respecte la borne posee quand il y en a une", () => {
    const posee = new Date("2026-06-05T00:00:00.000Z");
    expect(
      effectivePaymentBaseline({ lastPaymentAppliedAt: posee, updatedAt: MAJ })
    ).toEqual(posee);
  });

  it("retombe sur la derniere ecriture de la ligne, jour entier", () => {
    expect(
      effectivePaymentBaseline({ lastPaymentAppliedAt: null, updatedAt: MAJ })
    ).toEqual(startOfUtcDay(MAJ));
  });

  it("est la meme regle que celle du chemin d'ecriture", () => {
    /*
      Une seule implementation : `paymentBaselineFor` delegue ici. Si les deux
      divergeaient, sceller une dette changerait le montant affiche — ce qui
      etait precisement le defaut corrige par PAS-02 cote ecriture.
    */
    expect(
      paymentBaselineFor({ id: "l1", lastPaymentAppliedAt: null, updatedAt: MAJ }, null)
    ).toEqual(effectivePaymentBaseline({ lastPaymentAppliedAt: null, updatedAt: MAJ }));
  });

  it("le lecteur ne descend jamais sous la borne que l'ecriture scellerait", () => {
    /*
      Seule difference assumee entre les deux versants : l'ecriture affine la
      borne avec le dernier `MONTHLY_DEBIT` inscrit — une requete que le lecteur
      ne fait pas, pour ne pas transformer chaque vue de liste en N+1. La borne
      scellee est donc superieure ou egale a celle lue, jamais en dessous : au
      pire le lecteur projette une echeance de plus, et les deux convergent des
      qu'elle est scellee.
    */
    const debitPosterieur = new Date("2026-09-30T12:00:00.000Z");
    const scellee = paymentBaselineFor(
      { id: "l1", lastPaymentAppliedAt: null, updatedAt: MAJ },
      debitPosterieur
    );
    const lue = effectivePaymentBaseline({ lastPaymentAppliedAt: null, updatedAt: MAJ });
    expect(scellee.getTime()).toBeGreaterThanOrEqual(lue.getTime());
  });
});
