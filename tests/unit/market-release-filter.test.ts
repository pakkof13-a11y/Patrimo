import { describe, expect, it } from "vitest";
import type { EarningsEvent, MacroEvent } from "@/app/lib/news/service";
import {
  compareActualToConsensus,
  isEarningsEventPublished,
  isMacroEventPublished,
  marketEventStatus,
  parseMacroNumber,
} from "@/app/lib/news/service";
import {
  countryCodeFromTicker,
  isCryptoEarningsTicker,
} from "@/app/lib/news/earnings-live";
import { ffRowToMacro } from "@/app/lib/news/macro-live";
import {
  filterEarningsByRelease,
  filterMacroByRelease,
} from "@/app/lib/news/release-filter";

const NOW = new Date("2026-07-16T14:00:00.000Z");

function macro(
  partial: Partial<MacroEvent> & Pick<MacroEvent, "id" | "time">
): MacroEvent {
  return {
    country: "US",
    countryCode: "us",
    title: "Test macro",
    impact: "medium",
    actual: null,
    forecast: "0,2 %",
    previous: "0,1 %",
    ...partial,
  };
}

function earn(
  partial: Partial<EarningsEvent> & Pick<EarningsEvent, "id" | "time">
): EarningsEvent {
  return {
    companyName: "Test Co",
    ticker: "TST",
    timing: "amc",
    epsEstimate: "1,00",
    epsActual: null,
    inPortfolio: false,
    ...partial,
  };
}

describe("marketEventStatus", () => {
  const NOW_MS = NOW.getTime();
  it("published once the absolute time has passed", () => {
    expect(marketEventStatus("2026-07-16T13:59:00.000Z", NOW_MS)).toBe(
      "published"
    );
    expect(marketEventStatus("2026-07-16T14:01:00.000Z", NOW_MS)).toBe(
      "upcoming"
    );
  });
  it("published exactly at the event time", () => {
    expect(marketEventStatus("2026-07-16T14:00:00.000Z", NOW_MS)).toBe(
      "published"
    );
  });
  it("invalid date → upcoming", () => {
    expect(marketEventStatus("not-a-date", NOW_MS)).toBe("upcoming");
  });
});

describe("isMacroEventPublished", () => {
  it("false without actual even if scheduled time has passed", () => {
    const e = macro({
      id: "m1",
      time: "2026-07-16T10:00:00.000Z",
      actual: null,
      forecast: "1 %",
    });
    expect(isMacroEventPublished(e, NOW)).toBe(false);
  });

  it("true as soon as actual is present", () => {
    const e = macro({
      id: "m2",
      time: "2026-07-16T10:00:00.000Z",
      actual: "0,3 %",
    });
    expect(isMacroEventPublished(e, NOW)).toBe(true);
  });

  it("speech without numbers becomes published 15 min after schedule", () => {
    const past = macro({
      id: "m3",
      time: "2026-07-16T13:00:00.000Z",
      forecast: null,
      previous: null,
      actual: null,
    });
    const future = macro({
      id: "m4",
      time: "2026-07-16T14:10:00.000Z",
      forecast: null,
      previous: null,
      actual: null,
    });
    expect(isMacroEventPublished(past, NOW)).toBe(true);
    expect(isMacroEventPublished(future, NOW)).toBe(false);
  });
});

describe("compareActualToConsensus", () => {
  it("colore selon écart résultat / consensus", () => {
    expect(compareActualToConsensus("2,1 %", "2,0 %")).toBe("above");
    expect(compareActualToConsensus("1,8 %", "2,0 %")).toBe("below");
    expect(compareActualToConsensus("2,0 %", "2,0 %")).toBe("equal");
    expect(compareActualToConsensus(null, "2,0 %")).toBe("na");
  });

  it("parseMacroNumber gère k et %", () => {
    expect(parseMacroNumber("215 k")).toBe(215_000);
    expect(parseMacroNumber("0,3 %")).toBeCloseTo(0.3);
  });
});

describe("isCryptoEarningsTicker", () => {
  it("exclut BTC/ETH/SOL et laisse AAPL/MC.PA", () => {
    expect(isCryptoEarningsTicker("BTC")).toBe(true);
    expect(isCryptoEarningsTicker("SOL")).toBe(true);
    expect(isCryptoEarningsTicker("USDC")).toBe(true);
    expect(isCryptoEarningsTicker("AAPL")).toBe(false);
    expect(isCryptoEarningsTicker("MC.PA")).toBe(false);
  });
});

describe("countryCodeFromTicker", () => {
  it("mappe les suffixes bourse vers ISO", () => {
    expect(countryCodeFromTicker("MC.PA")).toBe("fr");
    expect(countryCodeFromTicker("ASML.AS")).toBe("nl");
    expect(countryCodeFromTicker("SAP.DE")).toBe("de");
    expect(countryCodeFromTicker("AAPL")).toBe("us");
  });
});

describe("ffRowToMacro", () => {
  it("mappe une ligne calendrier FF", () => {
    const e = ffRowToMacro(
      {
        title: "CPI m/m",
        country: "USD",
        date: "2026-07-20T08:30:00-04:00",
        impact: "High",
        forecast: "0.2%",
        previous: "0.1%",
        actual: "0.3%",
      },
      0
    );
    expect(e).not.toBeNull();
    expect(e!.country).toBe("US");
    expect(e!.countryCode).toBe("us");
    expect(e!.impact).toBe("high");
    expect(e!.actual).toBe("0.3%");
  });
});

describe("isEarningsEventPublished", () => {
  it("depends on epsActual only", () => {
    expect(
      isEarningsEventPublished(
        earn({ id: "e1", time: "2026-07-16T10:00:00.000Z", epsActual: null })
      )
    ).toBe(false);
    expect(
      isEarningsEventPublished(
        earn({
          id: "e2",
          time: "2026-07-16T10:00:00.000Z",
          epsActual: "1,20",
        })
      )
    ).toBe(true);
  });
});

describe("transition À venir → Publiées (macro)", () => {
  it("moves event out of upcoming when actual arrives", () => {
    const base = macro({
      id: "ipc",
      time: "2026-07-16T12:00:00.000Z",
      title: "IPC",
      actual: null,
      forecast: "2,0 %",
    });

    const upcomingBefore = filterMacroByRelease([base], "upcoming", NOW);
    const publishedBefore = filterMacroByRelease([base], "published", NOW);
    expect(upcomingBefore.map((e) => e.id)).toEqual(["ipc"]);
    expect(publishedBefore).toHaveLength(0);

    const after: MacroEvent = { ...base, actual: "2,1 %" };
    const upcomingAfter = filterMacroByRelease([after], "upcoming", NOW);
    const publishedAfter = filterMacroByRelease([after], "published", NOW);
    expect(upcomingAfter).toHaveLength(0);
    expect(publishedAfter.map((e) => e.id)).toEqual(["ipc"]);
  });

  it("does not list published events older than 24h", () => {
    const old = macro({
      id: "old",
      time: "2026-07-14T12:00:00.000Z",
      actual: "1 %",
    });
    expect(filterMacroByRelease([old], "published", NOW)).toHaveLength(0);
    expect(filterMacroByRelease([old], "upcoming", NOW)).toHaveLength(0);
  });

  it("keeps future unreleased events in upcoming only", () => {
    const future = macro({
      id: "fut",
      time: "2026-07-20T08:00:00.000Z",
      actual: null,
    });
    expect(filterMacroByRelease([future], "upcoming", NOW).map((e) => e.id)).toEqual(
      ["fut"]
    );
    expect(filterMacroByRelease([future], "published", NOW)).toHaveLength(0);
  });
});

describe("transition À venir → Publiées (earnings)", () => {
  it("moves ticker when epsActual becomes available", () => {
    const base = earn({
      id: "aapl",
      time: "2026-07-16T12:30:00.000Z",
      ticker: "AAPL",
      epsActual: null,
    });
    expect(filterEarningsByRelease([base], "upcoming", NOW).map((e) => e.id)).toEqual(
      ["aapl"]
    );
    expect(filterEarningsByRelease([base], "published", NOW)).toHaveLength(0);

    const after = { ...base, epsActual: "1,89" };
    expect(filterEarningsByRelease([after], "upcoming", NOW)).toHaveLength(0);
    expect(
      filterEarningsByRelease([after], "published", NOW).map((e) => e.id)
    ).toEqual(["aapl"]);
  });

  it("ignores published results older than 24h", () => {
    const old = earn({
      id: "old",
      time: "2026-07-10T12:00:00.000Z",
      epsActual: "0,50",
    });
    expect(filterEarningsByRelease([old], "published", NOW)).toHaveLength(0);
  });
});
