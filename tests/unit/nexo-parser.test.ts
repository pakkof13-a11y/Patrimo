import { describe, it, expect } from "vitest";
import { nexoAdapter } from "@/app/lib/import/adapters/nexo-adapter";

describe("Nexo Parser", () => {
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

  it("detects Nexo format with NXT transaction IDs", () => {
    const score = nexoAdapter.detect(headers);
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("parses an interest transaction correctly", () => {
    const rows = [
      {
        Transaction: "NXT3GGdeNSl8NmrFlYFFoY2CF",
        Type: "Interest",
        "Input Currency": "USDT",
        "Input Amount": "0.48399900",
        "Output Currency": "USDT",
        "Output Amount": "0.48399900",
        "USD Equivalent": "$0.48",
        Details: "approved / USDT Interest Earned",
        "Date / Time (UTC)": "2024-02-11 06:00:00",
      },
    ];

    const result = nexoAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.type).toBe("BUY");
    expect(tx?.ticker).toBe("USDT");
    expect(tx?.quantity).toBe(0.48399900);
    expect(tx?.currency).toBe("USD");
    expect(tx?.rawType).toBe("Interest");
  });

  it("parses a withdrawal transaction correctly", () => {
    const rows = [
      {
        Transaction: "NXT4kejWLcE0TlIu96q0bIsNY",
        Type: "Withdrawal",
        "Input Currency": "USDT",
        "Input Amount": "-2050.19189500",
        "Output Currency": "USDT",
        "Output Amount": "2050.19189500",
        "USD Equivalent": "$2050.87",
        Details: "approved / USDT withdrawal",
        "Date / Time (UTC)": "2024-02-11 20:30:42",
      },
    ];

    const result = nexoAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.type).toBe("SELL");
    expect(tx?.ticker).toBe("USDT");
    expect(tx?.quantity).toBe(2050.19189500);
    expect(tx?.currency).toBe("USD");
    expect(tx?.cashAmount).toBe(2050.87);
  });

  it("extracts on-chain hash from details field", () => {
    const rows = [
      {
        Transaction: "NXT2okZJw1xgSgRg4ehmOXlRa",
        Type: "Top up Crypto",
        "Input Currency": "USDT",
        "Input Amount": "15.81870000",
        "Output Currency": "USDT",
        "Output Amount": "15.81870000",
        "USD Equivalent": "$15.81",
        Details:
          "approved / 0x439b7dd667c87723728660106e250e6a41cb3dc9297f89b635618f80974b5978",
        "Date / Time (UTC)": "2024-01-13 09:35:23",
      },
    ];

    const result = nexoAdapter.parse({
      headers,
      rows,
    });

    expect(result.transactions).toHaveLength(1);
    const tx = result.transactions[0];
    expect(tx?.notes).toContain("0x439b7dd667c87723728660106e250e6a41cb3dc9297f89b635618f80974b5978");
  });
});
