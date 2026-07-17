import { describe, expect, it } from "vitest";
import {
  formatPageLabel,
  formatRangeLabel,
  shouldShowPaginationNav,
} from "@/app/lib/ui/pagination";

describe("formatPageLabel", () => {
  it("never returns Page 0 / 0", () => {
    expect(formatPageLabel(0, 0, 0)).toBe("—");
    expect(formatPageLabel(0, 1, 0)).toBe("—");
  });

  it("formats 1-based page with valid totals", () => {
    expect(formatPageLabel(0, 5, 100)).toBe("Page 1 / 5");
    expect(formatPageLabel(2, 5, 100)).toBe("Page 3 / 5");
  });

  it("clamps current page to pageCount", () => {
    expect(formatPageLabel(99, 3, 50)).toBe("Page 3 / 3");
  });
});

describe("formatRangeLabel", () => {
  it("shows human empty label", () => {
    expect(formatRangeLabel(0, 20, 0)).toBe("Aucune ligne");
    expect(formatRangeLabel(0, 20, 0, "Vide")).toBe("Vide");
  });

  it("shows inclusive range", () => {
    expect(formatRangeLabel(0, 20, 45)).toBe("1–20 sur 45");
    expect(formatRangeLabel(2, 20, 45)).toBe("41–45 sur 45");
  });
});

describe("shouldShowPaginationNav", () => {
  it("is false only when empty", () => {
    expect(shouldShowPaginationNav(0)).toBe(false);
    expect(shouldShowPaginationNav(1)).toBe(true);
  });
});
