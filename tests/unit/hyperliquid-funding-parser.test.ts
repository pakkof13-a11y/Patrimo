import { describe, it, expect } from "vitest";
import { hyperliquidFundingAdapter } from "@/app/lib/import/adapters/hyperliquid-funding-adapter";

describe("Hyperliquid Funding History Parser", () => {
  const headers = ["time", "coin", "sz", "side", "payment", "rate"];

  it("detects Hyperliquid Funding History format", () => {
    const score = hyperliquidFundingAdapter.detect(headers);
    expect(score).toBe(98);
  });

  it("parses a funding income entry correctly", () => {
    const rows = [
      {
        time: "20/05/2025 02:00:00",
        coin: "PAXG",
        sz: "1.05",
        side: "Short",
        payment: "1.293073",
        rate: "0.0000250038",
      },
    ];

    const result = hyperliquidFundingAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.type).toBe("BUY");
    expect(tx?.ticker).toBe("PAXG");
    expect(tx?.cashAmount).toBe(1.293073);
    expect(tx?.rawType).toBe("FUNDING_INCOME");
    expect(tx?.currency).toBe("USD");
  });

  it("parses a funding fee entry correctly", () => {
    const rows = [
      {
        time: "29/05/2025 02:00:00",
        coin: "PAXG",
        sz: "1.05",
        side: "Short",
        payment: "-0.098165",
        rate: "-0.0000012551",
      },
    ];

    const result = hyperliquidFundingAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.type).toBe("SELL");
    expect(tx?.ticker).toBe("PAXG");
    expect(tx?.cashAmount).toBe(0.098165);
    expect(tx?.fees).toBe(0.098165);
    expect(tx?.rawType).toBe("FUNDING_FEE");
    expect(tx?.currency).toBe("USD");
  });

  it("rejects zero payment entries", () => {
    const rows = [
      {
        time: "01/06/2025 02:00:00",
        coin: "PAXG",
        sz: "1.05",
        side: "Short",
        payment: "0",
        rate: "0.0000095812",
      },
    ];

    const result = hyperliquidFundingAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(0);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Payment est zéro")
    );
  });
});
