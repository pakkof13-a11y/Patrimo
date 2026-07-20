import { describe, expect, it } from "vitest";
import { parseCsv } from "@/app/lib/import/csv-parse";
import { mapCsvToDrafts } from "@/app/lib/import/map-rows";
import {
  detectFormatFromHeaders,
  mapTxType,
} from "@/app/lib/import/presets";
import { detectBestAdapter } from "@/app/lib/import/adapters/registry";

const LEDGER_HEADERS =
  "Operation Date,Status,Currency Ticker,Operation Type,Operation Amount,Operation Fees,Operation Hash,Account Name,Account xpub,Countervalue Ticker,Countervalue at Operation Date,Countervalue at CSV Export";

const SAMPLE = `${LEDGER_HEADERS}
2026-07-07T16:01:03.000Z,Confirmed,DOGE,IN,2886.49,0.177,hash1,Dogecoin,xpub1,USD,216.04,209.11
2026-07-07T15:25:01.000Z,Confirmed,DOGE,OUT,13.44786052,0.05786052,hash2,Dogecoin,xpub1,USD,1.00,0.97
2026-07-14T12:45:53.000Z,Confirmed,ETH,FEES,0.000003970885464,0.000003970885464,hash3,Arbitrum,0xabc,USD,0.00,0.00
2026-01-01T00:00:00.000Z,Failed,ETH,OUT,1,0.001,hash4,Ethereum,0xabc,USD,3000,3000
2025-06-01T12:00:00.000Z,Confirmed,ATOM,REWARD,0.5,0,hash5,Cosmos,xpub2,USD,5.00,5.00
2025-06-02T12:00:00.000Z,Confirmed,ATOM,DELEGATE,10,0.001,hash6,Cosmos,xpub2,USD,100,100
`;

describe("Ledger Live import", () => {
  it("détecte le format depuis les en-têtes", () => {
    const headers = LEDGER_HEADERS.split(",");
    expect(detectFormatFromHeaders(headers)).toBe("ledger_live");
    const { adapter, score } = detectBestAdapter(headers);
    expect(adapter.meta.id).toBe("ledger_live");
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it("mappe IN/OUT/FEES/REWARD", () => {
    expect(mapTxType("IN")).toBe("APPORT");
    expect(mapTxType("OUT")).toBe("RETRAIT");
    expect(mapTxType("FEES")).toBe("FRAIS");
    expect(mapTxType("REWARD")).toBe("REWARD");
    expect(mapTxType("DELEGATE")).toBe("TRANSFERT_TITRE");
  });

  it("convertit les lignes en drafts exploitables (sans flood d’avertissements)", () => {
    const csv = parseCsv(SAMPLE);
    const { rows, formatLabel } = mapCsvToDrafts(csv, "ledger_live");
    expect(formatLabel).toMatch(/Ledger/i);
    expect(rows.length).toBe(6);

    const inn = rows.find((r) => r.raw["Operation Type"] === "IN");
    expect(inn).toBeTruthy();
    expect(inn!.type).toBe("REWARD"); // réception crypto
    expect(inn!.ticker).toBe("DOGE");
    expect(Number(inn!.quantity)).toBeCloseTo(2886.49);
    expect(inn!.currency).toBe("USD");
    expect(inn!.selected).toBe(true);
    expect(inn!.status).toBe("ok"); // conversions silencieuses
    expect(inn!.platformName).toMatch(/Ledger/i);
    expect(inn!.assetClass).toBe("CRYPTO");

    const out = rows.find(
      (r) => r.raw["Operation Type"] === "OUT" && r.status !== "error"
    );
    expect(out!.type).toBe("VENTE");
    expect(Number(out!.quantity)).toBeCloseTo(13.44786052, 5);
    expect(Number(out!.unitPrice)).toBeGreaterThan(0);
    expect(out!.status).toBe("ok");

    const fees = rows.find((r) => r.raw["Operation Type"] === "FEES");
    expect(fees!.type).toBe("VENTE");
    expect(fees!.selected).toBe(true);
    expect(fees!.status).toBe("ok");

    const failed = rows.find((r) => r.raw["Status"] === "Failed");
    // Failed = désélectionné en warning (pas error bloquant l’analyse globale)
    expect(failed!.status).toBe("warning");
    expect(failed!.selected).toBe(false);

    const reward = rows.find((r) => r.raw["Operation Type"] === "REWARD");
    expect(reward!.type).toBe("REWARD");
    expect(reward!.ticker).toBe("ATOM");
    expect(reward!.status).toBe("ok");

    const del = rows.find((r) => r.raw["Operation Type"] === "DELEGATE");
    expect(del!.type).toBe("TRANSFERT_TITRE");
    expect(del!.selected).toBe(false);
  });

  it("ignore proprement les qty 0 sans cascade « Montant cash requis »", () => {
    const csv = parseCsv(`${LEDGER_HEADERS}
2026-07-11T21:24:05.000Z,Confirmed,ETH,IN,0,0.000000432,hashz,Arbitrum,0xabc,USD,,
`);
    const { rows } = mapCsvToDrafts(csv, "ledger_live");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.selected).toBe(false);
    expect(rows[0]!.status).toBe("warning");
    expect(rows[0]!.warnings.join(" ")).toMatch(/Sans mouvement de quantité/i);
    expect(rows[0]!.errors.join(" ")).not.toMatch(/Montant cash/i);
  });
});
