import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";
import { platformHintForFormat } from "@/app/lib/import/format-platform";

/**
 * Seconde passe : Crypto.com (App et Exchange), Bybit, Bitpanda, Nexo,
 * Coinbase, Revolut, AscendEX.
 *
 * Le fil conducteur de ces fichiers est le mouvement de portefeuille : dépôt,
 * retrait, mise en jeu, transfert entre poches. Aucun n'est un achat ni une
 * vente, et les typer comme tels fabrique tantôt une plus-value imposable,
 * tantôt un actif reçu gratuitement. C'est ce que ces tests protègent.
 */

const DIR = "tests/fixtures/import/passe2";

function lire(fixture: string): ImportDraftRow[] {
  const csv = parseCsv(readFileSync(`${DIR}/${fixture}.csv`, "utf8"));
  return mapCsvToDrafts(csv, detectFormatFromHeaders(csv.headers) as never).rows;
}

function entetes(fixture: string): string[] {
  return parseCsv(readFileSync(`${DIR}/${fixture}.csv`, "utf8")).headers;
}

function parType(rows: ImportDraftRow[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    const k = String(r.type);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

describe("détection — chaque export vers son format", () => {
  const attendus: Array<[string, string]> = [
    ["cryptocom-app-crypto", "cryptocom"],
    ["cryptocom-app-fiat", "cryptocom"],
    ["cryptocom-app-carte", "cryptocom"],
    ["cryptocom-exchange-deposit", "cryptocom_transfer"],
    ["cryptocom-exchange-withdrawal", "cryptocom_transfer"],
    ["cryptocom-supercharger", "cryptocom_transfer"],
    ["coinbase-2022", "coinbase"],
    ["nexo-ancien", "nexo"],
    ["nexo-recent", "nexo"],
    ["nexo-loan", "nexo"],
    ["ascendex-staking", "ascendex"],
    ["ascendex-award", "ascendex"],
    ["bitpanda-trades", "bitpanda"],
    ["bybit-spot", "bybit"],
    ["bybit-tradehistory", "bybit"],
    ["bybit-closedpl", "bybit"],
    ["bybit-contract", "bybit"],
    ["revolut-statement", "revolut_crypto"],
    ["revolut-learn", "revolut_crypto"],
  ];

  for (const [fixture, format] of attendus) {
    it(`${fixture} → ${format}`, () => {
      expect(detectFormatFromHeaders(entetes(fixture))).toBe(format);
    });
  }

  it("les nouveaux formats ne capturent pas les exports voisins", () => {
    /*
      Bitpanda tombait auparavant sur Coinbase (le seul mot « Timestamp ») et
      le relevé crypto de Revolut sur le format bancaire, qui partage tous ses
      en-têtes sauf `Fiat amount` et `Base currency`.
    */
    for (const [fixture, interdit] of [
      ["coinbase-2022", "bitpanda"],
      ["cryptocom-app-crypto", "bitpanda"],
      ["nexo-recent", "bybit"],
      ["bybit-spot", "cryptocom_transfer"],
      ["bitpanda-trades", "coinbase"],
      ["revolut-statement", "revolut"],
    ] as const) {
      expect(detectFormatFromHeaders(entetes(fixture)), fixture).not.toBe(
        interdit
      );
    }
  });

  it("le relevé bancaire Revolut reste sur le format bancaire", () => {
    // Non-régression : les deux relevés Revolut de la première passe ne
    // doivent pas basculer sur le nouveau format crypto.
    for (const f of ["revolut-crypto-export", "revolut-invest-export"]) {
      const csv = parseCsv(
        readFileSync(`tests/fixtures/import/${f}.csv`, "utf8")
      );
      expect(detectFormatFromHeaders(csv.headers), f).toBe("revolut");
    }
  });

  it("chaque format vise une plateforme déjà au catalogue", () => {
    expect(platformHintForFormat("bitpanda")?.logoKey).toBe("BITPANDA");
    expect(platformHintForFormat("bybit")?.logoKey).toBe("BYBIT");
    // Deux formats, une seule plateforme : PLATEFORME ≠ FORMAT.
    expect(platformHintForFormat("revolut_crypto")?.logoKey).toBe("REVOLUT");
    expect(platformHintForFormat("revolut")?.logoKey).toBe("REVOLUT");
    expect(platformHintForFormat("cryptocom")?.logoKey).toBe("CRYPTO_COM");
    expect(platformHintForFormat("cryptocom_transfer")?.logoKey).toBe(
      "CRYPTO_COM"
    );
  });
});

describe("Crypto.com — App", () => {
  const crypto = lire("cryptocom-app-crypto");

  it("lit toutes les lignes du relevé", () => {
    expect(crypto).toHaveLength(20);
  });

  it("un retrait de jetons n'est pas une vente", () => {
    /*
      `crypto_withdrawal` était typé VENTE : les six retraits de ce relevé —
      vingt et un sur celui de 2022 — devenaient autant de cessions imposables
      qui n'ont pas eu lieu.
    */
    const retraits = crypto.filter(
      (r) => r.raw["Transaction Kind"] === "crypto_withdrawal"
    );
    expect(retraits).toHaveLength(6);
    for (const r of retraits) expect(r.type).toBe("TRANSFERT_TITRE");
  });

  it("un dépôt de jetons n'est pas une réception gratuite", () => {
    const depots = crypto.filter(
      (r) => r.raw["Transaction Kind"] === "crypto_deposit"
    );
    expect(depots).toHaveLength(5);
    for (const r of depots) expect(r.type).toBe("TRANSFERT_TITRE");
  });

  it("une conversion garde ses deux jambes et son cours propre", () => {
    // Acquis au chantier précédent, revérifié sur ce second relevé.
    const jambes = crypto.filter(
      (r) => r.raw["Transaction Kind"] === "crypto_exchange"
    );
    expect(jambes).toHaveLength(4);
    expect(new Set(jambes.map((r) => r.type))).toEqual(
      new Set(["ACHAT", "VENTE"])
    );
    const achat = jambes.find(
      (r) => r.type === "ACHAT" && r.ticker === "CRO"
    )!;
    expect(Number(achat.quantity)).toBeCloseTo(48.3, 6);
  });

  it("aucune ligne n'est comptée deux fois", () => {
    // Vingt lignes au fichier, deux conversions dédoublées, deux jambes
    // absorbées : le compte doit retomber juste.
    const brut = parseCsv(
      readFileSync(`${DIR}/cryptocom-app-crypto.csv`, "utf8")
    );
    const conversions = brut.rows.filter(
      (r) => r["Transaction Kind"] === "crypto_exchange"
    ).length;
    expect(crypto).toHaveLength(brut.rows.length + conversions);
  });

  it("un achat de crypto en euros porte le jeton reçu, pas l'euro dépensé", () => {
    /*
      « viban_purchase » colonne l'euro sorti dans `Currency`/`Amount` et le
      jeton reçu dans `To Currency`/`To Amount`. La ligne remontait sans actif,
      avec 399,92 pour quantité : la somme en euros prise pour un nombre de
      jetons.
    */
    const fiat = lire("cryptocom-app-fiat");
    const achats = fiat.filter(
      (r) => r.raw["Transaction Kind"] === "viban_purchase"
    );
    expect(achats).toHaveLength(4);
    const premier = achats.find((r) => r.raw["To Amount"] === "453.63")!;
    expect(premier.type).toBe("ACHAT");
    expect(premier.ticker).toBe("USDC");
    expect(Number(premier.quantity)).toBeCloseTo(453.63, 6);
    expect(Number(premier.cashAmount)).toBeCloseTo(453.63, 6);
  });

  it("un dépôt de monnaie reste un apport en espèces", () => {
    const fiat = lire("cryptocom-app-fiat");
    const depots = fiat.filter(
      (r) => r.raw["Transaction Kind"] === "viban_deposit"
    );
    expect(depots).toHaveLength(4);
    for (const r of depots) {
      expect(r.type).toBe("APPORT");
      expect(r.currency).toBe("EUR");
    }
    expect(Number(depots.find((r) => r.raw["Amount"] === "400.0")!.cashAmount))
      .toBeCloseTo(400, 6);
  });

  it("les paiements par carte ne deviennent pas des opérations de portefeuille", () => {
    /*
      Le relevé de carte n'a pas de `Transaction Kind` : ce sont des dépenses
      personnelles. Seul le rechargement du compte est un mouvement.
    */
    const carte = lire("cryptocom-app-carte");
    const depenses = carte.filter(
      (r) => !/deposit/i.test(r.raw["Transaction Description"] ?? "")
    );
    expect(depenses.length).toBeGreaterThan(0);
    for (const r of depenses) expect(r.type).toBeNull();
  });
});

describe("Crypto.com — Exchange (dépôts / retraits / Supercharger)", () => {
  it("un dépôt de jetons n'entre pas à prix de revient nul", () => {
    /*
      Les 21 dépôts étaient typés REWARD : 6 263 USDC arrivaient gratuitement
      au portefeuille, et leur revente aurait affiché 100 % de plus-value.
    */
    const depots = lire("cryptocom-exchange-deposit");
    expect(depots).toHaveLength(21);
    for (const r of depots) expect(r.type).toBe("TRANSFERT_TITRE");
    const gros = depots.find((r) => r.ticker === "USDC")!;
    expect(Number(gros.quantity)).toBeCloseTo(6263.063282, 6);
  });

  it("un retrait de jetons n'est pas une vente", () => {
    const retraits = lire("cryptocom-exchange-withdrawal");
    expect(retraits).toHaveLength(25);
    for (const r of retraits) expect(r.type).toBe("TRANSFERT_TITRE");
  });

  it("les récompenses Supercharger, elles, sont bien des récompenses", () => {
    /*
      Trois colonnes seulement — Time (UTC), Coin, Amount — et aucun montant
      nommé « deposit » : le fichier tombait sur le format générique et
      remontait sans date ni type.
    */
    const rewards = lire("cryptocom-supercharger");
    expect(rewards).toHaveLength(2);
    for (const r of rewards) {
      expect(r.type).toBe("REWARD");
      expect(r.ticker).toBe("EFI");
      expect(r.occurredAt).not.toBeNull();
      expect(Number(r.quantity)).toBeCloseTo(0.00304056, 10);
    }
  });
});

describe("Coinbase — relevé 2022", () => {
  const rows = lire("coinbase-2022");

  it("les conversions se dédoublent, le reste est lu tel quel", () => {
    // 88 lignes, 2 conversions dédoublées → 90 opérations.
    expect(rows).toHaveLength(90);
    expect(parType(rows)).toEqual({
      ACHAT: 17,
      VENTE: 4,
      REWARD: 62,
      TRANSFERT_TITRE: 7,
    });
  });

  it("une conversion porte les deux actifs, chacun à son cours", () => {
    /*
      « Converted 5,00333556 NU to 1,18512376 CGLD » : la ligne était lue comme
      un **achat de NU**, l'actif qu'elle fait sortir. Le cours colonné est
      celui du NU ; l'appliquer au CGLD reçu l'aurait valorisé six fois trop.
    */
    const jambes = rows.filter((r) =>
      (r.raw["Notes"] ?? "").includes("5,00333556 NU")
    );
    expect(jambes).toHaveLength(2);
    const vente = jambes.find((r) => r.ticker === "NU")!;
    const achat = jambes.find((r) => r.ticker === "CGLD")!;
    expect(vente.type).toBe("VENTE");
    expect(Number(vente.quantity)).toBeCloseTo(5.00333556, 8);
    expect(Number(vente.unitPrice)).toBeCloseTo(1.4, 6);
    expect(achat.type).toBe("ACHAT");
    expect(Number(achat.quantity)).toBeCloseTo(1.18512376, 8);
    expect(Number(achat.unitPrice)).toBeCloseTo(6.79 / 1.18512376, 6);
    // Même contre-valeur : la conversion ne crée pas de trésorerie.
    expect(Number(vente.cashAmount)).toBeCloseTo(6.79, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(6.79, 6);
  });

  it("les envois et réceptions sont des transferts", () => {
    /*
      Six envois typés VENTE, dont 0,033 BTC valorisés 1 900 $ : autant de
      cessions imposables fabriquées. Les colonnes `Subtotal` et `Total` sont
      vides sur ces lignes — le relevé dit lui-même qu'aucune somme n'a changé
      de main.
    */
    const mouvements = rows.filter((r) =>
      ["Send", "Receive"].includes(r.raw["Transaction Type"] ?? "")
    );
    expect(mouvements).toHaveLength(7);
    for (const r of mouvements) expect(r.type).toBe("TRANSFERT_TITRE");
  });

  it("les récompenses d'apprentissage restent des récompenses", () => {
    const rewards = rows.filter(
      (r) => r.raw["Transaction Type"] === "Learning Reward"
    );
    expect(rewards).toHaveLength(62);
    for (const r of rewards) expect(r.type).toBe("REWARD");
  });

  it("un achat porte son montant et sa devise réels", () => {
    const achat = rows.find(
      (r) => r.raw["Transaction Type"] === "Buy" && r.ticker === "BTC"
    )!;
    expect(achat.type).toBe("ACHAT");
    expect(achat.currency).toBe("USD");
    expect(Number(achat.unitPrice)).toBeGreaterThan(0);
  });
});

describe("Nexo", () => {
  it("les trois variantes d'en-tête sont lues", () => {
    // Huit, neuf ou dix colonnes selon l'année de l'export, et
    // « Date / Time » ou « Date / Time (UTC) ».
    for (const f of ["nexo-ancien", "nexo-recent", "nexo-loan"]) {
      const rows = lire(f);
      expect(rows.length, f).toBeGreaterThan(0);
      for (const r of rows) expect(r.occurredAt, f).not.toBeNull();
    }
  });

  it("la contre-valeur est en dollars, la seule devise du relevé", () => {
    /*
      Nexo ne chiffre qu'en `USD Equivalent`, écrit « $2050.87 ». Sans colonne
      de devise reconnue, le repli générique retenait l'euro : les montants
      étaient présentés dans une devise absente du fichier.
    */
    const rows = lire("nexo-recent");
    const vente = rows.find((r) => r.raw["Type"] === "Withdrawal")!;
    expect(vente.currency).toBe("USD");
    expect(vente.ticker).toBe("USDT");
    expect(Number(vente.quantity)).toBeCloseTo(2050.191895, 6);
  });

  it("une ligne en euros reste en euros", () => {
    /*
      Quand l'actif est lui-même une monnaie, `Amount` est une somme et non
      une quantité de jetons : le dépôt de 1 000 € remontait en erreur, faute
      de montant.
    */
    const rows = lire("nexo-ancien");
    const depots = rows.filter((r) => r.type === "APPORT");
    expect(depots.length).toBeGreaterThanOrEqual(2);
    for (const r of depots) {
      expect(r.currency).toBe("EUR");
      expect(Number(r.cashAmount)).toBeCloseTo(1000, 6);
      expect(r.errors).toHaveLength(0);
    }
  });

  it("les intérêts versés restent des récompenses en jetons", () => {
    const rows = lire("nexo-recent");
    const interets = rows.filter((r) => r.raw["Type"] === "Interest");
    expect(interets.length).toBeGreaterThan(300);
    for (const r of interets.slice(0, 20)) {
      expect(r.type).toBe("REWARD");
      expect(r.cashAmount).toBeNull();
    }
  });
});

describe("AscendEX", () => {
  it("un mouvement de mise n'est pas une récompense", () => {
    /*
      Le fichier « staking » liste les entrées et sorties de la mise, et sa
      colonne `Size` porte le solde immobilisé. Typée REWARD, la première ligne
      créditait 2 470 CAPS gratuits, la suivante 2 444 de plus : la mise
      entière comptée en revenu, autant de fois qu'elle a bougé.
    */
    const rows = lire("ascendex-staking");
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.type).toBe("TRANSFERT_TITRE");
      expect(r.warnings.join(" ")).toMatch(/Mouvement de mise/);
    }
    expect(Number(rows[0]!.quantity)).toBeCloseTo(2470.9606141, 6);
  });

  it("le fichier des récompenses, lui, en contient bien", () => {
    const rows = lire("ascendex-award");
    expect(rows).toHaveLength(208);
    for (const r of rows.slice(0, 20)) expect(r.type).toBe("REWARD");
    // « 0.8456408903 CAPS-S » : la quantité se lit malgré le jeton accolé.
    expect(Number(rows[0]!.quantity)).toBeCloseTo(0.8456408903, 10);
    expect(rows[0]!.ticker).toBe("CAPS");
  });
});

describe("Bitpanda", () => {
  const rows = lire("bitpanda-trades");

  it("lit toutes les lignes malgré le préambule", () => {
    // Cinq lignes de disclaimer précèdent les en-têtes.
    expect(rows).toHaveLength(208);
  });

  it("un achat porte quantité, cours, montant et devise réels", () => {
    const palladium = rows.find(
      (r) => r.ticker === "PALLADIUM" && r.type === "ACHAT"
    )!;
    expect(Number(palladium.quantity)).toBeCloseTo(0.38602307, 8);
    expect(Number(palladium.unitPrice)).toBeCloseTo(64.76, 6);
    expect(Number(palladium.cashAmount)).toBeCloseTo(25, 6);
    expect(palladium.currency).toBe("EUR");
  });

  it("l'argent métal n'est pas rangé avec les actions", () => {
    /*
      `Asset class` vaut « Metal » ou « Commodity » sur 158 des 208 lignes.
      Le classement par défaut en faisait des actions.
    */
    const metaux = rows.filter((r) =>
      /metal|commodit/i.test(r.raw["Asset class"] ?? "")
    );
    expect(metaux).toHaveLength(158);
    for (const r of metaux) expect(r.assetClass).toBe("AUTRE");
  });

  it("dépôts et retraits en euros gardent leur sens", () => {
    expect(rows.filter((r) => r.type === "APPORT")).toHaveLength(48);
    const retraits = rows.filter((r) => r.type === "RETRAIT");
    expect(retraits).toHaveLength(2);
    for (const r of retraits) expect(r.currency).toBe("EUR");
  });

  it("des frais prélevés en métal sont signalés, pas convertis", () => {
    /*
      Les 105 lignes « transfer » sont les frais de garde du plan d'épargne :
      montant nul et frais libellés en argent, pas en euros. Un frais payé en
      nature n'est pas représentable — le dire vaut mieux que l'inventer.
    */
    const frais = rows.filter((r) => r.raw["Transaction Type"] === "transfer");
    expect(frais).toHaveLength(105);
    for (const r of frais) expect(r.type).toBe("TRANSFERT_TITRE");

    const enArgent = frais.filter((r) => r.raw["Fee asset"] === "Silver");
    expect(enArgent).toHaveLength(104);
    for (const r of enArgent) {
      expect(r.warnings.join(" ")).toMatch(/Frais prélevés en Silver/);
    }

    // Bitpanda écrit « - » pour une cellule vide : rien à signaler alors.
    const sansFrais = frais.filter((r) => r.raw["Fee asset"] === "-");
    expect(sansFrais).toHaveLength(1);
    expect(sansFrais[0]!.warnings.join(" ")).not.toMatch(/Frais prélevés/);
  });
});

describe("Bybit", () => {
  it("le compte spot décrit des mouvements de jetons", () => {
    const rows = lire("bybit-spot");
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.type).toBe("TRANSFERT_TITRE");
      expect(r.ticker).toBe("USDT");
      expect(Number(r.quantity)).toBeCloseTo(4063.46, 6);
      expect(r.occurredAt).not.toBeNull();
    }
  });

  it("les exports de dérivés ne créent aucune position", () => {
    /*
      Levier, financement, liquidation, résultat de position : Patrimo ne
      modélise pas les perpétuels. Les importer inventerait des positions qui
      n'existent pas — mieux vaut le dire que produire du bruit.
    */
    for (const f of ["bybit-tradehistory", "bybit-closedpl", "bybit-contract"]) {
      const rows = lire(f);
      expect(rows.length, f).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.type, f).toBeNull();
        expect(r.warnings.join(" "), f).toMatch(/dérivés Bybit/);
      }
    }
  });
});

describe("Revolut — relevé crypto", () => {
  const rows = lire("revolut-statement");

  it("lit les mille lignes du relevé", () => {
    expect(rows).toHaveLength(1016);
  });

  it("le jeton est l'actif, l'euro la contre-valeur", () => {
    /*
      Sur ce relevé, `Amount` est une quantité de jetons et `Currency` leur
      symbole — l'inverse du relevé bancaire, qui partage ces en-têtes. Lu avec
      le format bancaire, le fichier donnait un actif nommé « CRYPTO STAKING »
      libellé en « DOT », et mille lignes en erreur.
    */
    const recompense = rows.find(
      (r) => r.type === "REWARD" && r.ticker === "DOT"
    )!;
    expect(recompense.currency).toBe("EUR");
    expect(Number(recompense.quantity)).toBeGreaterThan(0);
    expect(recompense.errors).toHaveLength(0);
  });

  it("aucune ligne ne reste en erreur", () => {
    expect(rows.filter((r) => r.status === "error")).toHaveLength(0);
  });

  it("les mises en jeu sont des transferts, les récompenses des revenus", () => {
    expect(parType(rows)).toEqual({ TRANSFERT_CASH: 4, REWARD: 1012 });
  });

  it("un jeton à quatre lettres n'est pas tronqué", () => {
    // Lu comme une devise, « ALGO » était ramené à trois caractères.
    const learn = lire("revolut-learn");
    expect(learn).toHaveLength(2);
    for (const r of learn) {
      expect(r.ticker).toBe("ALGO");
      expect(r.currency).toBe("EUR");
      expect(Number(r.quantity)).toBeGreaterThan(0.9);
    }
  });

  it("la contre-valeur retenue est celle hors frais", () => {
    /*
      `Fiat amount` et `Fiat amount (inc. fees)` cohabitent ; retenir la
      seconde compterait les frais deux fois, puisqu'ils ont leur colonne.
    */
    const avecFrais = rows.find(
      (r) => Number(r.fees) > 0 && r.cashAmount != null
    );
    if (avecFrais) {
      expect(Number(avecFrais.cashAmount)).toBeCloseTo(
        Number(avecFrais.raw["Fiat amount"]),
        8
      );
    }
  });
});
