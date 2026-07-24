import { describe, it, expect } from "vitest";
import { formatDateTimeParis } from "@/app/lib/money/format";

describe("formatDateTimeParis", () => {
  it("formats a UTC winter date as DD/MM/YYYY HH:MM:SS in Paris time", () => {
    // 2026-01-15T09:30:00Z → Paris (UTC+1 in winter) → 10:30:00
    const result = formatDateTimeParis("2026-01-15T09:30:00Z");
    expect(result).toBe("15/01/2026 10:30:00");
  });

  it("formats a UTC summer date accounting for DST (UTC+2)", () => {
    // 2026-07-11T21:13:00Z → Paris (UTC+2 in summer) → 23:13:00
    const result = formatDateTimeParis("2026-07-11T21:13:00Z");
    expect(result).toBe("11/07/2026 23:13:00");
  });

  it("pads single-digit day/month/hour/minute/second with leading zeros", () => {
    // 2026-03-05T01:02:03Z → Paris (UTC+1 in winter) → 02:02:03
    const result = formatDateTimeParis("2026-03-05T01:02:03Z");
    expect(result).toBe("05/03/2026 02:02:03");
  });
});
