import { describe, it, expect } from "vitest";
import { hyperliquidTradeAdapter } from "@/app/lib/import/adapters/hyperliquid-trade-adapter";

describe("Hyperliquid Trade History Parser", () => {
  const headers = ["time", "coin", "dir", "px", "sz", "ntl", "fee", "closedPnl"];

  it("detects Hyperliquid Trade History format", () => {
    const score = hyperliquidTradeAdapter.detect(headers);
    expect(score).toBe(98);
  });

  it("parses a long buy trade correctly", () => {
    const rows = [
      {
        time: "25/09/2025 13:33:06",
        coin: "HYPE/USDC",
        dir: "Buy",
        px: "42.184",
        sz: "20",
        ntl: "843.68",
        fee: "0.01344",
        closedPnl: "-0.56695296",
      },
    ];

    const result = hyperliquidTradeAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.type).toBe("BUY");
    expect(tx?.ticker).toBe("HYPE");
    expect(tx?.quantity).toBe(20);
    expect(tx?.price).toBe(42.184);
    expect(tx?.fees).toBe(0.01344);
    expect(tx?.cashAmount).toBe(843.68);
    expect(tx?.currency).toBe("USD");
  });

  it("parses an open short trade and marks as unsupported", () => {
    const rows = [
      {
        time: "20/05/2025 10:36:08",
        coin: "PAXG",
        dir: "Open Short",
        px: "3245.7",
        sz: "0.172",
        ntl: "558.2603999999999",
        fee: "0.080389",
        closedPnl: "-0.080389",
      },
    ];

    const result = hyperliquidTradeAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Direction 'Open Short' non supportée")
    );
  });

  it("normalizes ticker by removing /USDC suffix", () => {
    const rows = [
      {
        time: "11/07/2026 19:33:18",
        coin: "BTC/USDC",
        dir: "Sell",
        px: "64338",
        sz: "0.00247",
        ntl: "158.91486",
        fee: "0.0610233",
        closedPnl: "-101.7805633",
      },
    ];

    const result = hyperliquidTradeAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.ticker).toBe("BTC");
  });
});
