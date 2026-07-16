import { describe, expect, it } from "vitest";
import { parseCsv, normalizeHeader } from "../../app/lib/import/csv-parse";
import { parseDate, parseNumber } from "../../app/lib/import/normalize";
import { mapCsvToDrafts } from "../../app/lib/import/map-rows";
import {
  mapTxType,
  normalizeTicker,
  guessAssetClass,
  detectFormatFromHeaders,
} from "../../app/lib/import/presets";

describe("csv-parse", () => {
  it("parses semicolon CSV with headers", () => {
    const text = "date;type;ticker;quantity;unit_price\n15/03/2023;ACHAT;MC.PA;8;612.5\n";
    const csv = parseCsv(text);
    expect(csv.delimiter).toBe(";");
    expect(csv.headers).toContain("date");
    expect(csv.rows).toHaveLength(1);
    expect(csv.rows[0].ticker).toBe("MC.PA");
  });

  it("normalizes headers", () => {
    expect(normalizeHeader("Prix unitaire")).toBe("prix_unitaire");
    expect(normalizeHeader("  Date ")).toBe("date");
  });
});

describe("normalize numbers and dates", () => {
  it("parses French decimals", () => {
    expect(parseNumber("1 234,56")).toBeCloseTo(1234.56);
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("(100)")).toBe(-100);
  });

  it("parses FR dates", () => {
    const d = parseDate("15/03/2023");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2023);
    expect(d!.getMonth()).toBe(2);
    expect(d!.getDate()).toBe(15);
  });
});

describe("presets", () => {
  it("maps types and sides", () => {
    expect(mapTxType("buy")).toBe("ACHAT");
    expect(mapTxType(null, "SELL")).toBe("VENTE");
    expect(mapTxType("Dividende")).toBe("DIVIDENDE");
  });

  it("normalizes tickers and asset classes", () => {
    expect(normalizeTicker("BTCUSDT")).toBe("BTC");
    expect(guessAssetClass("MC.PA")).toBe("ACTIONS");
    expect(guessAssetClass("BTC")).toBe("CRYPTO");
  });
});

describe("mapCsvToDrafts", () => {
  it("maps Patrimo template rows", () => {
    const text = `date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class
15/03/2023;ACHAT;MC.PA;LVMH;8;612.5;12.5;EUR;;Achat;ACTIONS
10/05/2024;APPORT;;;;;;EUR;5000;Apport;CASH
`;
    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "patrimo");
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].type).toBe("ACHAT");
    expect(rows[0].quantity).toBe("8");
    expect(rows[1].type).toBe("APPORT");
    expect(rows[1].cashAmount).toBe("5000");
  });

  it("maps binance-like buy row", () => {
    const text = `Date(UTC),Pair,Side,Price,Executed,Amount,Fee
2024-01-15 10:00:00,BTCUSDT,BUY,42000,0.1,4200,0.0001
`;
    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "binance");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("ACHAT");
    expect(rows[0].ticker).toBe("BTC");
    expect(Number(rows[0].quantity)).toBeCloseTo(0.1);
  });

  it("maps Revolut invest buy + account topup", () => {
    const invest = `Date,Ticker,Type,Quantity,Price per share,Total Amount,Currency,Fee
2024-03-10,AAPL,BUY,2,180.5,361,USD,1
`;
    const investCsv = parseCsv(invest);
    const investRows = mapCsvToDrafts(investCsv, "revolut").rows;
    expect(investRows).toHaveLength(1);
    expect(investRows[0].type).toBe("ACHAT");
    expect(investRows[0].ticker).toBe("AAPL");
    expect(Number(investRows[0].quantity)).toBeCloseTo(2);
    expect(Number(investRows[0].unitPrice)).toBeCloseTo(180.5);

    const stmt = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
TOPUP,Current,2024-03-01 09:00:00,2024-03-01 09:00:01,Payment from John,1000.00,0,EUR,COMPLETED,1500
EXCHANGE,Current,2024-03-10 12:00:00,2024-03-10 12:00:01,Exchanged to BTC,-500.00,0,EUR,COMPLETED,1000
`;
    const stmtCsv = parseCsv(stmt);
    const stmtRows = mapCsvToDrafts(stmtCsv, "revolut").rows;
    expect(stmtRows[0].type).toBe("APPORT");
    expect(stmtRows[0].cashAmount).toBe("1000");
    // Exchange without crypto qty → recognized as ACHAT BTC but qty missing
    expect(stmtRows[1].ticker).toBe("BTC");
    expect(stmtRows[1].type).toBe("ACHAT");
    expect(stmtRows[1].status).toBe("error"); // needs quantity
  });

  it("maps Coinbase buy/sell history", () => {
    const text = `Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes
2024-06-01T10:00:00Z,Buy,ETH,0.5,EUR,3000,1500,1510,10,Bought ETH
2024-06-15T10:00:00Z,Sell,ETH,0.2,EUR,3200,640,635,5,Sold ETH
`;
    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "coinbase");
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("ACHAT");
    expect(rows[0].ticker).toBe("ETH");
    expect(Number(rows[0].quantity)).toBeCloseTo(0.5);
    expect(Number(rows[0].unitPrice)).toBeCloseTo(3000);
    expect(rows[1].type).toBe("VENTE");
    expect(Number(rows[1].quantity)).toBeCloseTo(0.2);
  });
});

describe("detectFormatFromHeaders", () => {
  it("detects coinbase and revolut headers", () => {
    expect(
      detectFormatFromHeaders([
        "Timestamp",
        "Transaction Type",
        "Asset",
        "Quantity Transacted",
      ])
    ).toBe("coinbase");
    expect(
      detectFormatFromHeaders([
        "Type",
        "Product",
        "Started Date",
        "Description",
        "Amount",
        "Currency",
      ])
    ).toBe("revolut");
  });
});
