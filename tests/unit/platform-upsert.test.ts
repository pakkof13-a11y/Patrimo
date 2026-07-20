import { describe, expect, it } from "vitest";
import { sortPlatformsByRecentUsage } from "@/app/lib/platforms/recent";
import {
  buildPlatformPickOptions,
  filterPlatformPickOptions,
  isCatalogValue,
} from "@/app/lib/platforms/catalog-options";
import {
  findPreset,
  filterPresets,
  matchesPlatformLabelPrefix,
  PLATFORM_PRESETS,
} from "@/app/lib/platforms/presets";

describe("sortPlatformsByRecentUsage", () => {
  it("met les ids récents en tête, puis tri alpha", () => {
    const opts = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bravo" },
      { value: "c", label: "Charlie" },
    ];
    const sorted = sortPlatformsByRecentUsage(opts, ["c", "a"]);
    expect(sorted.map((o) => o.value)).toEqual(["c", "a", "b"]);
  });

  it("tri alpha si aucun usage récent", () => {
    const opts = [
      { value: "2", label: "Zulu" },
      { value: "1", label: "Alpha" },
    ];
    const sorted = sortPlatformsByRecentUsage(opts, []);
    expect(sorted.map((o) => o.label)).toEqual(["Alpha", "Zulu"]);
  });
});

describe("catalogue courtiers", () => {
  it("findPreset résout les alias FR (Boursorama, IBKR)", () => {
    expect(findPreset("Boursorama")?.key).toBe("BOURSOBANK");
    expect(findPreset("ibkr")?.key).toBe("INTERACTIVE_BROKERS");
    expect(findPreset("Binance")?.key).toBe("BINANCE");
    expect(findPreset("Boursorama")?.logoUrl).toMatch(/^https?:\/\//);
    expect(findPreset("Boursorama")?.types).toContain("COURTIER");
    expect(findPreset("Boursorama")?.types).toContain("BANQUE");
  });

  it("filterPresets / matching prefix strict", () => {
    expect(matchesPlatformLabelPrefix("Revolut", "R")).toBe(true);
    expect(matchesPlatformLabelPrefix("Revolut", "Rev")).toBe(true);
    expect(matchesPlatformLabelPrefix("Revolut", "volut")).toBe(false);
    expect(matchesPlatformLabelPrefix("Trade Republic", "Trade")).toBe(true);
    expect(matchesPlatformLabelPrefix("Trade Republic", "Rep")).toBe(true);

    const hits = filterPresets("Trade");
    expect(hits.some((p) => p.key === "TRADE_REPUBLIC")).toBe(true);
    expect(filterPresets("volut").some((p) => p.key === "REVOLUT")).toBe(
      false
    );
  });

  it("pas de doublons marque inutiles + crypto enrichies", () => {
    const keys = PLATFORM_PRESETS.map((p) => p.key);
    expect(keys).not.toContain("BNP_PARIBAS_BOURSE");
    expect(keys).not.toContain("CREDIT_AGRICOLE_BOURSE");
    expect(keys).not.toContain("CFD_ETORO");
    expect(keys).not.toContain("AV_BNP");
    expect(keys.filter((k) => k === "ETORO")).toHaveLength(1);
    expect(PLATFORM_PRESETS.some((p) => p.key === "MERIA")).toBe(true);
    expect(PLATFORM_PRESETS.some((p) => p.key === "COINHOUSE")).toBe(true);
    expect(PLATFORM_PRESETS.some((p) => p.key === "NEXO")).toBe(true);
    // Enrichissement CEX / DEX / CeDeFi (réf. import)
    for (const k of [
      "MEXC",
      "BINGX",
      "DYDX",
      "GMX",
      "YOUHODLER",
      "FINBLOX",
      "JUPITER_PERPS",
      "ASTER_DEX",
    ]) {
      expect(PLATFORM_PRESETS.some((p) => p.key === k)).toBe(true);
    }
    expect(
      PLATFORM_PRESETS.filter((p) => p.key === "BINANCE").length
    ).toBe(1);
    expect(PLATFORM_PRESETS.find((p) => p.key === "DYDX")?.category).toBe(
      "DEX crypto"
    );
    expect(PLATFORM_PRESETS.find((p) => p.key === "NEXO")?.category).toBe(
      "CeDeFi"
    );
    const names = PLATFORM_PRESETS.map((p) => p.name.toLowerCase());
    expect(names.filter((n) => n === "etoro")).toHaveLength(1);
    expect(names.filter((n) => n === "bnp paribas")).toHaveLength(1);
  });

  it("buildPlatformPickOptions fusionne user + catalogue sans CATALOGUE", () => {
    const opts = buildPlatformPickOptions({
      platforms: [
        {
          id: "cuid1",
          name: "Mon PEA",
          type: "COURTIER",
          logoUrl: null,
        },
      ],
      includeCatalog: true,
    });
    expect(opts[0].value).toBe("cuid1");
    expect(opts[0].isCatalog).toBe(false);
    const binance = opts.find((o) => o.label === "Binance");
    expect(binance?.isCatalog).toBe(true);
    expect(binance && isCatalogValue(binance.value)).toBe(true);
    expect(binance?.logoUrl).toBeTruthy();
    expect(binance?.categoryLabel).toMatch(/crypto|exchange/i);
    expect(binance?.subtitle).not.toMatch(/catalogue/i);
    const filtered = filterPlatformPickOptions(opts, "Bin");
    expect(filtered.every((o) => o.label.toLowerCase().startsWith("bin"))).toBe(
      true
    );
  });

  it("n’ajoute pas au catalogue un preset déjà possédé", () => {
    const opts = buildPlatformPickOptions({
      platforms: [
        {
          id: "cuid1",
          name: "Binance",
          type: "EXCHANGE_CRYPTO",
          logoKey: "BINANCE",
          logoUrl: "https://example.com/b.png",
        },
      ],
    });
    expect(opts.filter((o) => o.label === "Binance")).toHaveLength(1);
    expect(opts.find((o) => o.label === "Binance")?.isCatalog).toBe(false);
  });
});

describe("platform name normalization (import)", () => {
  it("map-rows expose platformName depuis le mapping", async () => {
    const { mapCsvToDrafts } = await import("@/app/lib/import/map-rows");
    const { parseCsv } = await import("@/app/lib/import/csv-parse");
    const text = [
      "date;type;ticker;quantity;unit_price;platform",
      "2024-01-15;ACHAT;AAPL;1;100;Boursorama",
      "2024-01-16;ACHAT;BTC;0.1;40000;Binance",
    ].join("\n");
    const csv = parseCsv(text);
    const { rows } = mapCsvToDrafts(csv, "patrimo");
    expect(rows).toHaveLength(2);
    expect(rows[0].platformName).toBe("Boursorama");
    expect(rows[1].platformName).toBe("Binance");
  });
});
