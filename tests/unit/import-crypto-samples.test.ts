import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { importCsv } from "@/app/lib/import/import-csv";
import { detectBestAdapter } from "@/app/lib/import/adapters/registry";
import { detectFormatFromHeaders } from "@/app/lib/import/presets";

/** En-têtes réels (échantillons Downloads/Patrimo) */
const HEADERS = {
  cryptocom:
    "Timestamp (UTC),Transaction Description,Currency,Amount,To Currency,To Amount,Native Currency,Native Amount,Native Amount (in USD),Transaction Kind,Transaction Hash",
  cryptocomDeposit:
    "Time (UTC),Coin,Deposit Amount,Fee,Deposit Address,Status,TxId",
  cryptocomWithdraw:
    "Time (UTC),Coin,Withdrawal Amount,Fee,Withdrawal Address,Status,Txid",
  nexoLegacy:
    "Transaction,Type,Currency,Amount,USD Equivalent,Details,Outstanding Loan,Date / Time",
  nexoModern:
    "Transaction,Type,Input Currency,Input Amount,Output Currency,Output Amount,USD Equivalent,Details,Date / Time",
  nexoUtc:
    "Transaction,Type,Input Currency,Input Amount,Output Currency,Output Amount,USD Equivalent,Details,Date / Time (UTC)",
  ascendex:
    "Time,Type,Projects,Token,Size,Type,Status",
  ascendexAward:
    "Time,Type,Projects,Token,Farming Balance,Income Type,Reward",
  coinbase:
    "Timestamp,Transaction Type,Asset,Quantity Transacted,Spot Price Currency,Spot Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes",
  /** Nouveau format Coinbase 2024–2026 (export fiscal / history) */
  coinbase2026:
    "ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes,Sender Address,Recipient Address",
};

function headersOf(csvLine: string): string[] {
  return parseCsv(csvLine + "\n").headers;
}

describe("auto-détection formats crypto (échantillons Downloads)", () => {
  it("détecte Crypto.com App via transaction_kind", () => {
    const h = headersOf(HEADERS.cryptocom);
    expect(detectFormatFromHeaders(h)).toBe("cryptocom");
    const best = detectBestAdapter(h);
    expect(best.adapter.meta.id).toBe("cryptocom");
    expect(best.score).toBeGreaterThanOrEqual(85);
  });

  it("détecte Crypto.com deposit/withdrawal", () => {
    expect(detectFormatFromHeaders(headersOf(HEADERS.cryptocomDeposit))).toBe(
      "cryptocom_transfer"
    );
    expect(detectFormatFromHeaders(headersOf(HEADERS.cryptocomWithdraw))).toBe(
      "cryptocom_transfer"
    );
    expect(detectBestAdapter(headersOf(HEADERS.cryptocomDeposit)).adapter.meta.id).toBe(
      "cryptocom_transfer"
    );
  });

  it("détecte Nexo (legacy + modern)", () => {
    expect(detectFormatFromHeaders(headersOf(HEADERS.nexoLegacy))).toBe("nexo");
    expect(detectFormatFromHeaders(headersOf(HEADERS.nexoModern))).toBe("nexo");
    expect(detectFormatFromHeaders(headersOf(HEADERS.nexoUtc))).toBe("nexo");
    expect(detectBestAdapter(headersOf(HEADERS.nexoModern)).score).toBeGreaterThanOrEqual(
      90
    );
  });

  it("détecte AscendEX staking", () => {
    expect(detectFormatFromHeaders(headersOf(HEADERS.ascendex))).toBe("ascendex");
    expect(detectFormatFromHeaders(headersOf(HEADERS.ascendexAward))).toBe(
      "ascendex"
    );
  });

  it("ne confond pas Coinbase et Crypto.com", () => {
    expect(detectFormatFromHeaders(headersOf(HEADERS.coinbase))).toBe("coinbase");
    expect(detectBestAdapter(headersOf(HEADERS.coinbase)).adapter.meta.id).toBe(
      "coinbase"
    );
    expect(detectBestAdapter(headersOf(HEADERS.cryptocom)).adapter.meta.id).not.toBe(
      "coinbase"
    );
  });
});

describe("importCsv — mini fixtures crypto", () => {
  it("importe une ligne Crypto.com withdrawal (sortie qty → VENTE ledger)", () => {
    const csv = `${HEADERS.cryptocom}
2023-12-13 21:19:39,Withdraw CRO,CRO,-10.3,,,USD,1.02,1.02,crypto_withdrawal,abc
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("cryptocom");
    expect(r.drafts.length).toBeGreaterThanOrEqual(1);
    const row = r.drafts[0]!;
    // Ledger: sortie crypto sans cash → VENTE @ 0 (pas RETRAIT cash)
    expect(["VENTE", "RETRAIT"]).toContain(row.type);
    expect(row.ticker?.toUpperCase()).toBe("CRO");
    expect(row.status).not.toBe("error");
  });

  it("importe Nexo interest (qty crypto → REWARD ledger)", () => {
    const csv = `${HEADERS.nexoModern}
NXT1,Interest,ETH,0.0001,ETH,0.0001,$0.15,"approved / ETH Interest",2023-10-16 07:00:00
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("nexo");
    // INTERET + qty crypto non-fiat → REWARD (entrée de parts)
    expect(["INTERET", "REWARD"]).toContain(r.drafts[0]?.type);
    expect(r.drafts[0]?.ticker?.toUpperCase()).toBe("ETH");
  });

  it("importe Crypto.com deposit (entrée qty → REWARD ledger)", () => {
    const csv = `${HEADERS.cryptocomDeposit}
2021-11-19 11:17:48.000,USDC,100.0,0,ADDR,Completed,tx1
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("cryptocom_transfer");
    // APPORT + qty crypto → REWARD (pas apport cash)
    expect(["APPORT", "REWARD"]).toContain(r.drafts[0]?.type);
    expect(r.drafts[0]?.ticker?.toUpperCase()).toBe("USDC");
  });

  it("saute le préambule Coinbase (ligne User / disclaimer)", () => {
    const csv = `"You can use this transaction report to inform your likely tax obligations."

User,test@example.com,abc123
${HEADERS.coinbase}
2022-01-01T12:00:00Z,Buy,BTC,0.01,EUR,40000,400,410,10,notes
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.csv.headers.some((h) => /timestamp/i.test(h))).toBe(true);
    expect(r.formatId).toBe("coinbase");
    expect(r.drafts[0]?.type).toBe("ACHAT");
  });

  it("importe le format Coinbase 2026 (Price at Transaction + Staking Income + UTC)", () => {
    expect(detectFormatFromHeaders(headersOf(HEADERS.coinbase2026))).toBe(
      "coinbase"
    );
    expect(
      detectBestAdapter(headersOf(HEADERS.coinbase2026)).adapter.meta.id
    ).toBe("coinbase");

    const csv = `Transactions
User,Jane Doe,uuid-here
${HEADERS.coinbase2026}
6a5aa0e250302ccdf88d84ad,2026-07-17 21:38:42 UTC,Staking Income,POL,0.00044609663,USD,$0.08269315706255785,$0.00004,$0.00004,$0.00,,,
id2,2026-07-12 21:17:54 UTC,Buy,BTC,0.01,USD,$65000.00,$650.00,$655.00,$5.00,Bought BTC,,
`;
    const r = importCsv(csv, { formatId: "auto" });
    expect(r.formatId).toBe("coinbase");
    expect(r.needsManualMapping).toBe(false);
    expect(r.drafts.length).toBe(2);

    const stake = r.drafts.find((d) => d.ticker === "POL");
    expect(stake?.type).toBe("REWARD");
    expect(stake?.status).not.toBe("error");
    expect(stake?.occurredAt).toBeTruthy();
    // Prix unitaire depuis Price at Transaction ($0.08…) pas seulement déduit
    expect(Number(stake?.unitPrice)).toBeGreaterThan(0.05);

    const buy = r.drafts.find((d) => d.ticker === "BTC");
    expect(buy?.type).toBe("ACHAT");
    expect(buy?.status).not.toBe("error");
    expect(Number(buy?.unitPrice)).toBeGreaterThan(1000);
  });
});
