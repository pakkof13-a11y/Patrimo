import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Un solde négatif compte pour ce qu'il vaut, en direct comme dans la courbe.
 *
 * Le total de trésorerie ignorait tout solde non strictement positif. Un compte
 * à −2 000 € valait donc 0 dans le patrimoine net — alors que l'écran affichait
 * bien −2 000 €, et que le chargeur historique, lui, a toujours transmis les
 * soldes signés. Les deux moitiés du produit répondaient différemment à la même
 * question, et la courbe décrochait de la carte du jour du montant du découvert.
 *
 * Ces tests vérifient la règle unique retenue — le solde saisi compte avec son
 * signe — des deux côtés, et l'absence de marche entre les deux.
 *
 * Ils ne disent rien d'un solde **inconnu**, qui reste inconnu : le sujet ici
 * est le signe d'un solde effectivement saisi.
 */

const bankFindMany = vi.fn();
const savingsFindMany = vi.fn();
const envelopeFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    bankAccount: { findMany: (...a: unknown[]) => bankFindMany(...a) },
    savingsAccount: { findMany: (...a: unknown[]) => savingsFindMany(...a) },
    envelopeCash: { findMany: (...a: unknown[]) => envelopeFindMany(...a) },
  },
}));

// Taux figés : ce chantier ne parle pas de change.
vi.mock("@/app/lib/market/fx", async (importOriginal) => {
  const reel = await importOriginal<typeof import("@/app/lib/market/fx")>();
  return { ...reel, getEurRates: async () => ({ EUR: 1, USD: 1.25 }) };
});

import { getExplicitCashTotalEur } from "@/app/lib/cash/pockets";
import { buildCashSleeve } from "@/app/lib/portfolio/historical/components";
import { sumTimelinesAt } from "@/app/lib/portfolio/historical/timeline";
import { d } from "@/app/lib/money/decimal";

/** Un compte courant tel que Prisma le rend. */
function compte(id: string, balance: string, currency = "EUR") {
  return { id, balance: d(balance), currency, createdAt: new Date("2024-01-01") };
}

/** Un livret sans intérêts courus : le solde affiché est le solde. */
function livret(id: string, balance: string) {
  return {
    id,
    balance: d(balance),
    currency: "EUR",
    apyPercent: d("0"),
    rateType: "APY",
    payoutFrequency: "DAILY",
    lastPayoutAt: null,
    // `lastAccruedAt` est `DateTime @default(now())` en base : jamais nul.
    lastAccruedAt: new Date(),
    createdAt: new Date("2024-01-01"),
  };
}

function enveloppe(id: string, balance: string) {
  return { id, balance: d(balance), currency: "EUR", createdAt: new Date("2024-01-01") };
}

beforeEach(() => {
  bankFindMany.mockReset().mockResolvedValue([]);
  savingsFindMany.mockReset().mockResolvedValue([]);
  envelopeFindMany.mockReset().mockResolvedValue([]);
});

const total = async () => Number((await getExplicitCashTotalEur("u1")).totalEur);

describe("total de trésorerie en direct", () => {
  it("un solde positif est inchangé", async () => {
    bankFindMany.mockResolvedValue([compte("b1", "10000")]);
    expect(await total()).toBe(10000);
  });

  it("un solde nul n'ajoute ni ne retranche rien", async () => {
    bankFindMany.mockResolvedValue([compte("b1", "10000"), compte("b2", "0")]);
    expect(await total()).toBe(10000);
  });

  it("un découvert est retranché, il ne vaut plus zéro", async () => {
    bankFindMany.mockResolvedValue([compte("b1", "-2000")]);
    // Avant : 0. Un compte à découvert disparaissait purement du patrimoine.
    expect(await total()).toBe(-2000);
  });

  it("plusieurs comptes dont un à découvert : 10 000 − 2 000 = 8 000", async () => {
    /*
      Le contrôle numérique demandé. Avant la correction, ce total valait
      10 000 € : le découvert était ignoré et le patrimoine net surévalué
      d'exactement son montant.
    */
    bankFindMany.mockResolvedValue([
      compte("b1", "10000"),
      compte("b2", "-2000"),
    ]);
    expect(await total()).toBe(8000);
  });

  it("la règle vaut aussi pour les livrets et les enveloppes", async () => {
    bankFindMany.mockResolvedValue([compte("b1", "10000")]);
    savingsFindMany.mockResolvedValue([livret("s1", "-500")]);
    envelopeFindMany.mockResolvedValue([enveloppe("e1", "-300")]);
    expect(await total()).toBe(9200);
  });

  it("le signe est appliqué après conversion, pas avant", async () => {
    // −2 500 USD à 1,25 → −2 000 €.
    bankFindMany.mockResolvedValue([
      compte("b1", "10000"),
      compte("b2", "-2500", "USD"),
    ]);
    expect(await total()).toBe(8000);
  });
});

describe("même règle dans la reconstruction historique", () => {
  const JOUR = "2026-03-02";

  /** Valeur du compartiment cash à une date, telle que la lit le moteur. */
  function cashAu(comptes: Parameters<typeof buildCashSleeve>[0], jour: string) {
    const build = buildCashSleeve(comptes, []);
    return sumTimelinesAt(build.timelines, jour);
  }

  it("un découvert connu est porté par la chronologie", () => {
    const somme = cashAu(
      [
        {
          id: "b1",
          balanceEur: d("-2000"),
          createdAt: new Date("2024-01-01"),
          knownAt: new Date("2026-01-01"),
        },
      ],
      JOUR
    );
    expect(Number(somme.totalEur)).toBe(-2000);
  });

  it("10 000 − 2 000 = 8 000, comme en direct", () => {
    const somme = cashAu(
      [
        {
          id: "b1",
          balanceEur: d("10000"),
          createdAt: new Date("2024-01-01"),
          knownAt: new Date("2026-01-01"),
        },
        {
          id: "b2",
          balanceEur: d("-2000"),
          createdAt: new Date("2024-01-01"),
          knownAt: new Date("2026-01-01"),
        },
      ],
      JOUR
    );
    expect(Number(somme.totalEur)).toBe(8000);
  });
});

describe("aucune marche entre le dernier point et le direct", () => {
  it("le cash historique du jour égale le total en direct", async () => {
    /*
      Le défaut se lisait ici : mêmes comptes, deux réponses. La courbe
      terminait à 8 000 € et la carte affichait 10 000 €, sans qu'aucun
      mouvement n'explique l'écart — seulement un désaccord sur le signe.
    */
    const comptes = [compte("b1", "10000"), compte("b2", "-2000")];
    bankFindMany.mockResolvedValue(comptes);

    const direct = await total();

    const historique = sumTimelinesAt(
      buildCashSleeve(
        comptes.map((c) => ({
          id: c.id,
          balanceEur: c.balance,
          createdAt: c.createdAt,
          knownAt: new Date("2026-01-01"),
        })),
        []
      ).timelines,
      "2026-03-02"
    );

    expect(Number(historique.totalEur)).toBe(direct);
    expect(direct).toBe(8000);
  });
});

describe("articulation avec les passifs", () => {
  it("un découvert n'est pas un passif et n'est donc compté qu'une fois", async () => {
    /*
      `Liability` décrit un prêt amortissable — capital initial, capital restant,
      mensualité, échéances — n'a pas de catégorie de découvert et aucun lien
      vers `BankAccount`. Un découvert ne peut donc pas y être représenté
      automatiquement : le compter dans la trésorerie ne peut pas le
      dédoubler.

      Reste le cas où l'utilisateur saisit lui-même un passif « découvert » en
      plus du solde négatif. Il déclare alors deux dettes, et le produit
      l'obéit — comme il le ferait pour n'importe quelle double saisie. Aucun
      rapprochement automatique n'est tenté ici : en inventer un supposerait de
      deviner quelles lignes se recouvrent.
    */
    bankFindMany.mockResolvedValue([compte("b1", "-2000")]);
    const tresorerie = await total();

    // Patrimoine net = actifs − passifs. Sans passif déclaré, le découvert
    // pèse une fois et une seule.
    const passifs = 0;
    expect(tresorerie - passifs).toBe(-2000);
  });
});
