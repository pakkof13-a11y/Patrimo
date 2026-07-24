import { describe, expect, it } from "vitest";
import {
  inferDecimalSeparator,
  parseNumber,
} from "@/app/lib/import/normalize";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts } from "@/app/lib/import/map-rows";
import {
  inferRowsDecimalSeparator,
  rowToTransactionImport,
} from "@/app/lib/import/adapters/row-utils";

/**
 * Régression : `parseNumber("1,000")` renvoyait 1 et `"1,500"` renvoyait 1.5.
 * Un export EN avec séparateur de milliers et sans décimales était donc divisé
 * par 1000 silencieusement. La valeur seule est indécidable — c'est la colonne
 * entière qui tranche.
 */
describe("inferDecimalSeparator", () => {
  it("tranche sur les deux séparateurs présents (signal le plus fort)", () => {
    expect(inferDecimalSeparator(["1,234.56"])).toBe("dot");
    expect(inferDecimalSeparator(["1.234,56"])).toBe("comma");
  });

  it("déduit la virgule décimale d'un groupe de taille ≠ 3", () => {
    expect(inferDecimalSeparator(["1,23"])).toBe("comma");
    expect(inferDecimalSeparator(["0,00000502"])).toBe("comma");
    expect(inferDecimalSeparator(["2,53384547"])).toBe("comma");
  });

  it("déduit le point décimal d'un groupe de taille ≠ 3", () => {
    expect(inferDecimalSeparator(["12.5"])).toBe("dot");
    expect(inferDecimalSeparator(["0.00000502"])).toBe("dot");
  });

  it("traite les virgules multiples comme des milliers", () => {
    expect(inferDecimalSeparator(["1,234,567"])).toBe("dot");
  });

  it("renvoie undefined quand la colonne est entièrement ambiguë", () => {
    expect(inferDecimalSeparator(["1,234"])).toBeUndefined();
    expect(inferDecimalSeparator(["1,234", "2,500"])).toBeUndefined();
  });

  it("une seule valeur non ambiguë suffit à trancher toute la colonne", () => {
    // "1,234" seul est indécidable ; "12.5" prouve que le point est décimal.
    expect(inferDecimalSeparator(["1,234", "12.5"])).toBe("dot");
    // Inversement, "0,5" prouve que la virgule est décimale.
    expect(inferDecimalSeparator(["1,234", "0,5"])).toBe("comma");
  });

  it("ignore les cellules vides ou non numériques", () => {
    expect(inferDecimalSeparator(["", null, undefined, "N/A", "12.5"])).toBe(
      "dot"
    );
  });
});

describe("parseNumber avec séparateur connu", () => {
  it("lit 1,000 comme mille quand la colonne est en point décimal", () => {
    expect(parseNumber("1,000", "dot")).toBe(1000);
    expect(parseNumber("1,500", "dot")).toBe(1500);
    expect(parseNumber("12,345", "dot")).toBe(12345);
    expect(parseNumber("-1,234", "dot")).toBe(-1234);
  });

  it("garde la lecture décimale FR quand la colonne est en virgule", () => {
    expect(parseNumber("1,234", "comma")).toBeCloseTo(1.234, 6);
    expect(parseNumber("1,500", "comma")).toBeCloseTo(1.5, 6);
  });

  it("conserve le comportement historique sans indication", () => {
    // Défaut inchangé : décimal FR (quantités crypto type 0,00000502).
    expect(parseNumber("1,234")).toBeCloseTo(1.234, 6);
    expect(parseNumber("0,00000502")).toBeCloseTo(0.00000502, 12);
  });

  it("n'altère pas les valeurs non ambiguës, quel que soit l'indice", () => {
    for (const hint of ["dot", "comma", undefined] as const) {
      expect(parseNumber("1,234.56", hint)).toBeCloseTo(1234.56, 6);
      expect(parseNumber("1.234,56", hint)).toBeCloseTo(1234.56, 6);
      expect(parseNumber("1,234,567", hint)).toBe(1234567);
      expect(parseNumber("0,00000502", hint)).toBeCloseTo(0.00000502, 12);
      expect(parseNumber("42", hint)).toBe(42);
    }
  });

  it("gère les parenthèses comptables et les préfixes devise", () => {
    expect(parseNumber("(1,000)", "dot")).toBe(-1000);
    expect(parseNumber("USD 1,000", "dot")).toBe(1000);
  });
});

describe("mapCsvToDrafts — séparateur déduit sur le fichier entier", () => {
  it("un export EN avec milliers n'est plus divisé par 1000", () => {
    // Prix « 1,250.50 » lève l'ambiguïté : le point est décimal, donc la
    // quantité « 1,000 » vaut mille et le cash « 2,500 » vaut 2500.
    const text = [
      "date,type,ticker,quantity,unit_price,cash_amount",
      "15/03/2024,ACHAT,AAPL,1000,1250.50,2500",
      '20/03/2024,ACHAT,MSFT,"1,000","1,250.50","2,500"',
    ].join("\n");

    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "generic");

    // Les deux lignes décrivent la même opération, écrite sans puis avec
    // séparateur de milliers : elles doivent donner le même résultat.
    expect(rows[0]!.quantity).toBe(rows[1]!.quantity);
    expect(rows[0]!.unitPrice).toBe(rows[1]!.unitPrice);
    expect(Number(rows[1]!.quantity)).toBeCloseTo(1000, 6);
    expect(Number(rows[1]!.unitPrice)).toBeCloseTo(1250.5, 6);
  });

  it("un export FR garde ses décimales à la virgule", () => {
    const text = [
      "date;type;ticker;quantity;unit_price",
      "15/03/2024;ACHAT;BTC;0,00000502;69 635,02",
      "16/03/2024;ACHAT;ETH;1,234;3 500,10",
    ].join("\n");

    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "generic");

    expect(Number(rows[0]!.quantity)).toBeCloseTo(0.00000502, 12);
    expect(Number(rows[0]!.unitPrice)).toBeCloseTo(69635.02, 2);
    // « 1,234 » reste 1.234 : la colonne prouve que la virgule est décimale.
    expect(Number(rows[1]!.quantity)).toBeCloseTo(1.234, 6);
  });

  it("sans signal dans le fichier, le comportement historique est conservé", () => {
    const text = [
      "date,type,ticker,quantity,unit_price",
      "15/03/2024,ACHAT,ETH,\"1,234\",\"2,500\"",
    ].join("\n");

    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "generic");
    // Colonne entièrement ambiguë → décimal FR par défaut, comme avant.
    expect(Number(rows[0]!.quantity)).toBeCloseTo(1.234, 6);
  });
});

describe("adaptateur générique — même déduction sur le fichier", () => {
  it("dynamicAdapter ne divise plus un montant EN par 1000", () => {
    const rows = [
      {
        Date: "15/03/2024",
        Type: "BUY",
        Ticker: "AAPL",
        Quantity: "1,000",
        Price: "1,250.50",
      },
    ];
    const columnMap = {
      Date: "date",
      Type: "type",
      Ticker: "ticker",
      Quantity: "quantity",
      Price: "unitPrice",
    } as const;

    const sep = inferRowsDecimalSeparator(rows, columnMap);
    expect(sep).toBe("dot");

    const { tx, errors } = rowToTransactionImport(rows[0]!, columnMap, 2, sep);
    expect(errors).toEqual([]);
    expect(tx?.quantity).toBeCloseTo(1000, 6);
    expect(tx?.price).toBeCloseTo(1250.5, 6);
  });

  it("laisse intactes les quantités crypto FR", () => {
    const rows = [
      {
        Date: "15/03/2024",
        Type: "BUY",
        Ticker: "BTC",
        Quantity: "0,00000502",
        Price: "69635,02",
      },
    ];
    const columnMap = {
      Date: "date",
      Type: "type",
      Ticker: "ticker",
      Quantity: "quantity",
      Price: "unitPrice",
    } as const;

    const sep = inferRowsDecimalSeparator(rows, columnMap);
    expect(sep).toBe("comma");

    const { tx } = rowToTransactionImport(rows[0]!, columnMap, 2, sep);
    expect(tx?.quantity).toBeCloseTo(0.00000502, 12);
    expect(tx?.price).toBeCloseTo(69635.02, 2);
  });
});
