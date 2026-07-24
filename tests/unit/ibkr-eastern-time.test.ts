import { describe, it, expect } from "vitest";
import {
  parseEasternDateTimeToUtc,
  parseIbkrEasternDateTime,
} from "@/app/lib/import/normalize";
import { expandIbkrActivityStatement } from "@/app/lib/import/ibkr-activity";

describe("IBKR Eastern Time → UTC conversion", () => {
  it("converts an EDT (summer, UTC-4) trade timestamp to UTC", () => {
    // Sample: Trades,Data,Order,Stocks,USD,ADBE,"2025-10-20, 09:30:04",...
    // Oct 20 2025 is EDT (DST still active until Nov 2) → UTC-4
    const utc = parseIbkrEasternDateTime("2025-10-20, 09:30:04");
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2025-10-20T13:30:04.000Z");
  });

  it("converts an EST (winter, UTC-5) timestamp to UTC", () => {
    // Jan 15 is standard time (EST) → UTC-5
    const utc = parseEasternDateTimeToUtc(2026, 1, 15, 9, 30, 0);
    expect(utc).not.toBeNull();
    expect(utc!.toISOString()).toBe("2026-01-15T14:30:00.000Z");
  });

  it("tags multi-account trades with the correct AccountId and converts dates to UTC", () => {
    const multiAccount = `Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Account Information,Header,Field Name,Field Value
Account Information,Data,Account,U18285124
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,USD,ADBE,"2025-10-20, 09:30:04",0.5,334.65,343.4,-167.325,-0.35036825,167.67536825,0,4.375,O
Statement,Header,Field Name,Field Value
Statement,Data,BrokerName,Interactive Brokers Ireland Limited
Account Information,Header,Field Name,Field Value
Account Information,Data,Account,U20453710
Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price,C. Price,Proceeds,Comm/Fee,Basis,Realized P/L,MTM P/L,Code
Trades,Data,Order,Stocks,EUR,OVH,"2025-10-21, 03:17:30",15,9.265,8.92,-138.975,-0.694875,139.669875,0,-5.175,O
`;
    const exp = expandIbkrActivityStatement(multiAccount);
    expect(exp.matched).toBe(true);
    expect(exp.accounts).toEqual(["U18285124", "U20453710"]);
    expect(exp.tradeCount).toBe(2);

    const adbe = exp.csv.rows.find((r) => r.Symbol === "ADBE");
    expect(adbe?.Notes).toContain("U18285124");
    expect(adbe?.TradeDate).toBe("2025-10-20T13:30:04.000Z");

    const ovh = exp.csv.rows.find((r) => r.Symbol === "OVH");
    expect(ovh?.Notes).toContain("U20453710");

    // Filter to a single account
    const filtered = expandIbkrActivityStatement(multiAccount, {
      accountIds: ["U18285124"],
    });
    expect(filtered.tradeCount).toBe(1);
    expect(filtered.csv.rows[0]?.Symbol).toBe("ADBE");
  });
});
