import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";
import { platformHintForFormat } from "@/app/lib/import/format-platform";
import { supportsMultipleEnvelopes } from "@/app/lib/platforms/presets";

/**
 * Exports réels Revolut, Saxo et Swissquote.
 *
 * Les assertions portent sur des valeurs financières : un test qui compterait
 * les lignes laisserait passer un achat de 50 SEK importé pour 50 €, un
 * transfert de portefeuille devenu vente imposable, ou un dividende ayant créé
 * une position d'une part.
 */

function lire(fixture: string, formatId: string): ImportDraftRow[] {
  return mapCsvToDrafts(
    parseCsv(readFileSync(`tests/fixtures/import/${fixture}.csv`, "utf8")),
    formatId as never
  ).rows;
}

function entetes(fixture: string): string[] {
  return parseCsv(readFileSync(`tests/fixtures/import/${fixture}.csv`, "utf8"))
    .headers;
}

function toutes(rows: ImportDraftRow[], fragment: string): ImportDraftRow[] {
  const hits = rows.filter((r) =>
    Object.values(r.raw).some((v) => v.includes(fragment))
  );
  expect(hits.length, `« ${fragment} » introuvable`).toBeGreaterThan(0);
  return hits;
}

describe("détection et rattachement", () => {
  it("chaque export est reconnu", () => {
    expect(detectFormatFromHeaders(entetes("saxo-export"))).toBe("saxo");
    expect(detectFormatFromHeaders(entetes("swissquote-export"))).toBe(
      "swissquote"
    );
    expect(detectFormatFromHeaders(entetes("revolut-crypto-export"))).toBe(
      "revolut"
    );
    expect(detectFormatFromHeaders(entetes("revolut-invest-export"))).toBe(
      "revolut"
    );
  });

  it("les nouveaux formats ne capturent pas les exports voisins", () => {
    for (const fixture of [
      "ibkr-trades-export",
      "ibkr-dividends-export",
      "etoro-export",
      "degiro-export",
      "coinbase-export",
      "cryptocom-export",
    ]) {
      const detecte = detectFormatFromHeaders(entetes(fixture));
      expect(detecte, fixture).not.toBe("saxo");
      expect(detecte, fixture).not.toBe("swissquote");
    }
  });

  it("chaque format vise sa plateforme du catalogue, sans doublon", () => {
    expect(platformHintForFormat("saxo")?.logoKey).toBe("SAXO_BANK");
    expect(platformHintForFormat("swissquote")?.logoKey).toBe("SWISSQUOTE");
    expect(platformHintForFormat("revolut")?.logoKey).toBe("REVOLUT");
  });

  it("l'enveloppe fiscale est demandée pour ces trois courtiers", () => {
    // Aucun des trois exports ne dit s'il s'agit d'un PEA ou d'un CTO : c'est
    // le mécanisme déjà en place qui pose la question à la validation.
    for (const key of ["SAXO_BANK", "SWISSQUOTE", "REVOLUT"]) {
      expect(supportsMultipleEnvelopes(key), key).toBe(true);
    }
  });
});

describe("Revolut — export crypto", () => {
  const rows = lire("revolut-crypto-export", "revolut");

  it("lit toutes les lignes", () => {
    expect(rows).toHaveLength(13);
  });

  it("un achat en couronnes reste en couronnes", () => {
    /*
      « 50.00 SEK » : le code SEK n'était pas reconnu, la devise retombait sur
      l'euro par défaut et un achat de 50 SEK entrait au portefeuille pour
      50 € — onze fois sa valeur.
    */
    const achat = rows.find((r) => r.raw["Date"]?.startsWith("May 5, 2020"))!;
    expect(achat.type).toBe("ACHAT");
    expect(achat.currency).toBe("SEK");
    expect(Number(achat.cashAmount)).toBeCloseTo(50, 6);
    expect(Number(achat.unitPrice)).toBeCloseTo(89162.28, 4);
    expect(Number(achat.quantity)).toBeCloseTo(0.00056077, 10);
  });

  it("les trois devises du fichier coexistent", () => {
    const devises = new Set(rows.map((r) => r.currency));
    expect(devises).toContain("SEK");
    expect(devises).toContain("EUR");
    expect(devises).toContain("USD");
  });

  it("un transfert de portefeuille n'est ni une vente ni une réception gratuite", () => {
    /*
      `Send` était typé VENTE et `Receive` REWARD : le même bitcoin produisait
      une plus-value imposable d'un côté et un coût de revient nul de l'autre,
      pour un mouvement qui ne change rien au patrimoine.
    */
    for (const type of ["Send", "Receive", "Stake"]) {
      const r = rows.find((x) => x.raw["Type"] === type)!;
      expect(r.type, type).toBe("TRANSFERT_TITRE");
    }
  });

  it("la récompense de staking reste un REWARD", () => {
    const rewards = rows.filter((r) => r.raw["Type"] === "Staking reward");
    expect(rewards).toHaveLength(3);
    for (const r of rewards) {
      expect(r.type).toBe("REWARD");
      expect(r.ticker).toBe("ETH");
    }
    // Ces lignes n'ont ni prix ni valeur dans le CSV : rien n'est inventé.
    expect(rewards[0]!.cashAmount).toBeNull();
  });

  it("l'heure sur 12 h n'est pas perdue", () => {
    // « May 5, 2020, 10:10:57 PM » retombait sur midi, décalant l'opération
    // d'une demi-journée.
    const soir = rows.find((r) => r.raw["Date"]?.startsWith("May 5, 2020"))!;
    expect(soir.occurredAt).toBe("2020-05-05T22:10");
  });

  it("les frais sont lus dans leur propre colonne", () => {
    const mars = rows.find((r) => r.raw["Date"]?.startsWith("Mar 8, 2022"))!;
    expect(Number(mars.fees)).toBeCloseTo(0.24, 6);
    expect(mars.currency).toBe("EUR");
  });
});

describe("Revolut — export Invest", () => {
  const rows = lire("revolut-invest-export", "revolut");

  it("lit toutes les lignes", () => {
    expect(rows).toHaveLength(12);
  });

  it("achat et vente portent quantité, cours et montant réels", () => {
    const achat = rows.find((r) => r.ticker === "O")!;
    expect(achat.type).toBe("ACHAT");
    expect(Number(achat.quantity)).toBeCloseTo(1.63453043, 8);
    expect(Number(achat.unitPrice)).toBeCloseTo(52.07, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(85.11, 6);
    expect(achat.currency).toBe("USD");

    const vente = rows.find((r) => r.ticker === "MA")!;
    expect(vente.type).toBe("VENTE");
    expect(Number(vente.unitPrice)).toBeCloseTo(402.13, 6);
  });

  it("la virgule décimale d'une ligne récente n'ampute pas la quantité", () => {
    // « 0,76672417 » côtoie des quantités à point décimal dans le même fichier.
    const msft = rows.find(
      (r) => r.ticker === "MSFT" && r.type === "ACHAT"
    )!;
    expect(Number(msft.quantity)).toBeCloseTo(0.76672417, 8);
    expect(msft.currency).toBe("EUR");
  });

  it("les mouvements de cash gardent leur sens", () => {
    expect(rows.find((r) => r.raw["Type"] === "CASH TOP-UP")!.type).toBe(
      "APPORT"
    );
    expect(rows.find((r) => r.raw["Type"] === "CASH WITHDRAWAL")!.type).toBe(
      "RETRAIT"
    );
    expect(rows.find((r) => r.raw["Type"] === "CUSTODY FEE")!.type).toBe(
      "FRAIS"
    );
    expect(rows.find((r) => r.raw["Type"] === "DIVIDEND")!.type).toBe(
      "DIVIDENDE"
    );
  });

  it("les transferts inter-entités ne sont pas des opérations de marché", () => {
    for (const r of toutes(rows, "TRANSFER FROM REVOLUT")) {
      expect(r.type).toMatch(/^TRANSFERT_/);
    }
  });

  it("un split n'est pas transformé en achat à prix nul", () => {
    /*
      Le modèle ne représente pas les divisions d'action. Typée ACHAT à 0 $,
      la ligne aurait ramené à zéro le prix de revient de la position.
      Non typée, elle n'est pas importée — limitation assumée.
    */
    const split = rows.find((r) => r.raw["Type"] === "STOCK SPLIT")!;
    expect(split.type).toBeNull();
  });
});

describe("Saxo", () => {
  const rows = lire("saxo-export", "saxo");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(30);
  });

  it("l'opération est lue dans Event, pas dans Type", () => {
    // `Type` ne donne que la famille : quatre lignes sur cinq y porteraient le
    // même mot. « Buy 3 @ 134.85 USD » est dans `Event`.
    const nvidia = rows.find((r) => r.ticker === "US67066G1040")!;
    expect(nvidia.type).toBe("ACHAT");
    expect(nvidia.name).toBe("NVIDIA Corp.");
    expect(Number(nvidia.quantity)).toBe(3);
    expect(Number(nvidia.unitPrice)).toBeCloseTo(134.85, 6);
    expect(Number(nvidia.cashAmount)).toBeCloseTo(405.55, 6);
    expect(nvidia.currency).toBe("USD");
  });

  it("la commission incluse dans le montant est retrouvée exactement", () => {
    /*
      3 × 134,85 = 404,55 pour un débit de 405,55 : le dollar d'écart est la
      commission. Sans elle, le prix de revient serait sous-évalué et la
      plus-value surévaluée d'autant à la revente.
    */
    const nvidia = rows.find((r) => r.ticker === "US67066G1040")!;
    expect(Number(nvidia.fees)).toBeCloseTo(1, 6);

    const meta = rows.find((r) => r.ticker === "US30303M1027")!;
    expect(Number(meta.fees)).toBeCloseTo(1, 6);
  });

  it("aucune commission n'est fabriquée quand l'écart ne va pas dans son sens", () => {
    /*
      « Koop 1.5 @ 110.01 EUR » pour −110 : le notionnel dépasse le débit.
      L'écart n'est pas une commission ; en déduire une donnerait un frais
      négatif de 55 €.
    */
    const nl = toutes(rows, "Koop 1.5 @ 110.01 EUR")[0]!;
    expect(nl.type).toBe("ACHAT");
    expect(Number(nl.quantity)).toBeCloseTo(1.5, 6);
    expect(Number(nl.unitPrice)).toBeCloseTo(110.01, 6);
    expect(Number(nl.fees)).toBe(0);
  });

  it("une vente sans commission n'en reçoit pas", () => {
    const vente = rows.find((r) => r.type === "VENTE")!;
    expect(Number(vente.quantity)).toBe(3);
    expect(Number(vente.cashAmount)).toBeCloseTo(419.22, 6);
    expect(Number(vente.fees)).toBe(0);
  });

  it("dividendes, dépôts, retraits et droits de garde sont distingués", () => {
    for (const r of toutes(rows, "Dividend")) expect(r.type).toBe("DIVIDENDE");
    for (const r of toutes(rows, "Custody Fee")) expect(r.type).toBe("FRAIS");
    for (const r of toutes(rows, "Deposit")) expect(r.type).toBe("APPORT");
    for (const r of toutes(rows, "Withdrawal")) expect(r.type).toBe("RETRAIT");
  });

  it("un taux de conversion ≠ 1 est signalé, pas appliqué", () => {
    /*
      Le relevé ne nomme jamais la devise du compte : appliquer le taux
      convertirait vers une devise inconnue. Le montant reste dans la devise de
      l'instrument, la seule que le fichier énonce, et le doute est dit.
    */
    const dividendes = toutes(rows, "0.92139706");
    for (const r of dividendes) {
      expect(r.currency).toBe("EUR");
      expect(r.warnings.join(" ")).toMatch(/Taux de conversion/);
    }
    // Les lignes à taux 1 ne portent pas cet avertissement.
    const nvidia = rows.find((r) => r.ticker === "US67066G1040")!;
    expect(nvidia.warnings.join(" ")).not.toMatch(/Taux de conversion/);
  });

  it("les dépôts répétés ne sont pas dédupliqués à tort", () => {
    // Le relevé contient plusieurs dépôts identiques le même jour : ce sont
    // des mouvements distincts, pas un double comptage.
    const depots = rows.filter((r) => r.type === "APPORT");
    expect(depots.length).toBe(11);
  });
});

describe("Swissquote", () => {
  const rows = lire("swissquote-export", "swissquote");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(21);
  });

  it("un achat porte quantité, cours, frais et devise réels", () => {
    const xdwu = rows.find((r) => r.ticker === "XDWU")!;
    expect(xdwu.type).toBe("ACHAT");
    expect(xdwu.name).toBe("MSCI World Utilities UCITS ETF");
    expect(Number(xdwu.quantity)).toBe(640);
    expect(Number(xdwu.unitPrice)).toBeCloseTo(31.255, 6);
    expect(Number(xdwu.fees)).toBeCloseTo(44.35, 6);
    expect(Number(xdwu.cashAmount)).toBeCloseTo(20047.55, 6);
    expect(xdwu.currency).toBe("CHF");
    expect(xdwu.occurredAt?.slice(0, 10)).toBe("2022-08-09");
  });

  it("chaque ligne garde sa propre devise", () => {
    const devises = new Set(rows.map((r) => r.currency));
    expect(devises).toEqual(new Set(["CHF", "EUR", "USD"]));
  });

  it("un dividende ne crée pas une position d'une part", () => {
    /*
      Le relevé remplit `Quantity 1.0` et `Unit price 1348.24` sur toutes les
      lignes. Pris au mot, chaque dividende ajoutait une part au cours de
      1 348 $ au portefeuille.
    */
    for (const r of rows.filter((x) => x.type === "DIVIDENDE")) {
      expect(r.quantity).toBeNull();
      expect(r.unitPrice).toBeNull();
    }
    const vwrd = rows.find(
      (r) => r.type === "DIVIDENDE" && r.ticker === "VWRD"
    )!;
    expect(Number(vwrd.cashAmount)).toBeCloseTo(1348.24, 6);
    expect(vwrd.currency).toBe("USD");
  });

  it("une opération de change n'est pas une transaction", () => {
    /*
      « Forex debit » 106 017,30 USD et « Forex credit » 100 000 CHF sont les
      deux jambes d'une même conversion : les importer compterait deux fois le
      même mouvement, une fois dans chaque sens.
    */
    const changes = rows.filter((r) =>
      /^Forex/.test(r.raw["Transaction"] ?? "")
    );
    expect(changes).toHaveLength(4);
    for (const r of changes) {
      expect(r.type).toBeNull();
      expect(r.warnings.join(" ")).toMatch(/change Swissquote/);
    }
  });

  it("un retrait d'espèces n'est pas un achat", () => {
    const debits = rows.filter((r) => r.raw["Transaction"] === "Debit");
    expect(debits).toHaveLength(2);
    for (const r of debits) {
      expect(r.type).toBe("RETRAIT");
      expect(r.quantity).toBeNull();
    }
    // 2 000 CHF retirés, 2 CHF de frais : le net débité est 2 002.
    expect(Number(debits[0]!.cashAmount)).toBeCloseTo(2002, 6);
    expect(Number(debits[0]!.fees)).toBeCloseTo(2, 6);
  });

  it("un intérêt débiteur est une charge, pas un revenu", () => {
    /*
      « Interests » vaut ici −0,01 CHF. Typé INTERET sans regarder le signe, il
      serait entré en revenu alors que c'est une charge.
    */
    const interet = rows.find((r) => r.raw["Transaction"] === "Interests")!;
    expect(interet.type).toBe("FRAIS");
    expect(Number(interet.cashAmount)).toBeCloseTo(0.01, 6);
  });

  it("les droits de garde sont des frais", () => {
    const garde = rows.find((r) => r.raw["Transaction"] === "Custody Fees")!;
    expect(garde.type).toBe("FRAIS");
    expect(Number(garde.cashAmount)).toBeCloseTo(53.85, 6);
    expect(Number(garde.fees)).toBeCloseTo(3.85, 6);
  });

  it("deux ventes du même titre à la même seconde restent deux lignes", () => {
    // Exécutions partielles d'un même ordre : les fusionner perdrait les deux
    // cours réels (86,08 et 86,09).
    const wdsc = rows.filter((r) => r.ticker === "WDSC");
    expect(wdsc).toHaveLength(2);
    expect(wdsc.map((r) => Number(r.quantity)).sort((a, b) => a - b)).toEqual([
      6, 367,
    ]);
  });
});
