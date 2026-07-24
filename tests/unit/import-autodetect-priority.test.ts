import { describe, it, expect } from "vitest";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";
import { isIbkrActivityStatement } from "@/app/lib/import/ibkr-activity";
import { importCsv } from "@/app/lib/import/import-csv";

/**
 * Priorité de détection auto (spéc produit) — du plus spécifique au moins
 * spécifique : Paradex > Nexo > Hyperliquid Funding > Hyperliquid Trades > IBKR.
 * Les fingerprints étant mutuellement exclusifs (headers exacts distincts),
 * l'ordre ne change pas le résultat mais est vérifié explicitement ici.
 */
describe("CSV platform auto-detection — priority fingerprints", () => {
  it("detects Paradex via fill_type=FILL + realized_funding", () => {
    const headers = [
      "id",
      "side",
      "liquidity",
      "market",
      "order_id",
      "price",
      "size",
      "fee",
      "fee_currency",
      "created_at",
      "remaining_size",
      "client_id",
      "fill_type",
      "realized_pnl",
      "realized_funding",
      "account",
      "underlying_price",
      "flags",
      "orderbook_seq_no",
      "rawId",
    ];
    expect(detectFormatFromHeaders(headers)).toBe("paradex");
  });

  it("detects Nexo via Transaction (NXT) + Type + Date/Time columns", () => {
    const headers = [
      "Transaction",
      "Type",
      "Input Currency",
      "Input Amount",
      "Output Currency",
      "Output Amount",
      "USD Equivalent",
      "Details",
      "Date / Time (UTC)",
    ];
    expect(detectFormatFromHeaders(headers)).toBe("nexo");
  });

  it("detects Hyperliquid Funding History via exact headers", () => {
    const headers = ["time", "coin", "sz", "side", "payment", "rate"];
    expect(detectFormatFromHeaders(headers)).toBe("hyperliquid_funding");
  });

  it("detects Hyperliquid Trade History via exact headers", () => {
    const headers = ["time", "coin", "dir", "px", "sz", "ntl", "fee", "closedPnl"];
    expect(detectFormatFromHeaders(headers)).toBe("hyperliquid_trade");
  });

  it("detects an IBKR Activity Statement via BrokerName + Interactive Brokers", () => {
    const text = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,ADBE,"2025-10-20, 09:30:04",0.5,334.65,343.4,-167.325,-0.35036825,167.67536825,0,4.375,O
`;
    expect(isIbkrActivityStatement(text)).toBe(true);
  });

  it("preselects the right platform end-to-end for each fingerprint (formatId=auto)", () => {
    const paradex = importCsv(
      `id,side,liquidity,market,order_id,price,size,fee,fee_currency,created_at,remaining_size,client_id,fill_type,realized_pnl,realized_funding,account,underlying_price,flags,orderbook_seq_no,rawId
FILL-1,BUY,MAKER,DIME-USD,1,"1","1","0",USDC,2026-01-01T00:00:00.000Z,0,,FILL,"0","0",0x1,"1",[],1,1
`,
      { formatId: "auto" }
    );
    expect(paradex.formatId).toBe("paradex");

    const hlFunding = importCsv(
      `time,coin,sz,side,payment,rate
20/05/2025 02:00:00,PAXG,1.05,Short,1.293073,0.0000250038
`,
      { formatId: "auto" }
    );
    expect(hlFunding.formatId).toBe("hyperliquid_funding");

    const hlTrade = importCsv(
      `time,coin,dir,px,sz,ntl,fee,closedPnl
25/09/2025 13:33:06,HYPE/USDC,Buy,42.184,20,843.68,0.01344,-0.56695296
`,
      { formatId: "auto" }
    );
    expect(hlTrade.formatId).toBe("hyperliquid_trade");

    const ibkr = importCsv(
      `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,ADBE,"2025-10-20, 09:30:04",0.5,334.65,343.4,-167.325,-0.35036825,167.67536825,0,4.375,O
`,
      { formatId: "auto" }
    );
    expect(ibkr.formatId).toBe("interactive_brokers");
  });
});
