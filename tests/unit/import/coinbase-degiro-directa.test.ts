import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";

/**
 * Exports réels Coinbase, DEGIRO et Directa.
 *
 * Ce qui est vérifié ici, ce sont des montants : un test qui se contente de
 * constater que le parser ne jette pas laisserait passer un cours cent fois
 * trop grand ou un impôt compté comme un revenu. Les lignes sont donc ancrées
 * sur leur contenu — jamais sur un numéro de ligne physique, `parseCsv`
 * filtrant les lignes vides avant d'indexer.
 */

function lire(fixture: string, formatId: string): ImportDraftRow[] {
  const csv = parseCsv(
    readFileSync(`tests/fixtures/import/${fixture}-export.csv`, "utf8")
  );
  return mapCsvToDrafts(csv, formatId as never).rows;
}

/** Toutes les lignes dont une cellule d'origine contient ce fragment. */
function toutes(rows: ImportDraftRow[], fragment: string): ImportDraftRow[] {
  const hits = rows.filter((r) =>
    Object.values(r.raw).some((v) => v.includes(fragment))
  );
  expect(hits.length, `« ${fragment} » introuvable`).toBeGreaterThan(0);
  return hits;
}

/** Retrouve une ligne par un fragment de son libellé d'origine. */
function parLibelle(rows: ImportDraftRow[], fragment: string): ImportDraftRow {
  const hits = rows.filter((r) =>
    Object.values(r.raw).some((v) => v.includes(fragment))
  );
  expect(hits.length, `« ${fragment} » : ${hits.length} ligne(s)`).toBe(1);
  return hits[0]!;
}

describe("Coinbase", () => {
  const rows = lire("coinbase", "coinbase");

  it("lit toutes les opérations du relevé", () => {
    /*
      Huit lignes, dix opérations : les deux conversions se dédoublent en une
      vente et un achat chacune (cf. « une conversion donne deux jambes »).
    */
    expect(rows).toHaveLength(10);
  });

  it("un achat porte sa quantité et son cours réels", () => {
    const achat = rows.find(
      (r) => r.raw["Transaction Type"] === "Buy" && r.currency === "EUR"
    );
    expect(achat, "achat BTC absent").toBeDefined();
    expect(achat!.type).toBe("ACHAT");
    expect(achat!.ticker).toBe("BTC");
    expect(Number(achat!.quantity)).toBeCloseTo(0.00166779, 10);
    expect(Number(achat!.unitPrice)).toBeCloseTo(39999.331136545, 4);
    expect(Number(achat!.cashAmount)).toBeCloseTo(67.01, 6);
    expect(Number(achat!.fees)).toBeCloseTo(2.99, 6);
  });

  it("une conversion donne deux jambes, pas un achat de l'actif cédé", () => {
    /*
      « Converted 0.00363125 BTC to 156.145683 XRP » n'était lue que du côté
      colonné : le portefeuille **gagnait** 0,0036 BTC — l'actif qu'il vient de
      céder — et ne recevait jamais les XRP. Les deux jambes portent la même
      contre-valeur, l'opération reste donc neutre en trésorerie.
    */
    const jambes = rows.filter((r) => r.raw["Transaction Type"] === "Convert");
    expect(jambes).toHaveLength(4);

    const vente = jambes.find((r) => r.ticker === "BTC")!;
    const achat = jambes.find((r) => r.ticker === "XRP")!;
    expect(vente.type).toBe("VENTE");
    expect(Number(vente.quantity)).toBeCloseTo(0.00363125, 10);
    expect(achat.type).toBe("ACHAT");
    expect(Number(achat.quantity)).toBeCloseTo(156.145683, 8);
    expect(Number(vente.cashAmount)).toBeCloseTo(338.92698, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(338.92698, 6);

    // Le cours de la jambe reçue est celui du XRP, pas celui du bitcoin cédé.
    expect(Number(achat.unitPrice)).toBeCloseTo(2.17058181, 6);
  });

  it("un transfert de portefeuille n'est ni une vente ni un cadeau", () => {
    /*
      `Send` était typé VENTE et `Receive` REWARD : le même ETH2, sorti puis
      rentré, produisait une cession de 597 € d'un côté et une réception à prix
      de revient nul de l'autre.
    */
    for (const t of ["Send", "Receive"]) {
      const r = rows.find((x) => x.raw["Transaction Type"] === t)!;
      expect(r.type, t).toBe("TRANSFERT_TITRE");
    }
  });

  it("la devise du cours est celle de la colonne, pas une valeur par défaut", () => {
    // Le relevé mêle deux devises de cotation : les confondre fausserait la
    // conversion de tout ce qui n'est pas en euro.
    const devises = new Set(rows.map((r) => r.currency));
    expect(devises).toContain("EUR");
    expect(devises).toContain("USD");
  });

  it("le staking reste un REWARD, pas un achat", () => {
    const rewards = rows.filter((r) => r.type === "REWARD");
    expect(rewards.length).toBeGreaterThan(0);
    for (const r of rewards) expect(r.ticker).toMatch(/^ETH/);
  });
});

describe("DEGIRO", () => {
  const rows = lire("degiro", "degiro");

  it("les colonnes homonymes ne s'écrasent plus", () => {
    // `Mutatie` (devise) est suivi d'une colonne sans nom (montant), et `Saldo`
    // fait de même. Sans déduplication, le montant prenait la valeur du solde.
    const csv = parseCsv(
      readFileSync("tests/fixtures/import/degiro-export.csv", "utf8")
    );
    expect(csv.headers).toContain("Mutatie");
    expect(csv.headers).toContain("Mutatie 2");
    expect(csv.headers).toContain("Saldo");
    expect(csv.headers).toContain("Saldo 2");
  });

  it("quantité et cours sont extraits du libellé néerlandais", () => {
    const r = parLibelle(rows, "Koop 1 @ 33");
    expect(r.type).toBe("ACHAT");
    expect(r.quantity).toBe("1");
    expect(Number(r.unitPrice)).toBeCloseTo(33.9, 6);
    expect(Number(r.cashAmount)).toBeCloseTo(33.9, 6);
    expect(r.currency).toBe("USD");
  });

  it("le libellé « verbe qty NOM@cours » est lu aussi", () => {
    // Variante ibérique/française : le nom du titre s'intercale avant le `@`.
    const r = parLibelle(rows, "Achat 6 QT GROUP OYJ@79");
    expect(r.type).toBe("ACHAT");
    expect(r.quantity).toBe("6");
    expect(Number(r.unitPrice)).toBeCloseTo(79.96, 6);
    expect(Number(r.cashAmount)).toBeCloseTo(479.76, 6);
  });

  it("un cours en pence n'est pas publié comme des livres", () => {
    /*
      « Sell 4 AVIVA@496 GBX » : 496 pence, pour un montant de 19,84 GBP.
      Retenir 496 GBP se tromperait d'un facteur 100. Le cours cité est
      abandonné — non converti — et le prix unitaire redéduit du montant.
    */
    const r = parLibelle(rows, "AVIVA@496 GBX");
    expect(r.type).toBe("VENTE");
    expect(r.quantity).toBe("4");
    expect(r.currency).toBe("GBP");
    expect(Number(r.cashAmount)).toBeCloseTo(19.84, 6);
    expect(Number(r.unitPrice)).toBeCloseTo(4.96, 6);
    expect(r.warnings.join(" ")).toMatch(/GBX/);
  });

  it("le séparateur de milliers du libellé n'ampute pas la quantité", () => {
    const r = parLibelle(rows, "Conversion Fonds");
    expect(r.quantity).toBe("1046.3825");
    expect(Number(r.unitPrice)).toBeCloseTo(0.9854, 6);
  });

  it("le verbe de la clause fait foi sur le sens de l'opération", () => {
    // « Conversion … finalisée: Vente » : le mot le plus long du libellé
    // entier était « conversion », qui inversait le sens.
    expect(parLibelle(rows, "Conversion Fonds").type).toBe("VENTE");
    expect(parLibelle(rows, "PRODUCTWIJZIGING : Verkoop").type).toBe("VENTE");
    expect(parLibelle(rows, "PRODUCTWIJZIGING : Koop").type).toBe("ACHAT");
  });

  it("la retenue à la source est un frais, pas un revenu", () => {
    /*
      « Dividendbelasting » est toujours un débit. Typée DIVIDENDE parce que le
      mot contient « dividend », elle ajoutait au revenu le montant qu'elle en
      retranche.
    */
    const taxes = rows.filter((r) => r.raw["Omschrijving"] === "Dividendbelasting");
    expect(taxes.length).toBeGreaterThanOrEqual(4);
    for (const t of taxes) expect(t.type).toBe("FRAIS");
  });

  it("les frais sont reconnus dans les quatre langues du relevé", () => {
    for (const fragment of [
      "DEGIRO Transactiekosten",
      "Comissões de transação",
      "Frais DEGIRO de courtage",
      "DEGIRO Aansluitingskosten 2024 (Xetra - XET)",
      "Giro Exchange Connection Fee",
      "DEGIRO Corporate Action Kosten",
    ]) {
      for (const r of toutes(rows, fragment)) expect(r.type, fragment).toBe("FRAIS");
    }
  });

  it("les jambes internes du compte espèces ne sont pas des opérations", () => {
    for (const fragment of [
      "Valuta Debitering",
      "Valuta Creditering",
      "Degiro Cash Sweep Transfer",
      "Reservation iDEAL",
      "Ingreso Cambio de Divisa",
      "Retirada Cambio de Divisa",
      "Levantamento de divisa",
      "FX Credit",
      "FX Debit",
    ]) {
      for (const r of toutes(rows, fragment)) {
        expect(r.type, fragment).toBeNull();
        expect(r.warnings.join(" "), fragment).toMatch(/interne/);
      }
    }
  });

  it("les dépôts et retraits de cash gardent leur sens", () => {
    expect(parLibelle(rows, "iDEAL Deposit").type).toBe("APPORT");
    expect(parLibelle(rows, "Processed Flatex Withdrawal").type).toBe("RETRAIT");
    expect(parLibelle(rows, "flatex terugstorting").type).toBe("APPORT");
  });

  it("un dividende en titres crée des parts, pas un revenu nul", () => {
    // 999 titres reçus à coût nul : typée DIVIDENDE, la ligne aurait enregistré
    // un revenu de 0 € et perdu les parts.
    const r = parLibelle(rows, "STOCK DIVIDEND");
    expect(r.type).toBe("ACHAT");
    expect(r.quantity).toBe("999");
    expect(Number(r.unitPrice)).toBe(0);
  });
});

describe("Directa", () => {
  const rows = lire("directa", "directa");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(25);
  });

  it("un achat porte quantité, cours et montant réels", () => {
    const r = parLibelle(rows, "ETF COVERED BOND ISH");
    expect(r.type).toBe("ACHAT");
    expect(r.quantity).toBe("3");
    expect(Number(r.unitPrice)).toBeCloseTo(143.68, 6);
  });

  it("le cours moyen est déduit sans arrondi prématuré", () => {
    // 39 parts pour 196,33 € : le cours n'est pas rond, et l'arrondir ici
    // ferait diverger le coût de revient du montant réellement débité.
    const achat = rows.find(
      (x) => x.type === "ACHAT" && x.name === "ISHARES CHINA CNY BOND UCITS E"
    )!;
    expect(achat.quantity).toBe("39");
    expect(Number(achat.unitPrice)).toBeCloseTo(5.0341025641, 8);
  });

  it("coupons et dividendes ne sont pas confondus avec des frais", () => {
    const coupons = rows.filter((r) => r.type === "COUPON");
    const dividendes = rows.filter((r) => r.type === "DIVIDENDE");
    expect(coupons.length).toBeGreaterThanOrEqual(3);
    expect(dividendes.length).toBeGreaterThanOrEqual(2);
  });

  it("une opération de type inconnu reste non typée", () => {
    // Plutôt que d'être rangée d'office en APPORT : UNKNOWN n'est pas ZERO.
    const inconnues = rows.filter((r) => r.type === null);
    expect(inconnues.length).toBeGreaterThan(0);
  });

  it("une vente porte son sens et sa quantité", () => {
    const vente = rows.find((r) => r.type === "VENTE")!;
    expect(vente.name).toBe("ANTARES VISION");
    expect(vente.quantity).toBe("200");
    expect(Number(vente.unitPrice)).toBeCloseTo(3.33, 6);
  });
});
