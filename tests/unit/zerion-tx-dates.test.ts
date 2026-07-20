import { describe, expect, it } from "vitest";
import { extractZerionTxTimestamp, type ZerionTxItem } from "@/app/lib/zerion/client";
import { buildZerionFirstSeenMap } from "@/app/lib/zerion/ledger-sync";

describe("extractZerionTxTimestamp", () => {
  it("préfère mined_at ISO", () => {
    const r = extractZerionTxTimestamp({
      mined_at: "2023-05-10T14:30:00.000Z",
      timestamp: 1_700_000_000,
    });
    expect(r.iso).toBe("2023-05-10T14:30:00.000Z");
    expect(r.unix).toBe(
      Math.floor(Date.parse("2023-05-10T14:30:00.000Z") / 1000)
    );
  });

  it("fallback sent_at puis timestamp unix secondes", () => {
    const r = extractZerionTxTimestamp({
      mined_at: null,
      sent_at: "2022-01-01T00:00:00.000Z",
    });
    expect(r.iso).toBe("2022-01-01T00:00:00.000Z");

    const r2 = extractZerionTxTimestamp({
      timestamp: 1_609_459_200, // 2021-01-01 UTC
    });
    expect(r2.iso).toBeTruthy();
    expect(r2.unix).toBe(1_609_459_200);
  });

  it("rejette timestamps absurdes (avant 2015)", () => {
    const r = extractZerionTxTimestamp({
      timestamp: 1000, // 1970
    });
    expect(r.iso).toBeNull();
  });
});

describe("buildZerionFirstSeenMap", () => {
  it("retient la date la plus ancienne par ticker/chain", () => {
    const txs: ZerionTxItem[] = [
      {
        hash: "0x1",
        date: null,
        timestampUnix: 1_700_000_000,
        occurredAtIso: "2023-11-14T12:00:00.000Z",
        type: "RECEIVE",
        status: "success",
        chainId: "base",
        application: null,
        isTrash: false,
        transfers: [
          {
            direction: "in",
            ticker: "ETH",
            name: "Ethereum",
            amount: 0.1,
            priceUsd: 2000,
            valueUsd: 200,
            logo: null,
            contractAddress: null,
          },
        ],
      },
      {
        hash: "0x2",
        date: null,
        timestampUnix: 1_600_000_000,
        occurredAtIso: "2020-09-13T12:00:00.000Z",
        type: "RECEIVE",
        status: "success",
        chainId: "base",
        application: null,
        isTrash: false,
        transfers: [
          {
            direction: "in",
            ticker: "ETH",
            name: "Ethereum",
            amount: 0.05,
            priceUsd: 300,
            valueUsd: 15,
            logo: null,
            contractAddress: null,
          },
        ],
      },
    ];
    const map = buildZerionFirstSeenMap(txs);
    expect(map.get("t:base:ETH")).toBe("2020-09-13T12:00:00.000Z");
  });

  it("ignore trash et failed", () => {
    const txs: ZerionTxItem[] = [
      {
        hash: "0xbad",
        date: null,
        timestampUnix: 1,
        occurredAtIso: "2020-01-01T00:00:00.000Z",
        type: "RECEIVE",
        status: "failed",
        chainId: "ethereum",
        application: null,
        isTrash: false,
        transfers: [
          {
            direction: "in",
            ticker: "ETH",
            name: "Ethereum",
            amount: 1,
            priceUsd: null,
            valueUsd: null,
            logo: null,
            contractAddress: null,
          },
        ],
      },
    ];
    expect(buildZerionFirstSeenMap(txs).size).toBe(0);
  });
});
