/**
 * Les seize patrons de l'historique long (2001-2026) du seed.
 *
 * Deux natures de contrôle cohabitent ici, et c'est délibéré.
 *
 * Les **fonctions pures** — table de cours, échelle de vie, amortissement —
 * sont vérifiées sur leur valeur : elles sont exportées, elles se testent
 * directement, et c'est le seul endroit où la vérité est calculable sans base.
 *
 * Le reste est **structurel** : il lit la source du seed. Exécuter les patrons
 * exigerait une base Postgres, et ce que ces contrôles protègent n'est pas un
 * état déjà en place mais une frontière — qu'aucun patron n'achète CAC.PA,
 * qu'aucune ligne PEA ou CTO neuve n'oublie son événement d'enveloppe, qu'aucun
 * repli sur un prix inventé ne se glisse dans la dérivation des quantités. Un
 * seed qui cesserait de les respecter passerait un test fondé sur des données
 * semées avant la régression.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HISTORICAL_PRICES,
  historicalPriceOf,
  scaledAmount,
} from "../../prisma/seed-portfolio";

const racine = join(__dirname, "..", "..");
/*
  La source est lue avec des fins de ligne normalisées.

  Les contrôles ci-dessous découpent le fichier par des marqueurs textuels —
  une accolade fermante précédée et suivie d'un saut de ligne, par exemple.
  Sur une copie de travail Windows, ces marqueurs ne trouvent jamais leur
  borne : la tranche déborde alors sur le code voisin, et le test échoue sur
  une ligne qu'il ne visait pas. Il passait sous Linux et tombait sous
  Windows, pour une raison sans rapport avec ce qu'il vérifie.
*/
const seed = readFileSync(
  join(racine, "prisma/seed-portfolio.ts"),
  "utf8"
).replace(/\r\n/g, "\n");
/** Le bloc historique seul — les patrons, pas la fenêtre récente. */
const bloc = seed.slice(
  seed.indexOf("Historique long 2001-2026"),
  seed.indexOf("txs.sort(")
);

describe("supports non cotés ajoutés pour P07 et P12", () => {
  it("le fonds euro vaut une part par euro, sur toute la plage", () => {
    for (let annee = 2001; annee <= 2026; annee++) {
      expect(historicalPriceOf("FE-LINXEA", annee)?.toString()).toBe("1");
    }
  });

  it("les SCPI ne cotent pas avant leur commercialisation", () => {
    // Primovie ouvre l'historique SCPI en 2012 ; Épargne Pierre en 2013.
    expect(historicalPriceOf("PRIMOVIE", 2011)).toBeUndefined();
    expect(historicalPriceOf("PRIMOVIE", 2012)).toBeDefined();
    expect(historicalPriceOf("EPARGNE-PIERRE", 2012)).toBeUndefined();
    expect(historicalPriceOf("EPARGNE-PIERRE", 2013)).toBeDefined();
  });

  it("un prix de part de SCPI ne s'effondre pas en 2008 ni en 2020", () => {
    /*
      Le parallèle avec une action serait faux : le prix de part suit la valeur
      d'expertise du parc, pas le carnet d'ordres. Aucune des deux séries ne
      commence d'ailleurs avant 2012 — la seule révision à la baisse est celle
      de 2023, et elle est réelle.
    */
    const primovie = HISTORICAL_PRICES["PRIMOVIE"]!;
    expect(primovie[2023]!).toBeLessThan(primovie[2022]!);
    expect(primovie[2021]!).toBeGreaterThan(primovie[2020]!);
  });
});

describe("échelle de vie — les bornes annoncées par la table des patrons", () => {
  it("mène chaque montant de base de 2001 à sa borne 2026", () => {
    /*
      Les bornes de la table des patrons sont arrondies au chiffre rond ; la
      règle d'arrondi de `scaledAmount` (multiple de 10 € au-dessus de 1 000 €,
      de 1 € en dessous) donne la valeur exacte. Ce sont ces valeurs-là que le
      seed écrit — 4 880 € et non « 4 900 », 244 € et non « 245 ».
    */
    expect(scaledAmount(700, 2026).toNumber()).toBe(3800);
    expect(scaledAmount(900, 2026).toNumber()).toBe(4880);
    expect(scaledAmount(800, 2026).toNumber()).toBe(4340);
    expect(scaledAmount(1200, 2026).toNumber()).toBe(6510);
    expect(scaledAmount(1000, 2026).toNumber()).toBe(5430);
    expect(scaledAmount(45, 2026).toNumber()).toBe(244);
    expect(scaledAmount(40, 2026).toNumber()).toBe(217);
  });

  it("part exactement du montant de base en 2001", () => {
    expect(scaledAmount(700, 2001).toNumber()).toBe(700);
    expect(scaledAmount(2500, 2001).toNumber()).toBe(2500);
  });
});

describe("la vente K2 reste intouchable", () => {
  it("aucun patron historique n'achète CAC.PA", () => {
    /*
      Le CUMP est un coût moyen pondéré **depuis l'origine** : un seul achat
      historique de plus le déplacerait, et la plus-value figée de la vente K2
      (+117,08 €) avec lui. Mesuré : P02 branché sur CAC.PA porte la position à
      1 151 titres, le CUMP de 68,0208 à 54,0719, et la plus-value à +396,06 €.
      P02 achète donc un ETF indiciel distinct.
    */
    expect(bloc).not.toMatch(/ticker:\s*"CAC\.PA"/);
    expect(bloc).not.toMatch(/"CAC\.PA"[^\n]*histBuy/);
    const rotations = bloc.match(/const P0\d_ROTATION = \[[^\]]*\]/g) ?? [];
    expect(rotations.length).toBeGreaterThan(0);
    for (const r of rotations) expect(r).not.toContain("CAC.PA");
  });

  it("les trois écritures K2 gardent leur régime relatif", () => {
    expect(seed).toMatch(/occurredAt:\s*daysAgo\(70\)/);
    expect(seed).toMatch(/occurredAt:\s*daysAgo\(53\)/);
    expect(seed).toMatch(/occurredAt:\s*daysAgo\(27\)/);
  });
});

describe("UNKNOWN ≠ ZERO dans la dérivation des quantités", () => {
  it("un achat historique sans cours ne s'écrit pas", () => {
    // `histBuy` sort avant toute écriture quand la table ne connaît pas
    // l'année : pas de repli sur un coût inventé, pas d'interpolation.
    const histBuy = bloc.slice(bloc.indexOf("function histBuy"));
    const corps = histBuy.slice(0, histBuy.indexOf("\n  }\n"));
    expect(corps).toMatch(/if \(price === undefined \|\| price\.lessThanOrEqualTo\(0\)\) return false/);
    expect(corps).not.toMatch(/\?\?\s*(0|1)\b/);
  });

  it("la quantité se dérive du montant, jamais l'inverse", () => {
    const histBuy = bloc.slice(bloc.indexOf("function histBuy"));
    expect(histBuy.slice(0, 900)).toMatch(
      /const qty = args\.amountEur\.div\(fx\)\.div\(price\)\.toDecimalPlaces\(6\)/
    );
  });

  it("une vente ne s'écrit que sur un stock strictement positif", () => {
    const histSell = bloc.slice(bloc.indexOf("function histSell"));
    const corps = histSell.slice(0, 1200);
    expect(corps).toMatch(/if \(held\.lessThanOrEqualTo\(0\)\) return null/);
    expect(corps).toMatch(/qty\.greaterThan\(held\)\) return null/);
  });

  it("un retrait ne s'écrit que si le solde reste positif", () => {
    expect(bloc).toMatch(
      /histCash\.get\(boursorama\.id\) \?\? D\(0\)\)\.greaterThanOrEqualTo\(retrait\)/
    );
  });
});

describe("l'enveloppe de la ligne neuve est journalisée à son premier achat", () => {
  it("la ligne P02 reçoit son événement OBSERVED daté de l'ouverture", () => {
    /*
      Sans cet événement, `resolveEnvelopeAt` rendrait `UNKNOWN` sur toute la
      profondeur de la ligne : la courbe Titres retomberait au point unique que
      le commit précédent a fait disparaître. La règle vaut pour **toute**
      ligne PEA ou CTO créée par le seed, pas seulement pour celles d'origine.
    */
    const p02 = bloc.slice(bloc.indexOf("const p02Asset"), bloc.indexOf("const p02Seed"));
    expect(p02).toMatch(/\$transaction/);
    expect(p02).toMatch(/assetEnvelopeEvent\.create/);
    expect(p02).toMatch(/occurredAt:\s*p02Open/);
    expect(p02).toMatch(/kind:\s*"OBSERVED"/);
    expect(p02).toMatch(/accountType:\s*"PEA"/);
    // Même date que l'acquisition de la ligne, comme partout ailleurs.
    expect(p02).toMatch(/acquisitionDate:\s*p02Open/);
  });
});

describe("le prêt de 2006 s'ajoute et amortit dans le bon ordre", () => {
  it("n'écrase pas le prêt récent ni son moteur de débit", () => {
    expect(seed).toMatch(/name: "Crédit immo Lyon"/);
    expect(seed).toMatch(/name: "Crédit immo Lyon 2006"/);
    // Le moteur de débit n'est ni appelé ni redéfini : le seed n'écrit que des
    // données. Le nom n'apparaît que dans le commentaire hérité qui le cite.
    expect(seed).not.toMatch(/applyMonthlyDebit\s*\(/);
    expect(seed).not.toMatch(/function applyMonthlyDebit/);
  });

  it("impute les intérêts avant le capital", () => {
    /*
      Règle de `4225706`, citée et non réécrite : la mensualité couvre d'abord
      les intérêts du mois, et seul le solde réduit le capital. Ici la date
      d'origine est connue, l'amortissement va donc en avant plutôt qu'à
      rebours — l'ordre des imputations, lui, ne change pas.
    */
    expect(bloc).toMatch(/const interest = p10Crd\.mul\(P10_MONTHLY_RATE\)/);
    expect(bloc).toMatch(/const principal = P10_PAYMENT\.minus\(interest\)/);
    expect(bloc).toMatch(/p10Crd = p10Crd\.minus\(principal\)/);
  });

  it("240 mensualités de 833 € à 3,80 % laissent un solde résiduel, pas un gain", () => {
    /*
      Le contrôle du chiffre plutôt que du commentaire : imputer la mensualité
      entière au capital rembourserait 199 920 € pour 140 000 € empruntés.
      L'amortissement réel laisse 247,88 € au terme — c'est la mesure que le
      seed inscrit.
    */
    let crd = 140000;
    const taux = 0.038 / 12;
    for (let m = 0; m < 240; m++) crd = crd - (833 - crd * taux);
    expect(crd).toBeGreaterThan(0);
    expect(crd).toBeCloseTo(247.88, 1);
  });
});

describe("déterminisme et absence de flottant dans le chemin métier", () => {
  it("aucun patron ne tire de Math.random ni ne lit l'horloge", () => {
    expect(bloc).not.toMatch(/Math\.random/);
    expect(bloc).not.toMatch(/Date\.now\(\)/);
    expect(bloc).not.toMatch(/new Date\(\)/);
  });

  it("les montants historiques n'empruntent pas le moneyN hérité", () => {
    // `moneyN` arrondit un `number` : la consigne interdit de l'étendre.
    // `pushHistTx` refait le même calcul en `Decimal`.
    const push = bloc.slice(bloc.indexOf("function pushHistTx"));
    expect(push.slice(0, 3000)).not.toMatch(/moneyN|Math\.round/);
  });

  it("chaque écriture historique porte sa devise et son taux de change", () => {
    const push = bloc.slice(bloc.indexOf("function pushHistTx"));
    expect(push.slice(0, 4000)).toMatch(/fxRateToEur: fx/);
    expect(push.slice(0, 4000)).toMatch(/const fx = fxDec\(currency\)/);
  });
});

describe("clôtures annuelles de l'historique — report, pas lissage", () => {
  it("n'écrit que des années présentes dans la table de cours", () => {
    const closes = seed.slice(seed.indexOf("const histCloseRows"));
    expect(closes.slice(0, 1200)).toMatch(/Object\.entries\(serie\)/);
    // Aucune moyenne, aucune droite entre deux décembres connus.
    expect(closes.slice(0, 1200)).not.toMatch(/interp|lerp|\/ 2\b/);
  });

  it("s'arrête avant la fenêtre récente pour ne pas la contredire", () => {
    const closes = seed.slice(seed.indexOf("const histCloseRows"));
    expect(closes.slice(0, 1200)).toMatch(/if \(year > 2019\) continue/);
  });
});
