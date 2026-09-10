import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PortfolioValuationEngine } from "@/app/lib/portfolio/historical/engine";
import type { HistoricalInputs } from "@/app/lib/portfolio/historical/engine";
import { convertToEurSync } from "@/app/lib/market/fx";
import { d } from "@/app/lib/money/decimal";

/**
 * La reprise de devise des événements déjà en base.
 *
 * `ADD COLUMN currency TEXT NOT NULL DEFAULT 'EUR'` a donné 'EUR' à toutes les
 * lignes antérieures, quelle que soit la devise de leur compte. Ce n'est pas une
 * question d'étiquette : `load.ts` convertit chaque mouvement avec `e.currency`,
 * donc l'historique d'un compte en dollars était valorisé comme des euros.
 *
 * Ce fichier mesure l'écart des deux côtés de la reprise — sur la conversion,
 * puis sur la courbe — et vérifie que la migration existe et se garde du cas
 * qu'elle ne sait pas trancher.
 */

const TAUX = { EUR: 1, USD: 1.25 };

/** Ce que `load.ts` fait de chaque événement : `eur(montant, e.currency)`. */
const enEuros = (montant: string, devise: string) =>
  Number(convertToEurSync(montant, devise, TAUX));

/*
  Trois mouvements d'un compte en dollars, écrits avant l'ajout de la colonne.
  Leurs nominaux sont en USD ; c'est leur `currency` qui était fausse.
*/
const MOUVEMENTS = [
  { jour: "2026-03-10T09:00:00Z", montant: "3000", soldeApres: "3000", type: "OPENING" },
  { jour: "2026-05-15T09:00:00Z", montant: "1000", soldeApres: "4000", type: "DEPOSIT" },
  { jour: "2026-07-20T09:00:00Z", montant: "1000", soldeApres: "5000", type: "DEPOSIT" },
];

describe("un compte en dollars, avant et après la reprise", () => {
  it("la conversion : les mêmes nominaux, deux valeurs en euros", () => {
    const avant = MOUVEMENTS.map((m) => enEuros(m.soldeApres, "EUR"));
    const apres = MOUVEMENTS.map((m) => enEuros(m.soldeApres, "USD"));

    // Avant : des dollars lus comme des euros — la valeur est gonflée de 25 %.
    expect(avant).toEqual([3000, 4000, 5000]);
    // Après : 5 000 USD valent bien 4 000 € au taux de 1,25.
    expect(apres).toEqual([2400, 3200, 4000]);

    // L'écart n'est pas un arrondi : un quart de la valeur du compte.
    expect(avant[2]! - apres[2]!).toBe(1000);
  });

  it("les flux aussi : un apport de 1 000 USD n'est pas un apport de 1 000 €", () => {
    expect(enEuros(MOUVEMENTS[1]!.montant, "EUR")).toBe(1000);
    expect(enEuros(MOUVEMENTS[1]!.montant, "USD")).toBe(800);
  });

  /* La même différence, portée jusqu'à la courbe. */
  const inputs = (devise: string): HistoricalInputs => ({
    transactions: [],
    assetClassById: new Map(),
    rawAssetClassById: new Map(),
    envelopeEventsByAsset: new Map(),
    excludedAssetIds: new Set(),
    closes: new Map(),
    cashAccounts: [
      {
        id: "b1",
        balanceEur: d(enEuros("5000", "USD")),
        createdAt: new Date("2020-01-01T00:00:00Z"),
        knownAt: new Date("2026-07-20T09:00:00Z"),
      },
    ],
    cashEvents: MOUVEMENTS.map((m) => ({
      accountId: "b1",
      occurredAt: new Date(m.jour),
      amountEur: d(enEuros(m.montant, devise)),
      balanceAfterEur: d(enEuros(m.soldeApres, devise)),
      type: m.type,
    })),
    metals: [],
    privateEquity: [],
    crowdlending: [],
    tangibles: [],
    employeeSavings: [],
    liabilities: [],
  });

  const cashAu = (devise: string, jour: string) =>
    new PortfolioValuationEngine(inputs(devise))
      .buildSeries("2026-03-09", "2026-08-01")
      .find((p) => p.day === jour)!.cash;

  it("le défaut : la courbe porte 5 000 € pour un compte qui vaut 4 000 €", () => {
    expect(cashAu("EUR", "2026-07-20")).toBeCloseTo(5000, 6);
    expect(cashAu("EUR", "2026-03-10")).toBeCloseTo(3000, 6);
  });

  it("après la reprise : la courbe dit ce que le compte vaut", () => {
    expect(cashAu("USD", "2026-07-20")).toBeCloseTo(4000, 6);
    expect(cashAu("USD", "2026-03-10")).toBeCloseTo(2400, 6);
  });

  /*
    Et le solde du jour, lui, était déjà juste : `listBankAccounts` convertit
    depuis `account.currency`. C'est bien la seule chronologie qui divergeait
    de son propre point d'arrivée.
  */
  it("le dernier point rejoint le solde courant du compte", () => {
    expect(cashAu("USD", "2026-08-01")).toBeCloseTo(enEuros("5000", "USD"), 6);
  });
});

/*
  Contrôle de source : la migration est un fait de dépôt, pas un comportement
  observable depuis les tests unitaires — aucune base n'est jointe ici.
*/
describe("la migration de reprise", () => {
  const sql = () =>
    readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260910090000_backfill_event_currency/migration.sql"
      ),
      "utf8"
    );

  it("reprend les deux tables d'événements depuis leur compte", () => {
    const code = sql();
    expect(code).toContain('UPDATE "BankAccountEvent"');
    expect(code).toContain('UPDATE "SavingsAccountEvent"');
    expect(code).toContain("SET currency = a.currency");
  });

  /*
    Le garde qui compte. Sur un compte passé de l'euro au dollar, les
    événements *antérieurs* au changement sont en euros et `a.currency` vaut
    désormais USD : les reprendre depuis le compte les casserait exactement
    comme le défaut qu'on répare. Ces comptes-là ne sont pas touchés.
  */
  it("épargne tout compte portant déjà une REDENOMINATION", () => {
    // Les lignes de commentaire en parlent aussi : seul le SQL compte ici.
    const instructions = sql()
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(instructions).toContain("NOT EXISTS");
    expect(instructions.match(/REDENOMINATION/g)).toHaveLength(2);
    // Le garde porte sur le compte entier, pas sur la date de l'événement.
    expect(instructions).not.toMatch(/occurredAt/);
  });
});
