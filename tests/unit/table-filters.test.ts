import { describe, expect, it } from "vitest";
import { matchesSearchQuery } from "@/components/ui/table-filters";
import { parseHistoryRange } from "@/app/lib/market/price-history-types";

describe("matchesSearchQuery", () => {
  it("matches name ticker isin case-insensitively", () => {
    expect(matchesSearchQuery("lvmh", ["LVMH", "MC.PA", "FR0000121014"])).toBe(true);
    expect(matchesSearchQuery("mc.pa", ["LVMH", "MC.PA", null])).toBe(true);
    expect(matchesSearchQuery("FR0000121014", ["LVMH", "MC.PA", "FR0000121014"])).toBe(
      true
    );
    expect(matchesSearchQuery("bitcoin", ["Apple", "AAPL", null])).toBe(false);
  });

  it("empty query matches all", () => {
    expect(matchesSearchQuery("", ["x"])).toBe(true);
    expect(matchesSearchQuery("   ", [])).toBe(true);
  });
});

describe("parseHistoryRange", () => {
  it("parses known ranges and defaults", () => {
    expect(parseHistoryRange("7d")).toBe("7d");
    expect(parseHistoryRange("YTD")).toBe("ytd");
    expect(parseHistoryRange("5y")).toBe("5y");
    expect(parseHistoryRange("nope")).toBe("1m");
    expect(parseHistoryRange(null)).toBe("1m");
  });
});
