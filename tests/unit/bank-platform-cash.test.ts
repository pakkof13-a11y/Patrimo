import { describe, expect, it } from "vitest";
import { normalizePlatformSearch } from "@/app/lib/platforms/presets";

describe("bank → platform cash matching", () => {
  it("normalizes bank names to match platform names", () => {
    expect(normalizePlatformSearch("Revolut")).toBe(
      normalizePlatformSearch("revolut")
    );
    expect(normalizePlatformSearch("Crédit Agricole")).toBe(
      normalizePlatformSearch("Credit Agricole")
    );
    expect(normalizePlatformSearch("  BoursoBank ")).toBe(
      normalizePlatformSearch("boursobank")
    );
  });

  it("does not falsely match different banks", () => {
    expect(normalizePlatformSearch("Revolut")).not.toBe(
      normalizePlatformSearch("N26")
    );
  });
});
