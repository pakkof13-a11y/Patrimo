import { describe, expect, it } from "vitest";

/**
 * Le capital restant dû se calcule, il ne s'écrit pas pour être lu.
 *
 * Le module Crédits amortissait en base avant de répondre : un GET écrivait
 * 79 `LiabilityEvent` sur le compte de démonstration, et le patrimoine net
 * valait 64 020 € de moins une fois cet écran ouvert. `projectDuePayments`
 * rend la même valeur sans rien écrire, et la matérialisation s'en sert pour
 * décider quoi inscrire — de sorte que les deux ne peuvent pas diverger.
 */

import {
  applyMonthlyDebit,
  duePaymentDates,
  projectDuePayments,
  remainingAmountAt,
} from "@/app/lib/liabilities/amortization";

const PRET = {
  remainingAmount: "178500",
  monthlyPayment: "980",
  paymentDay: 5,
  startDate: new Date("2021-09-13T16:05:00.000Z"),
  endDate: new Date("2051-08-17T05:35:00.000Z"),
  lastPaymentAppliedAt: null,
};

const NOW = new Date("2026-08-25T10:00:00.000Z");

describe("projectDuePayments", () => {
  it("amortit les échéances dues depuis le début du prêt", () => {
    const p = projectDuePayments({ ...PRET, now: NOW });

    // 59 mensualités échues depuis septembre 2021, 980 € chacune.
    expect(p.payments).toHaveLength(59);
    expect(p.remaining).toBe("120680.00000000");
    expect(p.lastAppliedAt?.toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("ne modifie pas ses arguments", () => {
    const input = { ...PRET, now: NOW };
    const before = JSON.stringify(input);
    projectDuePayments(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("est stable : deux projections successives donnent la même valeur", () => {
    const a = projectDuePayments({ ...PRET, now: NOW });
    const b = projectDuePayments({ ...PRET, now: NOW });
    expect(b.remaining).toBe(a.remaining);
    expect(b.payments).toHaveLength(a.payments.length);
  });

  it("repartir du solde projeté ne prélève rien de plus", () => {
    /*
      L'invariant qui rend la correction sûre : matérialiser puis reprojeter
      doit donner exactement le même solde que projeter seul. Sans lui, ouvrir
      le module Crédits déplacerait encore le patrimoine net.
    */
    const first = projectDuePayments({ ...PRET, now: NOW });
    const second = projectDuePayments({
      ...PRET,
      remainingAmount: first.remaining,
      lastPaymentAppliedAt: first.lastAppliedAt,
      now: NOW,
    });
    expect(second.payments).toHaveLength(0);
    expect(second.remaining).toBe(first.remaining);
  });

  it("plafonne au capital restant et n'écrit jamais de solde négatif", () => {
    const p = projectDuePayments({
      ...PRET,
      remainingAmount: "500",
      lastPaymentAppliedAt: new Date("2026-06-05T00:00:00.000Z"),
      now: NOW,
    });
    expect(p.remaining).toBe("0.00000000");
    expect(p.payments.at(-1)?.debited).toBe("500.00000000");
  });

  it("ne touche pas une dette déjà soldée", () => {
    const p = projectDuePayments({ ...PRET, remainingAmount: "0", now: NOW });
    expect(p.payments).toHaveLength(0);
    expect(p.lastAppliedAt).toBeNull();
  });

  it("ne touche pas une dette sans échéancier", () => {
    expect(
      projectDuePayments({ ...PRET, paymentDay: null, now: NOW }).payments
    ).toHaveLength(0);
    expect(
      projectDuePayments({ ...PRET, monthlyPayment: null, now: NOW }).payments
    ).toHaveLength(0);
    expect(
      projectDuePayments({ ...PRET, monthlyPayment: "0", now: NOW }).payments
    ).toHaveLength(0);
  });

  it("s'arrête à la date de fin du prêt", () => {
    const p = projectDuePayments({
      ...PRET,
      endDate: new Date("2022-01-31T00:00:00.000Z"),
      now: NOW,
    });
    // Le prêt démarre le 13 septembre : la première échéance retenue est celle
    // d'octobre, l'échéance du 5 septembre étant antérieure au départ.
    expect(p.payments).toHaveLength(4);
    expect(p.payments[0].eventDate.toISOString().slice(0, 10)).toBe("2021-10-05");
    expect(p.lastAppliedAt?.toISOString().slice(0, 10)).toBe("2022-01-05");
  });

  it("reproduit exactement la boucle d'amortissement d'origine", () => {
    /*
      La matérialisation n'a plus sa propre règle : elle écrit ce que la
      projection annonce. Ce test rejoue la boucle historique — `duePaymentDates`
      puis `applyMonthlyDebit` — et vérifie qu'elle donne le même résultat, pour
      que la refonte ne puisse pas avoir changé les montants au passage.
    */
    const dates = duePaymentDates({ ...PRET, now: NOW });
    let remaining = PRET.remainingAmount;
    const debits: string[] = [];
    for (const _ of dates) {
      const step = applyMonthlyDebit(remaining, PRET.monthlyPayment);
      if (Number(step.debited) <= 0) break;
      remaining = step.remaining;
      debits.push(step.debited);
    }

    const p = projectDuePayments({ ...PRET, now: NOW });
    expect(p.remaining).toBe(remaining);
    expect(p.payments.map((x) => x.debited)).toEqual(debits);
  });
});

describe("remainingAmountAt", () => {
  it("rend le solde projeté, quel que soit l'état de matérialisation", () => {
    const stocke = remainingAmountAt(PRET, NOW);

    // Le même prêt, mensualités déjà inscrites en base : même valeur.
    const materialise = remainingAmountAt(
      {
        ...PRET,
        remainingAmount: "120680",
        lastPaymentAppliedAt: new Date("2026-08-05T00:00:00.000Z"),
      },
      NOW
    );

    expect(stocke).toBe(materialise);
  });
});
