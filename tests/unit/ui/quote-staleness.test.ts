import { describe, expect, it } from "vitest";
import {
  QUOTE_STALE_AFTER_MS,
  QUOTE_STALE_BADGE_LABEL,
  quoteStaleBadgeLabel,
  quoteStaleness,
} from "@/app/lib/ui/quote-staleness";

describe("quoteStaleness — D11 badge sous le hero", () => {
  const now = new Date("2026-09-05T21:00:00.000Z");

  it("sans fetchedAt : pas de badge inventé", () => {
    expect(quoteStaleBadgeLabel(undefined, now)).toBeNull();
    expect(quoteStaleBadgeLabel(null, now)).toBeNull();
    expect(quoteStaleBadgeLabel("", now)).toBeNull();
    expect(quoteStaleness(undefined, now)).toEqual({
      stale: false,
      fetchedAt: null,
      ageMs: null,
    });
  });

  it("cours de moins de 24 h : pas de badge", () => {
    expect(
      quoteStaleBadgeLabel("2026-09-05T08:00:00.000Z", now)
    ).toBeNull();
    expect(
      quoteStaleness("2026-09-04T21:00:01.000Z", now).stale
    ).toBe(false);
  });

  it("cours de plus de 24 h : badge", () => {
    expect(quoteStaleBadgeLabel("2026-09-04T20:59:59.000Z", now)).toBe(
      QUOTE_STALE_BADGE_LABEL
    );
    const late = quoteStaleness("2026-09-03T21:00:00.000Z", now);
    expect(late.stale).toBe(true);
    expect(late.ageMs).toBe(2 * QUOTE_STALE_AFTER_MS);
  });

  it("une date illisible ne fabrique pas un retard", () => {
    expect(quoteStaleBadgeLabel("pas-une-date", now)).toBeNull();
  });
});
