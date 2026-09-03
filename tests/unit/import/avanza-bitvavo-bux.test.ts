import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts, type ImportDraftRow } from "@/app/lib/import/map-rows";
import { detectBestAdapter } from "@/app/lib/import/adapters/registry";
import { platformHintForFormat } from "@/app/lib/import/format-platform";
import type { ImportFormatId } from "@/app/lib/import/presets";

/**
 * Import réel des exports Avanza, Bitvavo et BUX.
 *
 * Les fichiers sont les exports d'exemple fournis, copiés tels quels : ce sont
 * eux la source de vérité, pas une idée de ce que ces plateformes exportent.
 * Les assertions portent sur des montants et des quantités lus dans les
 * fichiers, ligne par ligne — vérifier qu'un parseur « ne plante pas » ne dit
 * rien de la justesse de ce qu'il produit.
 */

function charger(fichier: string, format: ImportFormatId) {
  const texte = readFileSync(
    join(process.cwd(), "tests/fixtures/import", fichier),
    "utf8"
  );
  const csv = parseCsv(texte);
  return { csv, ...mapCsvToDrafts(csv, format) };
}

/** Ligne du fichier (1 = en-tête), pour ancrer chaque assertion sur le CSV. */
const ligne = (rows: ImportDraftRow[], n: number) =>
  rows.find((r) => r.line === n)!;

// ═══════════════════════════════════════════════════════════════════════════
// Avanza
// ═══════════════════════════════════════════════════════════════════════════

describe("Avanza — export Transaktioner", () => {
  const { csv, rows } = charger("avanza-export.csv", "avanza");

  it("le fichier est lu avec le bon séparateur", () => {
    expect(csv.delimiter).toBe(";");
    expect(csv.headers[0]).toBe("Datum");
    expect(csv.rows).toHaveLength(20);
  });

  it("le format est détecté sur ses en-têtes", () => {
    const { adapter } = detectBestAdapter(csv.headers);
    expect(adapter.meta.id).toBe("avanza");
  });

  it("rattaché à la plateforme Avanza du catalogue", () => {
    expect(platformHintForFormat("avanza")?.logoKey).toBe("AVANZA");
  });

  it("un achat en couronnes : quantité, prix et frais", () => {
    // L5 — 2019-04-04;8346000;Köp;Avanza 75;6,3572;191,120305;-1214,99;SEK;0
    const r = ligne(rows, 5);
    expect(r.type).toBe("ACHAT");
    expect(r.ticker).toBe("SE0004841500");
    expect(Number(r.quantity)).toBeCloseTo(6.3572, 6);
    expect(Number(r.unitPrice)).toBeCloseTo(191.120305, 6);
    expect(Number(r.cashAmount)).toBeCloseTo(1214.99, 2);
    expect(r.currency).toBe("SEK");
    expect(Number(r.fees)).toBe(0);
  });

  it("une vente : quantité négative ramenée en positif, résultat ignoré", () => {
    // L3 — Sälj;DNB Global Indeks S;-352,033838;154,665276;54447,41;SEK;0
    const r = ligne(rows, 3);
    expect(r.type).toBe("VENTE");
    expect(Number(r.quantity)).toBeCloseTo(352.033838, 6);
    expect(Number(r.cashAmount)).toBeCloseTo(54447.41, 2);
    expect(r.currency).toBe("SEK");
  });

  it("un achat en devise étrangère n'emprunte pas le cours à l'instrument", () => {
    /*
      L18 — S&P Global : Kurs 330,16 en USD, Belopp -7104,41 en SEK,
      Valutakurs 10,72655. Publier 330,16 comme prix unitaire d'une ligne en
      couronnes serait faux d'un facteur dix ; le prix est donc redéduit du
      montant, et tombe bien autour de 3 552 SEK l'action.
    */
    const r = ligne(rows, 18);
    expect(r.type).toBe("ACHAT");
    expect(r.ticker).toBe("US78409V1044");
    expect(Number(r.quantity)).toBe(2);
    expect(r.currency).toBe("SEK");
    expect(Number(r.cashAmount)).toBeCloseTo(7104.41, 2);
    expect(Number(r.unitPrice)).toBeCloseTo(3552.205, 2);
    expect(Number(r.unitPrice)).not.toBeCloseTo(330.16, 2);
    expect(Number(r.fees)).toBeCloseTo(21.45, 2);
  });

  it("un dividende porte son montant et son actif", () => {
    // L10 — Utdelning;Fidelity Global Quality Income;503;0,049351;285,38;SEK
    const r = ligne(rows, 10);
    expect(r.type).toBe("DIVIDENDE");
    expect(r.ticker).toBe("IE00BYV1YH00");
    expect(Number(r.cashAmount)).toBeCloseTo(285.38, 2);
    expect(r.currency).toBe("SEK");
  });

  it("intérêts, dépôts et retraits restent des mouvements de trésorerie", () => {
    expect(ligne(rows, 11).type).toBe("INTERET"); // Ränta 0,84
    expect(Number(ligne(rows, 11).cashAmount)).toBeCloseTo(0.84, 2);

    expect(ligne(rows, 6).type).toBe("APPORT"); // Insättning 1215
    expect(Number(ligne(rows, 6).cashAmount)).toBeCloseTo(1215, 2);

    expect(ligne(rows, 2).type).toBe("RETRAIT"); // Uttag -54400
    expect(Number(ligne(rows, 2).cashAmount)).toBeCloseTo(54400, 2);
  });

  it("« Övrigt » n'est pas traduit en type inventé", () => {
    /*
      Ce libellé recouvre aussi bien un remboursement de frais qu'un échange de
      parts de fonds (L19/L20, sans montant). Lui choisir un type unique serait
      une invention : la ligne reste sans type et n'est pas importée.
    */
    for (const n of [13, 14, 15, 16, 19, 20]) {
      expect(ligne(rows, n).type, `L${n}`).toBeNull();
    }
  });

  it("la retenue à la source étrangère est un frais, pas un revenu", () => {
    // L17 — Utländsk källskatt ; -16,49 SEK
    const r = ligne(rows, 17);
    expect(r.type).toBe("FRAIS");
    expect(Number(r.cashAmount)).toBeCloseTo(16.49, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bitvavo
// ═══════════════════════════════════════════════════════════════════════════

describe("Bitvavo — export Transaction history", () => {
  const { csv, rows } = charger("bitvavo-export.csv", "bitvavo");

  it("le fichier est lu et le format détecté", () => {
    expect(csv.delimiter).toBe(",");
    expect(csv.rows).toHaveLength(34);
    expect(detectBestAdapter(csv.headers).adapter.meta.id).toBe("bitvavo");
  });

  it("rattaché à la plateforme Bitvavo du catalogue", () => {
    expect(platformHintForFormat("bitvavo")?.logoKey).toBe("BITVAVO");
  });

  it("un achat : quantité crypto, prix de cotation, frais en euro", () => {
    // L3 — buy,ETH,0.0053543,EUR,1862.8,EUR,-10.00,EUR,0.02600996,Completed
    const r = ligne(rows, 3);
    expect(r.type).toBe("ACHAT");
    expect(r.ticker).toBe("ETH");
    expect(Number(r.quantity)).toBeCloseTo(0.0053543, 9);
    expect(Number(r.unitPrice)).toBeCloseTo(1862.8, 4);
    expect(r.currency).toBe("EUR");
    expect(Number(r.cashAmount)).toBeCloseTo(10, 2);
    expect(Number(r.fees)).toBeCloseTo(0.02600996, 8);
  });

  it("une vente : quantité négative ramenée en positif", () => {
    // L16 — sell,ETH,-0.00781401,EUR,1597.5,EUR,12.45,EUR,0.032880975
    const r = ligne(rows, 16);
    expect(r.type).toBe("VENTE");
    expect(r.ticker).toBe("ETH");
    expect(Number(r.quantity)).toBeCloseTo(0.00781401, 9);
    expect(Number(r.unitPrice)).toBeCloseTo(1597.5, 4);
    expect(Number(r.cashAmount)).toBeCloseTo(12.45, 2);
  });

  it("un dépôt d'euros est un mouvement de trésorerie", () => {
    // L4 — deposit,EUR,10,,,,,EUR,0,Completed
    const r = ligne(rows, 4);
    expect(r.type).toBe("APPORT");
    expect(Number(r.quantity)).toBeCloseTo(10, 2);
  });

  it("le staking est une récompense, pas un achat", () => {
    // L27 — staking,ETH,0.00001819,,,,,ETH,,Distributed
    const r = ligne(rows, 27);
    expect(r.type).toBe("REWARD");
    expect(r.ticker).toBe("ETH");
    expect(Number(r.quantity)).toBeCloseTo(0.00001819, 10);
  });

  it("les frais prélevés en crypto ne sont pas comptés en euros", () => {
    /*
      L11 — retrait de BTC dont les frais valent 0,0002 **BTC**. Les reprendre
      tels quels les ferait lire comme 0,0002 € : un chiffre faux là où la
      donnée est simplement dans une autre unité.
    */
    const r = ligne(rows, 11);
    expect(Number(r.fees)).toBe(0);
    expect(r.warnings.join(" ")).toMatch(/BTC/);
  });

  it("aucune ligne n'est importée sans statut abouti", () => {
    // Le fichier ne contient que Completed / Distributed : toutes les lignes
    // typées le sont, et aucun avertissement de statut n'est émis.
    const statuts = csv.rows.map((r) => r["Status"]);
    expect(new Set(statuts)).toEqual(new Set(["Completed", "Distributed"]));
    expect(
      rows.some((r) => r.warnings.some((w) => w.includes("non aboutie")))
    ).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BUX
// ═══════════════════════════════════════════════════════════════════════════

describe("BUX — export Transactions", () => {
  const { csv, rows } = charger("bux-export.csv", "bux");

  it("le fichier est lu et le format détecté", () => {
    expect(csv.delimiter).toBe(",");
    expect(csv.rows).toHaveLength(25);
    expect(detectBestAdapter(csv.headers).adapter.meta.id).toBe("bux");
  });

  it("rattaché à la plateforme BUX du catalogue", () => {
    expect(platformHintForFormat("bux")?.logoKey).toBe("BUX");
  });

  it("un achat en euro : ISIN, quantité, prix, montant", () => {
    // L4 — trades,Buy Trade,,-542.92,EUR,48.49,NL0011821202,ING,49,11.08,EUR
    const r = ligne(rows, 4);
    expect(r.type).toBe("ACHAT");
    expect(r.ticker).toBe("NL0011821202");
    expect(r.name).toBe("ING");
    expect(Number(r.quantity)).toBe(49);
    expect(Number(r.unitPrice)).toBeCloseTo(11.08, 4);
    expect(Number(r.cashAmount)).toBeCloseTo(542.92, 2);
    expect(r.currency).toBe("EUR");
  });

  it("un achat en devise étrangère n'emprunte pas le cours à l'actif", () => {
    /*
      L21 — Gilead Sciences : Asset Price 109,96 **USD**, Transaction Amount
      -10,00 EUR, Exchange Rate 1,14547. Le prix unitaire doit rester en euros,
      donc être redéduit du montant : 10 / 0,104172 ≈ 95,99 €.
    */
    const r = ligne(rows, 21);
    expect(r.type).toBe("ACHAT");
    expect(r.ticker).toBe("US3755581036");
    expect(r.currency).toBe("EUR");
    expect(Number(r.quantity)).toBeCloseTo(0.104172, 6);
    expect(Number(r.cashAmount)).toBeCloseTo(10, 2);
    expect(Number(r.unitPrice)).toBeCloseTo(95.995, 3);
    expect(Number(r.unitPrice)).not.toBeCloseTo(109.96, 2);
  });

  it("un achat dont la devise d'actif égale celle du compte garde son cours", () => {
    // L26 — iShares Global Water : Asset Currency EUR = Transaction Currency
    const r = ligne(rows, 26);
    expect(r.type).toBe("ACHAT");
    expect(Number(r.unitPrice)).toBeCloseTo(63.7199999, 6);
  });

  it("dividendes, intérêts et frais gardent leur nature", () => {
    expect(ligne(rows, 8).type).toBe("DIVIDENDE"); // Cash Dividend 16.4
    expect(Number(ligne(rows, 8).cashAmount)).toBeCloseTo(16.4, 2);
    expect(ligne(rows, 8).ticker).toBe("NL0011821202");

    expect(ligne(rows, 11).type).toBe("INTERET"); // Interest Payment 0.23
    expect(Number(ligne(rows, 11).cashAmount)).toBeCloseTo(0.23, 2);

    expect(ligne(rows, 5).type).toBe("FRAIS"); // Trading Fee -1.5
    expect(Number(ligne(rows, 5).cashAmount)).toBeCloseTo(1.5, 2);

    expect(ligne(rows, 7).type).toBe("FRAIS"); // Subscription Fee -2.99
  });

  it("dépôts et retraits ne sont pas confondus avec des trades", () => {
    expect(ligne(rows, 18).type).toBe("APPORT"); // Sepa Deposit 10
    expect(Number(ligne(rows, 18).cashAmount)).toBeCloseTo(10, 2);

    expect(ligne(rows, 19).type).toBe("RETRAIT"); // Sepa Withdrawal -1200
    expect(Number(ligne(rows, 19).cashAmount)).toBeCloseTo(1200, 2);
  });

  it("les actions sur titres ne sont pas devinées", () => {
    /*
      L24/L25 — un split Apple, exporté en deux jambes `ASSET_REDEEM` /
      `ASSET_DEPOSIT`. Ni un achat ni une vente : les traiter comme tels
      créerait une cession fictive et une plus-value avec elle. Sans type, les
      lignes ne sont pas importées.
    */
    expect(ligne(rows, 24).type).toBeNull();
    expect(ligne(rows, 25).type).toBeNull();
  });

  it("les lignes désalignées du fichier ne produisent pas de faux montants", () => {
    /*
      L2 et L3 portent un champ de plus que l'en-tête : la colonne « montant »
      y tombe vide et la devise reçoit un nombre. Aucun montant ne doit être
      fabriqué à partir de ce décalage.
    */
    for (const n of [2, 3]) {
      const r = ligne(rows, n);
      expect(r.cashAmount, `L${n}`).toBeNull();
    }
  });
});
