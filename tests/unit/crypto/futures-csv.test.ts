import { describe, expect, it } from "vitest";
import { parseFuturesCsv } from "@/app/lib/crypto/futures-csv";

describe("parseFuturesCsv — Binance", () => {
  it("reconnaît un export de trade history clôturé", () => {
    const csv =
      "Order Id,Date,Symbol,Side,Quantity,Price,Closing Price,Leverage,Realized Profit,Funding Fee,Commission\n" +
      "888,2025-06-01,BTCUSDT,BUY,0.5,60000,66000,10,3000,-5,-3\n";
    const res = parseFuturesCsv(csv, "BINANCE");
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0];
    expect(r.pair).toBe("BTCUSDT");
    expect(r.direction).toBe("LONG");
    expect(r.sizeContracts).toBe("0.5");
    expect(r.entryPrice).toBe("60000");
    expect(r.exitPrice).toBe("66000");
    expect(r.realizedPnl).toBe("3000");
    expect(r.exchangeTradeId).toBeTruthy();
  });

  it("reconnaît SELL comme SHORT", () => {
    const csv =
      "Date,Symbol,Side,Quantity,Price,OrderId\n" +
      "2025-06-01,ETHUSDT,SELL,2,3000,999\n";
    const res = parseFuturesCsv(csv, "BINANCE");
    expect(res.rows[0]?.direction).toBe("SHORT");
  });
});

describe("parseFuturesCsv — Bybit", () => {
  it("reconnaît un export Closed P&L", () => {
    const csv =
      "Order No,Contracts,Direction,Qty,Avg Entry Price,Avg Exit Price,Leverage,Closed PnL,Created Time\n" +
      "abc123,ETHUSDT,Short,1.5,3000,2800,5,300,2025-06-02\n";
    const res = parseFuturesCsv(csv, "BYBIT");
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0];
    expect(r.direction).toBe("SHORT");
    expect(r.entryPrice).toBe("3000");
    expect(r.exitPrice).toBe("2800");
    expect(r.realizedPnl).toBe("300");
  });
});

describe("parseFuturesCsv — OKX", () => {
  it("reconnaît un export d'historique d'ordres", () => {
    const csv =
      "ordId,instId,side,sz,openAvgPx,closeAvgPx,lever,pnl\n" +
      "42,BTC-USDT-SWAP,buy,0.2,61000,63000,20,400\n";
    const res = parseFuturesCsv(csv, "OKX");
    expect(res.rows).toHaveLength(1);
    const r = res.rows[0];
    expect(r.pair).toBe("BTC-USDT-SWAP");
    expect(r.direction).toBe("LONG");
    expect(r.realizedPnl).toBe("400");
  });
});

describe("parseFuturesCsv — tolérance aux lignes incomplètes", () => {
  it("ignore une ligne sans identifiant de trade plutôt que d'échouer", () => {
    const csv =
      "Date,Symbol,Side,Quantity,Price,OrderId\n" +
      "2025-06-01,BTCUSDT,BUY,1,60000,\n" +
      "2025-06-02,ETHUSDT,SELL,2,3000,777\n";
    const res = parseFuturesCsv(csv, "BINANCE");
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it("signale une ligne dont le sens n'est pas reconnu", () => {
    const csv =
      "Date,Symbol,Side,Quantity,Price,OrderId\n" +
      "2025-06-01,BTCUSDT,UNKNOWN,1,60000,555\n";
    const res = parseFuturesCsv(csv, "BINANCE");
    expect(res.rows).toHaveLength(0);
    expect(res.skipped).toBe(1);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("accepte les nombres au format français (virgule décimale)", () => {
    const csv =
      "Date,Symbol,Side,Quantity,Price,OrderId,Realized Profit\n" +
      "2025-06-01,BTCUSDT,BUY,\"1,5\",\"60000,50\",111,\"250,75\"\n";
    const res = parseFuturesCsv(csv, "BINANCE");
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.sizeContracts).toBe("1.5");
    expect(res.rows[0]?.entryPrice).toBe("60000.5");
    expect(res.rows[0]?.realizedPnl).toBe("250.75");
  });
});
