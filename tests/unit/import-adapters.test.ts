import { describe, expect, it } from "vitest";
import { importCsv } from "@/app/lib/import/import-csv";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { parseDate, parseNumber, decodeCsvBuffer } from "@/app/lib/import/normalize";
import { autoMatchHeaders } from "@/app/lib/import/dynamic-mapper";
import { detectBestAdapter, listAdapters } from "@/app/lib/import/adapters/registry";

describe("normalize robustesse", () => {
  it("parses FR numbers with nbsp and currency", () => {
    expect(parseNumber("1\u00a0234,56 €")).toBeCloseTo(1234.56);
    expect(parseNumber("$1,234.56")).toBeCloseTo(1234.56);
    expect(parseNumber("−12,5")).toBeCloseTo(-12.5);
  });

  it("parses exotic dates", () => {
    const d1 = parseDate("15/03/2023 14:30");
    expect(d1?.getFullYear()).toBe(2023);
    expect(d1?.getMonth()).toBe(2);
    expect(d1?.getDate()).toBe(15);

    const d2 = parseDate("2024-06-01T10:00:00Z");
    expect(d2).not.toBeNull();

    const d3 = parseDate("15 Mar 2024");
    expect(d3?.getFullYear()).toBe(2024);
  });

  it("decodes latin1-ish buffer as text", () => {
    const bytes = new TextEncoder().encode("date;type\n01/01/2024;ACHAT\n");
    const text = decodeCsvBuffer(bytes.buffer);
    expect(text).toContain("ACHAT");
  });
});

describe("dynamic header auto-match", () => {
  it("maps Price / Quantité / Date keywords", () => {
    const r = autoMatchHeaders([
      "Date opération",
      "Type",
      "ISIN",
      "Quantité",
      "Prix unitaire",
      "Frais",
    ]);
    expect(r.columnMap["Date opération"]).toBe("date");
    expect(r.columnMap["Type"]).toBe("type");
    expect(r.columnMap["ISIN"]).toBe("ticker");
    expect(r.columnMap["Quantité"]).toBe("quantity");
    expect(r.columnMap["Prix unitaire"]).toBe("unitPrice");
    expect(r.missingRoles.length).toBe(0);
    expect(["high", "medium"]).toContain(r.confidence);
  });
});

describe("adapter registry", () => {
  it("lists platform adapters including new brokers", () => {
    const ids = listAdapters().map((a) => a.meta.id);
    expect(ids).toContain("patrimo");
    expect(ids).toContain("binance");
    expect(ids).toContain("fortuneo");
    expect(ids).toContain("trade_republic");
    expect(ids).toContain("interactive_brokers");
    expect(ids).toContain("dynamic");
  });

  it("detects binance headers", () => {
    const { adapter, score } = detectBestAdapter([
      "Date(UTC)",
      "Pair",
      "Side",
      "Price",
      "Executed",
      "Amount",
      "Fee",
    ]);
    expect(score).toBeGreaterThan(0);
    expect(["binance", "generic", "dynamic"]).toContain(adapter.meta.id);
  });

  it("detects Revolut Invest stocks over Patrimo", () => {
    const { adapter, score } = detectBestAdapter([
      "Date",
      "Ticker",
      "Type",
      "Quantity",
      "Price per share",
      "Total Amount",
      "Currency",
      "FX Rate",
    ]);
    expect(adapter.meta.id).toBe("revolut");
    expect(score).toBeGreaterThanOrEqual(90);
  });
});

describe("Revolut real-world exports", () => {
  it("recovers Excel whole-line-quoted crypto rows", () => {
    // Lignes encapsulées comme après édition Excel (double quotes)
    const text = [
      "Symbol,Type,Quantity,Price,Value,Fees,Date",
      '"BTC,Achat,""0,00000502"",""69 635,02€"",""0,35€"",""0,00€"",""9 mai 2026, 20:02:43"""',
      '"DOT,Mise en staking,""2,53384547"",""6,38€"",""16,17€"",""0,00€"",""7 févr. 2023, 21:58:19"""',
    ].join("\n");
    const r = importCsv(text, { formatId: "auto" });
    expect(r.formatId).toBe("revolut");
    expect(r.drafts).toHaveLength(2);
    expect(r.drafts.every((d) => d.status === "ok" || d.status === "warning")).toBe(
      true
    );
    expect(r.drafts[0].type).toBe("ACHAT");
    expect(r.drafts[0].ticker).toBe("BTC");
    expect(Number(r.drafts[0].quantity)).toBeCloseTo(0.00000502, 10);
    expect(r.drafts[1].type).toBe("REWARD");
    expect(r.drafts[1].ticker).toBe("DOT");
  });

  it("imports Revolut stocks BUY - MARKET and cash movements", () => {
    const text = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,FX Rate
2021-06-14T09:00:19.573615Z,,CASH TOP-UP,,,USD 100,USD,1.2113
2021-06-14T13:32:37.807154Z,AMC,BUY - MARKET,1.92344681,USD 51.99,USD 100,USD,1.2129
2021-06-14T13:40:30.920289Z,AMC,SELL - MARKET,1.92344681,USD 52.74,USD 100.22,USD,1.2129
2026-04-27T17:21:08.163605Z,,STOCKS PROMOTION REWARD,,,USD 3,USD,1.1747
2026-05-29T13:37:32.218251Z,,STOCKS PROMOTION CLAWBACK,,,USD -0.94,USD,1.1677
`;
    const r = importCsv(text, { formatId: "auto" });
    expect(r.formatId).toBe("revolut");
    expect(r.drafts.every((d) => d.status !== "error")).toBe(true);
    expect(r.drafts[0].type).toBe("APPORT");
    expect(r.drafts[0].cashAmount).toBe("100");
    expect(r.drafts[1].type).toBe("ACHAT");
    expect(r.drafts[1].ticker).toBe("AMC");
    expect(Number(r.drafts[1].unitPrice)).toBeCloseTo(51.99);
    expect(r.drafts[1].assetClass).toBe("ACTIONS");
    expect(r.drafts[2].type).toBe("VENTE");
    expect(r.drafts[3].type).toBe("APPORT");
    expect(r.drafts[4].type).toBe("RETRAIT");
  });

  it("parses USD-prefixed amounts", () => {
    expect(parseNumber("USD 51.99")).toBeCloseTo(51.99);
    expect(parseNumber("EUR -360")).toBeCloseTo(-360);
  });

  it("maps Revolut Réception crypto to REWARD (not cash APPORT)", () => {
    const text = `Symbol,Type,Quantity,Price,Value,Fees,Date
ALGO,Réception,"1,989245","0,08€","0,15€","0,00€","22 juin 2026, 12:51:01"
`;
    const r = importCsv(text, { formatId: "auto" });
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0].type).toBe("REWARD");
    expect(r.drafts[0].ticker).toBe("ALGO");
    expect(Number(r.drafts[0].quantity)).toBeCloseTo(1.989245, 6);
    expect(r.drafts[0].status).not.toBe("error");
  });
});

describe("importCsv end-to-end", () => {
  it("imports Patrimo ACHAT / VENTE / DIVIDENDE", () => {
    const text = `date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class
15/03/2023;ACHAT;MC.PA;LVMH;8;612,50;12,5;EUR;;Achat;ACTIONS
20/06/2023;DIVIDENDE;MC.PA;LVMH;;;EUR;120;Div;ACTIONS
10/01/2024;VENTE;MC.PA;LVMH;2;700;5;EUR;;Vente;ACTIONS
`;
    const result = importCsv(text, { formatId: "patrimo" });
    expect(result.csv.delimiter).toBe(";");
    expect(result.drafts.length).toBe(3);
    expect(result.drafts[0]!.type).toBe("ACHAT");
    expect(result.drafts[0]!.status).toBe("ok");
    expect(Number(result.drafts[0]!.unitPrice)).toBeCloseTo(612.5);
    expect(result.drafts[1]!.type).toBe("DIVIDENDE");
    expect(result.drafts[2]!.type).toBe("VENTE");

    // TransactionImport standard
    const buys = result.transactions.filter((t) => t.type === "BUY");
    expect(buys.length).toBeGreaterThanOrEqual(1);
    expect(buys[0]!.ticker).toMatch(/MC/);
  });

  it("auto path on unknown French broker headers via dynamic", () => {
    const text = `Date opération;Sens;Code;Quantité;Prix;Commission
01/02/2024;Achat;FR0000121014;10;150,25;1,20
`;
    const result = importCsv(text, { formatId: "auto" });
    expect(result.csv.headers.length).toBeGreaterThan(3);
    // Should produce some drafts or transactions
    expect(result.drafts.length + result.transactions.length).toBeGreaterThan(0);
  });

  it("honours manual columnMap override", () => {
    const text = `colA;colB;colC;colD;colE
2024-01-15;BUY;AAPL;3;180
`;
    const csv = parseCsv(text);
    expect(csv.rows).toHaveLength(1);

    const result = importCsv(text, {
      formatId: "dynamic",
      columnMap: {
        colA: "date",
        colB: "side",
        colC: "ticker",
        colD: "quantity",
        colE: "unitPrice",
      },
    });
    expect(result.needsManualMapping).toBe(false);
    expect(result.transactions.length).toBe(1);
    expect(result.transactions[0]!.type).toBe("BUY");
    expect(result.transactions[0]!.ticker).toBe("AAPL");
    expect(result.transactions[0]!.quantity).toBe(3);
    expect(result.transactions[0]!.price).toBe(180);
  });

  it("handles Excel sep= hint", () => {
    const text = `sep=;
date;type;ticker;quantity;unit_price
15/03/2023;ACHAT;AIR.PA;5;100
`;
    const csv = parseCsv(text);
    expect(csv.delimiter).toBe(";");
    expect(csv.headers.some((h) => /date/i.test(h))).toBe(true);
    expect(csv.rows.length).toBe(1);
  });
});
