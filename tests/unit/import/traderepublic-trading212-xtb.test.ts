import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";
import { platformHintForFormat } from "@/app/lib/import/format-platform";
import { supportsMultipleEnvelopes } from "@/app/lib/platforms/presets";

/**
 * Exports réels Trade Republic, Trading 212 et XTB.
 *
 * Les assertions portent sur des valeurs financières : un test qui compterait
 * les lignes laisserait passer un cours en pence publié en euros, trois achats
 * comptés deux fois, ou une date fausse donnée sans réserve.
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

describe("détection et rattachement", () => {
  it("chaque export est reconnu", () => {
    expect(detectFormatFromHeaders(entetes("traderepublic-export"))).toBe(
      "trade_republic"
    );
    expect(detectFormatFromHeaders(entetes("trading212-export"))).toBe(
      "trading212"
    );
    expect(detectFormatFromHeaders(entetes("xtb-export"))).toBe("xtb");
  });

  it("les nouveaux formats ne capturent pas les exports voisins", () => {
    for (const fixture of [
      "saxo-export",
      "swissquote-export",
      "etoro-export",
      "ibkr-trades-export",
      "degiro-export",
      "revolut-invest-export",
      "cryptocom-export",
    ]) {
      const detecte = detectFormatFromHeaders(entetes(fixture));
      for (const interdit of ["trading212", "xtb", "trade_republic"]) {
        expect(detecte, `${fixture} ≠ ${interdit}`).not.toBe(interdit);
      }
    }
  });

  it("chaque format vise sa plateforme du catalogue", () => {
    expect(platformHintForFormat("trade_republic")?.logoKey).toBe(
      "TRADE_REPUBLIC"
    );
    expect(platformHintForFormat("trading212")?.logoKey).toBe("TRADING_212");
    expect(platformHintForFormat("xtb")?.logoKey).toBe("XTB");
  });

  it("l'enveloppe fiscale est demandée pour ces trois courtiers", () => {
    // Aucun des trois exports ne porte l'enveloppe : c'est le sélecteur déjà
    // en place qui pose la question à la validation de l'import.
    for (const key of ["TRADE_REPUBLIC", "TRADING_212", "XTB"]) {
      expect(supportsMultipleEnvelopes(key), key).toBe(true);
    }
  });
});

describe("Trade Republic", () => {
  const rows = lire("traderepublic-export", "trade_republic");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(9);
  });

  it("les libellés néerlandais sont reconnus", () => {
    /*
      Le preset ne portait que des alias anglais : aucune des colonnes du relevé
      réel (`Datum`, `Transactietype`, `Waarde (netto)`…) n'était reconnue, et
      les neuf lignes remontaient sans date, sans type et sans montant.
    */
    expect(rows.find((r) => r.raw["Transactietype"] === "Aankoop")!.type).toBe(
      "ACHAT"
    );
    expect(rows.find((r) => r.raw["Transactietype"] === "Verkoop")!.type).toBe(
      "VENTE"
    );
    expect(rows.find((r) => r.raw["Transactietype"] === "Storting")!.type).toBe(
      "APPORT"
    );
    expect(
      rows.find((r) => r.raw["Transactietype"] === "Onttrekking")!.type
    ).toBe("RETRAIT");
    expect(rows.find((r) => r.raw["Transactietype"] === "Dividend")!.type).toBe(
      "DIVIDENDE"
    );
  });

  it("anglais et néerlandais cohabitent dans le même fichier", () => {
    // La langue du relevé suit celle de l'application, pas le compte.
    expect(rows.find((r) => r.raw["Transactietype"] === "Buy")!.type).toBe(
      "ACHAT"
    );
    expect(rows.find((r) => r.raw["Transactietype"] === "Sell")!.type).toBe(
      "VENTE"
    );
  });

  it("les deux conventions décimales du fichier sont lues correctement", () => {
    // « 0,052361 » et « 0.2989 » figurent dans le même export.
    const fr = rows.find((r) => r.raw["Aantal"] === "0,052361")!;
    expect(Number(fr.quantity)).toBeCloseTo(0.052361, 8);
    const en = rows.find((r) => r.raw["Aantal"] === "0.2989")!;
    expect(Number(en.quantity)).toBeCloseTo(0.2989, 8);
  });

  it("les deux formats de date du fichier sont lus", () => {
    const jour = rows.find((r) => r.raw["Datum"] === "2024-09-25")!;
    expect(jour.occurredAt?.slice(0, 10)).toBe("2024-09-25");
    const horodate = rows.find(
      (r) => r.raw["Datum"] === "2024-12-10T10:25:01"
    )!;
    expect(horodate.occurredAt).toBe("2024-12-10T10:25");
  });

  it("un achat porte ISIN, quantité, montant et frais", () => {
    const krka = rows.find((r) => r.ticker === "SI0031102120")!;
    expect(krka.type).toBe("ACHAT");
    expect(krka.name).toBe("Krka");
    expect(Number(krka.quantity)).toBe(5);
    expect(Number(krka.cashAmount)).toBeCloseTo(690.25, 6);
    expect(Number(krka.unitPrice)).toBeCloseTo(138.05, 6);
    // `Kosten` vaut −1,0 : un frais reste un coût, jamais un crédit.
    expect(Number(krka.fees)).toBeCloseTo(1, 6);
  });

  it("le montant net porte le sens, sans le confondre avec le signe", () => {
    const retrait = rows.find(
      (r) => r.raw["Transactietype"] === "Onttrekking"
    )!;
    expect(Number(retrait.cashAmount)).toBeCloseTo(10.84, 6);
  });
});

describe("Trading 212", () => {
  const rows = lire("trading212-export", "trading212");

  it("lit toutes les lignes du relevé", () => {
    expect(rows).toHaveLength(13);
  });

  it("un cours en devise étrangère n'est pas publié en euros", () => {
    /*
      « 49.96 USD » pour un débit de « 1.33 EUR » : publier 49,96 comme un
      montant en euros se tromperait de 9 %. Le cours est abandonné, non
      converti, et |Total| / quantité le redonne exactement en euros.
    */
    const cisco = rows.find((r) => r.ticker === "US17275R1023")!;
    expect(cisco.type).toBe("ACHAT");
    expect(cisco.currency).toBe("EUR");
    expect(Number(cisco.quantity)).toBeCloseTo(0.029053, 8);
    expect(Number(cisco.cashAmount)).toBeCloseTo(1.33, 6);
    expect(Number(cisco.unitPrice)).toBeCloseTo(45.7784, 3);
    expect(cisco.warnings.join(" ")).toMatch(/USD/);
  });

  it("un cours en pence n'est pas publié comme des euros", () => {
    /*
      « 630.11 GBX » pour 17,67 € : retenir 630,11 € se tromperait d'un facteur
      74 000. Le cours est écarté plutôt que converti.
    */
    const inrg = rows.find((r) => r.ticker === "IE00B1XNHC34")!;
    expect(inrg.type).toBe("DIVIDENDE");
    expect(inrg.unitPrice).toBeNull();
    expect(Number(inrg.cashAmount)).toBeCloseTo(17.67, 6);
    expect(inrg.currency).toBe("EUR");
    expect(inrg.warnings.join(" ")).toMatch(/GBX/);
  });

  it("les lignes décalées d'une colonne sont réalignées", () => {
    /*
      Sur les opérations sur titres, l'export insère l'identifiant de l'ordre
      là où le fichier attend `No. of shares` : la quantité se lisait comme un
      cours et le montant disparaissait. La preuve du réalignement tient dans
      une multiplication — 595 × 3,41943 = 2 034,56.
    */
    const transfert = rows.find((r) => r.ticker === "DE000A3GK2N1")!;
    expect(Number(transfert.quantity)).toBeCloseTo(595, 6);
    expect(Number(transfert.unitPrice)).toBeCloseTo(3.41943, 6);
    expect(Number(transfert.cashAmount)).toBeCloseTo(2034.56, 6);
    expect(transfert.type).toBe("TRANSFERT_TITRE");
  });

  it("aucune ligne ne garde un identifiant en guise de cours", () => {
    for (const r of rows) {
      expect(Number(r.unitPrice ?? 0)).toBeLessThan(1e6);
    }
  });

  it("les deux jambes d'un regroupement ne sont pas importées", () => {
    /*
      « Stock split close » et « Stock split open » décrivent le même
      regroupement : 29,80 titres remplacés par 7,45, pour la même valeur de
      59,68 €. Les importer comme une vente et un achat créerait une
      plus-value de toutes pièces et compterait deux fois la même somme.
    */
    const splits = rows.filter((r) =>
      String(r.raw["Action"]).startsWith("Stock split")
    );
    expect(splits).toHaveLength(2);
    for (const r of splits) expect(r.type).toBeNull();
    // La valeur réalignée reste néanmoins lisible des deux côtés.
    for (const r of splits) expect(Number(r.cashAmount)).toBeCloseTo(59.68, 6);
  });

  it("dépôts et intérêts gardent leur sens", () => {
    expect(rows.find((r) => r.raw["Action"] === "Deposit")!.type).toBe(
      "APPORT"
    );
    const interet = rows.find((r) => r.raw["Action"] === "Interest on cash")!;
    expect(interet.type).toBe("INTERET");
    expect(Number(interet.cashAmount)).toBeCloseTo(0.01, 6);
  });

  it("la plus-value calculée par le courtier n'est pas un mouvement", () => {
    // `Result` est une information de suivi ; l'importer ajouterait au
    // portefeuille une somme qui n'a jamais été versée.
    const vente = rows.find((r) => r.ticker === "US04634X2027")!;
    expect(vente.type).toBe("VENTE");
    expect(Number(vente.cashAmount)).toBeCloseTo(0.7, 6);
  });
});

describe("XTB", () => {
  const rows = lire("xtb-export", "xtb");

  it("les lignes répétées à l'identique ne sont comptées qu'une fois", () => {
    /*
      Trois achats du 14 mai figurent deux fois, mêmes identifiant, horodatage
      et montant. Les importer tous ajouterait 99 € de titres jamais achetés.
    */
    const brut = parseCsv(
      readFileSync("tests/fixtures/import/xtb-export.csv", "utf8")
    );
    expect(brut.rows).toHaveLength(46);
    expect(rows).toHaveLength(43);
  });

  it("un même ordre acheté puis vendu reste deux opérations", () => {
    // L'ordre 419846716 apparaît deux fois, en compra puis en vende : la
    // déduplication ne doit pas les confondre.
    const ordre = rows.filter((r) => r.raw["ID"] === "419846716");
    expect(ordre).toHaveLength(2);
    expect(new Set(ordre.map((r) => r.type))).toEqual(
      new Set(["ACHAT", "VENTE"])
    );
  });

  it("quantité et cours sont extraits du libellé", () => {
    /*
      « OPEN BUY 34/42.5658 @ 11.7480 » : 34 titres exécutés sur un ordre de
      42,5658. Prendre le second nombre donnerait la taille de l'ordre entier.
    */
    const achat = rows.find((r) => r.raw["ID"] === "530692719")!;
    expect(achat.type).toBe("ACHAT");
    expect(achat.ticker).toBe("SPYL.DE");
    expect(Number(achat.quantity)).toBe(34);
    expect(Number(achat.unitPrice)).toBeCloseTo(11.748, 6);
    expect(Number(achat.cashAmount)).toBeCloseTo(399.43, 6);
  });

  it("les libellés portugais sont reconnus comme les anglais", () => {
    const compra = rows.find((r) => r.raw["Type"] === "Ações/ETF compra")!;
    expect(compra.type).toBe("ACHAT");
    expect(Number(compra.quantity)).toBe(1);
    expect(Number(compra.unitPrice)).toBeCloseTo(122.34, 6);
  });

  it("le signe du montant prime sur le libellé", () => {
    /*
      Le relevé contient un « Dividend » de −0,05 (ajustement sur CFD, donc un
      débit) et une correction d'intérêts de −0,50. Typés sur le seul mot, ils
      entraient en revenu alors que ce sont des charges.
    */
    const ajustement = rows.find((r) => r.ticker === "US30.CASH")!;
    expect(ajustement.type).toBe("FRAIS");

    const correction = rows.find(
      (r) => r.raw["Comment"] === "Corr Free-funds Interest 2024-08"
    )!;
    expect(correction.type).toBe("FRAIS");
  });

  it("une retenue à la source restituée n'est pas comptée comme une charge", () => {
    // +0,37 sur TXT.PL : le modèle ne représente pas un frais négatif ; la
    // ligne reste non typée plutôt que d'inverser le sens.
    const restitution = rows.find(
      (r) => r.raw["ID"] === "690197321"
    )!;
    expect(restitution.type).toBeNull();
    expect(restitution.warnings.join(" ")).toMatch(/Restitution/);
  });

  it("une retenue à la source débitrice reste un frais", () => {
    const retenue = rows.find((r) => r.raw["ID"] === "623424924")!;
    expect(retenue.type).toBe("FRAIS");
    expect(Number(retenue.cashAmount)).toBeCloseTo(0.33, 6);
  });

  it("les opérations non représentables ne sont pas rangées de force", () => {
    /*
      Un « Spin off » typé APPORT gonflerait les versements et minorerait
      d'autant la performance mesurée ; un résultat de CFD n'est pas un
      mouvement sur actif.
    */
    for (const id of ["244234503", "279466787", "210658050"]) {
      const r = rows.find((x) => x.raw["ID"] === id)!;
      expect(r.type, id).toBeNull();
      expect(r.warnings.join(" "), id).toMatch(/non représentable/);
    }
  });

  it("une date impossible reste inconnue plutôt que devinée", () => {
    /*
      « 010.09.2024 » n'a pas de quantième valide. Le repli sur le
      constructeur `Date` y lisait le 9 octobre : une date plausible, fausse,
      donnée sans réserve.
    */
    const corrompue = rows.find(
      (r) => r.raw["Time"] === "010.09.2024 20:49:02"
    )!;
    expect(corrompue.occurredAt).toBeNull();
  });

  it("dépôts, retraits et intérêts créditeurs gardent leur sens", () => {
    expect(rows.find((r) => r.raw["ID"] === "530691593")!.type).toBe("APPORT");
    expect(rows.find((r) => r.raw["ID"] === "618605424")!.type).toBe("RETRAIT");
    const interet = rows.find((r) => r.raw["ID"] === "543604525")!;
    expect(interet.type).toBe("INTERET");
    expect(Number(interet.cashAmount)).toBeCloseTo(15.17, 6);
    expect(rows.find((r) => r.raw["ID"] === "543857396")!.type).toBe("FRAIS");
  });

  it("la devise absente de l'export est signalée, pas devinée", () => {
    // XTB tient des comptes en EUR, USD, PLN, GBP ou HUF ; le relevé ne dit
    // jamais lequel. Une ligne PLN figure d'ailleurs dans le fichier.
    for (const r of rows) {
      expect(r.warnings.join(" ")).toMatch(/Devise du compte absente/);
    }
  });
});
