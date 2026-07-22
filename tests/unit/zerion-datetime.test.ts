import { describe, expect, it } from "vitest";
import { formatParisDateTime } from "@/app/lib/zerion/datetime";
import {
  getZerionChain,
  isZerionPreset,
  ZERION_HELP_MESSAGE,
  DEFAULT_ZERION_API_KEY,
} from "@/app/lib/zerion/chains";

describe("zerion datetime Europe/Paris", () => {
  it("formate DD-MM-YYYY HH:mm:ss", () => {
    // 2024-06-15 12:00:00 UTC → 14:00 Paris (CEST)
    expect(formatParisDateTime(1_718_452_800)).toBe("15-06-2024 14:00:00");
  });

  it("accepte ISO Zerion mined_at", () => {
    expect(formatParisDateTime("2024-01-15T10:30:00.000Z")).toBe(
      "15-01-2024 11:30:00"
    );
  });
});

describe("zerion chains", () => {
  it("mappe presets EVM", () => {
    expect(getZerionChain("ETHEREUM")?.zerionChainId).toBe("ethereum");
    expect(getZerionChain("POLYGON")?.zerionChainId).toBe("polygon");
    expect(getZerionChain("BSC")?.zerionChainId).toBe("binance-smart-chain");
    expect(getZerionChain("ARBITRUM")?.zerionChainId).toBe("arbitrum");
  });

  it("exclut Solana et Monero", () => {
    expect(isZerionPreset("SOLANA")).toBe(false);
    expect(isZerionPreset("MONERO")).toBe(false);
    expect(isZerionPreset("ETHEREUM")).toBe(true);
  });

  it("clé et message d’aide", () => {
    // Placeholder UI uniquement — jamais de clé réelle dans le bundle client
    // (voir commit "remove client Zerion key leak"). La clé effective vient
    // de ZERION_API_KEY côté serveur.
    expect(DEFAULT_ZERION_API_KEY).toBe("");
    expect(ZERION_HELP_MESSAGE).toContain("Zerion");
    expect(ZERION_HELP_MESSAGE).toContain("dashboard.zerion.io");
  });
});
