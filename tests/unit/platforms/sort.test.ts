import { describe, expect, it } from "vitest";
import {
  comparePlatforms,
  parsePlatformSortMode,
  type SortablePlatform,
} from "@/app/lib/platforms/sort";

function p(overrides: Partial<SortablePlatform> & { name: string }): SortablePlatform {
  return { type: "AUTRE", ...overrides };
}

describe("parsePlatformSortMode", () => {
  it("reconnaît les modes valides, retombe sur value sinon", () => {
    expect(parsePlatformSortMode("name")).toBe("name");
    expect(parsePlatformSortMode("activity")).toBe("activity");
    expect(parsePlatformSortMode("positions")).toBe("positions");
    expect(parsePlatformSortMode("type")).toBe("type");
    expect(parsePlatformSortMode("value")).toBe("value");
    expect(parsePlatformSortMode("bogus")).toBe("value");
    expect(parsePlatformSortMode(undefined)).toBe("value");
  });
});

describe("comparePlatforms", () => {
  const list: SortablePlatform[] = [
    p({ name: "Zurich Bank", type: "BANQUE", positionCount: 2, lastTransactionAt: "2026-01-01T00:00:00Z", totalValueBase: "500" }),
    p({ name: "Alpha Exchange", type: "EXCHANGE_CRYPTO", positionCount: 5, lastTransactionAt: "2026-06-01T00:00:00Z", totalValueBase: "9000" }),
    p({ name: "Beta Courtier", type: "COURTIER", positionCount: 0, lastTransactionAt: null, totalValueBase: "100" }),
  ];

  it("value : décroissant par valeur totale", () => {
    const sorted = [...list].sort((a, b) => comparePlatforms(a, b, "value"));
    expect(sorted.map((x) => x.name)).toEqual([
      "Alpha Exchange",
      "Zurich Bank",
      "Beta Courtier",
    ]);
  });

  it("name : alphabétique", () => {
    const sorted = [...list].sort((a, b) => comparePlatforms(a, b, "name"));
    expect(sorted.map((x) => x.name)).toEqual([
      "Alpha Exchange",
      "Beta Courtier",
      "Zurich Bank",
    ]);
  });

  it("activity : dernière transaction la plus récente d'abord, jamais transigé en dernier", () => {
    const sorted = [...list].sort((a, b) => comparePlatforms(a, b, "activity"));
    expect(sorted.map((x) => x.name)).toEqual([
      "Alpha Exchange",
      "Zurich Bank",
      "Beta Courtier",
    ]);
  });

  it("positions : le plus de positions ouvertes d'abord", () => {
    const sorted = [...list].sort((a, b) => comparePlatforms(a, b, "positions"));
    expect(sorted.map((x) => x.name)).toEqual([
      "Alpha Exchange",
      "Zurich Bank",
      "Beta Courtier",
    ]);
  });

  it("type : alphabétique par code type, puis par nom", () => {
    const sorted = [...list].sort((a, b) => comparePlatforms(a, b, "type"));
    expect(sorted.map((x) => x.name)).toEqual([
      "Zurich Bank", // BANQUE
      "Beta Courtier", // COURTIER
      "Alpha Exchange", // EXCHANGE_CRYPTO
    ]);
  });

  it("mode inconnu → comportement par défaut (value)", () => {
    const sorted = [...list].sort((a, b) =>
      comparePlatforms(a, b, "bogus" as never)
    );
    expect(sorted[0]!.name).toBe("Alpha Exchange");
  });
});
