import { describe, expect, it } from "vitest";
import {
  platformHintForFormat,
  resolvePlatformOptionForFormat,
} from "@/app/lib/import/format-platform";

describe("format → plateforme par défaut", () => {
  it("mappe Interactive Brokers", () => {
    const h = platformHintForFormat("interactive_brokers");
    expect(h?.logoKey).toBe("INTERACTIVE_BROKERS");
    expect(h?.name).toMatch(/Interactive Brokers/i);
  });

  it("ne force pas de plateforme pour patrimo / auto / generic", () => {
    expect(platformHintForFormat("patrimo")).toBeNull();
    expect(platformHintForFormat("auto")).toBeNull();
    expect(platformHintForFormat("generic")).toBeNull();
    expect(platformHintForFormat(null)).toBeNull();
  });

  it("préfère une plateforme utilisateur existante", () => {
    const opt = resolvePlatformOptionForFormat("interactive_brokers", [
      {
        value: "user-1",
        label: "Interactive Brokers",
        isCatalog: false,
        preset: { key: "INTERACTIVE_BROKERS", name: "Interactive Brokers" },
      },
      {
        value: "catalog:INTERACTIVE_BROKERS",
        label: "Interactive Brokers",
        isCatalog: true,
        preset: { key: "INTERACTIVE_BROKERS" },
      },
    ]);
    expect(opt?.value).toBe("user-1");
    expect(opt?.isCatalog).toBeFalsy();
  });

  it("retombe sur le catalogue si absente du portefeuille", () => {
    const opt = resolvePlatformOptionForFormat("coinbase", [
      {
        value: "catalog:COINBASE",
        label: "Coinbase",
        isCatalog: true,
        preset: { key: "COINBASE", name: "Coinbase" },
      },
    ]);
    expect(opt?.isCatalog).toBe(true);
    expect(opt?.label).toMatch(/Coinbase/i);
  });
});
