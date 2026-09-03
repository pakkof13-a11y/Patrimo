import { describe, expect, it } from "vitest";
import {
  PLATFORM_PRESETS,
  findPreset,
  type PlatformPresetType,
} from "@/app/lib/platforms/presets";
import { IMPORT_FORMATS } from "@/app/lib/import/presets";
import {
  formatsForPlatform,
  hasDedicatedFormat,
  platformHintForFormat,
} from "@/app/lib/import/format-platform";

/**
 * Catalogue des plateformes et formats d'import.
 *
 * Ce que ces tests protègent avant tout : la distinction entre « on peut y
 * détenir des actifs » (le catalogue) et « on sait lire son export » (les
 * formats). Les confondre ferait promettre à l'écran d'import des capacités
 * qui n'existent pas.
 */

const byKey = (key: string) => PLATFORM_PRESETS.find((p) => p.key === key);

describe("plateformes ajoutées", () => {
  const attendus: Array<[string, string, PlatformPresetType[]]> = [
    ["AVANZA", "Avanza", ["COURTIER"]],
    ["BUX", "BUX", ["COURTIER", "BROKER_CFD"]],
    ["DIRECTA", "Directa", ["COURTIER"]],
    ["DISNAT", "Disnat", ["COURTIER"]],
    ["FREETRADE", "Freetrade", ["COURTIER"]],
    ["INVESTENGINE", "InvestEngine", ["COURTIER"]],
    ["SCHWAB", "Charles Schwab", ["COURTIER"]],
    ["RABOBANK", "Rabobank", ["BANQUE"]],
    ["RELAI", "Relai", ["EXCHANGE_CRYPTO"]],
    ["FINPENSION", "Finpension", ["AUTRE"]],
  ];

  for (const [key, name, types] of attendus) {
    it(`${name} existe avec le type attendu`, () => {
      const preset = byKey(key);
      expect(preset, `${key} absent du catalogue`).toBeDefined();
      expect(preset!.name).toBe(name);
      expect(preset!.types).toEqual(types);
    });
  }

  it("aucune clé du catalogue n'est dupliquée", () => {
    const cles = PLATFORM_PRESETS.map((p) => p.key);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("aucun nom du catalogue n'est dupliqué", () => {
    const noms = PLATFORM_PRESETS.map((p) => p.name.toLowerCase());
    expect(new Set(noms).size).toBe(noms.length);
  });
});

describe("alias de résolution", () => {
  const alias: Array<[string, string]> = [
    ["avanza", "AVANZA"],
    ["bux", "BUX"],
    ["directa", "DIRECTA"],
    ["disnat", "DISNAT"],
    ["freetrade", "FREETRADE"],
    ["investengine", "INVESTENGINE"],
    ["schwab", "SCHWAB"],
    ["charles schwab", "SCHWAB"],
    ["rabobank", "RABOBANK"],
    ["relai", "RELAI"],
    ["finpension", "FINPENSION"],
  ];

  for (const [saisie, key] of alias) {
    it(`« ${saisie} » résout vers ${key}`, () => {
      expect(findPreset(saisie)?.key).toBe(key);
    });
  }

  it("les alias historiques restent en place", () => {
    expect(findPreset("ibkr")?.key).toBe("INTERACTIVE_BROKERS");
    expect(findPreset("saxo")?.key).toBe("SAXO_BANK");
    expect(findPreset("trading212")?.key).toBe("TRADING_212");
  });
});

describe("courtiers anglo-saxons (addendum)", () => {
  const attendus: Array<[string, string]> = [
    ["ROBINHOOD", "Robinhood"],
    ["FIDELITY", "Fidelity"],
    ["VANGUARD", "Vanguard"],
    ["ETRADE", "E*TRADE"],
    ["MERRILL_EDGE", "Merrill Edge"],
    ["HARGREAVES_LANSDOWN", "Hargreaves Lansdown"],
    ["AJ_BELL", "AJ Bell"],
    ["INTERACTIVE_INVESTOR", "Interactive Investor"],
  ];

  for (const [key, name] of attendus) {
    it(`${name} existe et est un courtier`, () => {
      const preset = byKey(key);
      expect(preset, `${key} absent`).toBeDefined();
      expect(preset!.name).toBe(name);
      expect(preset!.types).toEqual(["COURTIER"]);
    });
  }

  it("Interactive Investor n'est pas confondu avec Interactive Brokers", () => {
    // Deux marques distinctes dont les noms se ressemblent : la résolution
    // doit trancher, pas approcher.
    expect(findPreset("interactive investor")?.key).toBe("INTERACTIVE_INVESTOR");
    expect(findPreset("interactive brokers")?.key).toBe("INTERACTIVE_BROKERS");
    expect(findPreset("ibkr")?.key).toBe("INTERACTIVE_BROKERS");
  });

  it("les alias usuels résolvent", () => {
    expect(findPreset("robinhood")?.key).toBe("ROBINHOOD");
    expect(findPreset("e*trade")?.key).toBe("ETRADE");
    expect(findPreset("hargreaves")?.key).toBe("HARGREAVES_LANSDOWN");
    expect(findPreset("aj bell")?.key).toBe("AJ_BELL");
    expect(findPreset("merrill")?.key).toBe("MERRILL_EDGE");
  });
});

describe("acteurs déjà au catalogue — aucun doublon créé", () => {
  /*
    L'addendum listait beaucoup de noms déjà présents. Ce test fige le fait
    qu'ils n'ont qu'une entrée : un second « Kraken » sous une autre clé serait
    invisible à la lecture et créerait deux plateformes pour un même compte.
  */
  const dejaPresents: Array<[string, string, PlatformPresetType[]]> = [
    ["KRAKEN", "Kraken", ["EXCHANGE_CRYPTO"]],
    ["GEMINI", "Gemini", ["EXCHANGE_CRYPTO"]],
    ["BITSTAMP", "Bitstamp", ["EXCHANGE_CRYPTO"]],
    ["COINHOUSE", "Coinhouse", ["EXCHANGE_CRYPTO"]],
    ["MERIA", "Meria", ["EXCHANGE_CRYPTO"]],
    ["PLUS500", "Plus500", ["BROKER_CFD"]],
    ["CFD_FXCM", "FXCM", ["BROKER_CFD"]],
    ["CFD_PEPPERSTONE", "Pepperstone", ["BROKER_CFD"]],
  ];

  for (const [key, name, types] of dejaPresents) {
    it(`${name} : une seule entrée, type inchangé`, () => {
      const matches = PLATFORM_PRESETS.filter(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.key).toBe(key);
      expect(matches[0]!.types).toEqual(types);
    });
  }

  it("les wallets hardware restent des wallets, pas des exchanges", () => {
    for (const key of ["LEDGER", "TREZOR", "TANGEM", "COLDCARD"]) {
      expect(byKey(key)!.types).toEqual(["PORTEFEUILLE_HARDWARE"]);
    }
  });
});

describe("agrégateurs volontairement exclus", () => {
  /*
    Un outil qui exporte un CSV n'est pas un lieu de détention. Les inscrire au
    catalogue permettrait de rattacher une position Binance à une plateforme
    « CoinTracking », ce qui n'a aucun sens patrimonial.
  */
  for (const nom of ["CoinTracking", "Delta", "Parqet"]) {
    it(`${nom} n'est pas une plateforme de détention`, () => {
      const trouve = PLATFORM_PRESETS.find(
        (p) => p.name.toLowerCase() === nom.toLowerCase()
      );
      expect(trouve).toBeUndefined();
    });
  }
});

describe("format → plateforme", () => {
  it("les deux exports Hyperliquid pointent vers la même plateforme", () => {
    expect(platformHintForFormat("hyperliquid_trade")?.logoKey).toBe(
      "HYPERLIQUID"
    );
    expect(platformHintForFormat("hyperliquid_funding")?.logoKey).toBe(
      "HYPERLIQUID"
    );
  });

  it("Paradex est rattaché à sa plateforme", () => {
    expect(platformHintForFormat("paradex")?.logoKey).toBe("PARADEX");
  });

  it("les clés visées existent bien au catalogue", () => {
    for (const id of IMPORT_FORMATS.map((f) => f.id)) {
      const hint = platformHintForFormat(id);
      if (!hint) continue;
      expect(byKey(hint.logoKey), `${hint.logoKey} absent`).toBeDefined();
    }
  });

  it("une plateforme peut porter plusieurs formats", () => {
    expect(formatsForPlatform("CRYPTO_COM").sort()).toEqual([
      "cryptocom",
      "cryptocom_transfer",
    ]);
    expect(formatsForPlatform("HYPERLIQUID").sort()).toEqual([
      "hyperliquid_funding",
      "hyperliquid_trade",
    ]);
  });

  it("les plateformes encore sans parser sont sélectionnables, pas « supportées »", () => {
    /*
      Avanza, Bitvavo, BUX, DEGIRO et Directa ont quitté cette liste au chantier suivant, leurs
      exports réels ayant été analysés. Les autres restent au catalogue sans
      format dédié : c'est l'état que ce test protège — figurer au catalogue ne
      vaut pas promesse de savoir lire un fichier.
    */
    for (const key of [
      "DISNAT",
      "FREETRADE",
      "INVESTENGINE",
      "SCHWAB",
      "RABOBANK",
      "RELAI",
      "FINPENSION",
    ]) {
      expect(hasDedicatedFormat(key), `${key} ne devrait pas avoir de parser`).toBe(
        false
      );
    }
  });

  it("les plateformes réellement outillées, elles, en ont un", () => {
    for (const key of [
      "BINANCE",
      "COINBASE",
      "CRYPTO_COM",
      "HYPERLIQUID",
      "AVANZA",
      "BITVAVO",
      "BUX",
      "DEGIRO",
      "DIRECTA",
      "SAXO_BANK",
      "SWISSQUOTE",
      "TRADE_REPUBLIC",
      "TRADING_212",
      "XTB",
    ]) {
      expect(hasDedicatedFormat(key)).toBe(true);
    }
  });
});

describe("non-régression des formats", () => {
  const idsAttendus = [
    "patrimo",
    "generic",
    "avanza",
    "binance",
    "bitvavo",
    "bux",
    "degiro",
    "directa",
    "etoro",
    "saxo",
    "swissquote",
    "bitpanda",
    "bybit",
    "revolut_crypto",
    "trading212",
    "xtb",
    "boursorama",
    "revolut",
    "ledger_live",
    "coinbase",
    "fortuneo",
    "trade_republic",
    "interactive_brokers",
    "cryptocom",
    "cryptocom_transfer",
    "nexo",
    "ascendex",
    "paradex",
    "hyperliquid_trade",
    "hyperliquid_funding",
    "dynamic",
  ];

  it("aucun identifiant de format n'a bougé", () => {
    expect(IMPORT_FORMATS.map((f) => f.id).sort()).toEqual(
      [...idsAttendus].sort()
    );
  });

  it("les formats d'une même plateforme restent techniquement distincts", () => {
    const ids = IMPORT_FORMATS.map((f) => f.id);
    expect(ids).toContain("cryptocom");
    expect(ids).toContain("cryptocom_transfer");
    expect(ids).toContain("hyperliquid_trade");
    expect(ids).toContain("hyperliquid_funding");

    // Distincts jusque dans leurs colonnes : les fusionner casserait la
    // reconnaissance des en-têtes.
    const parId = (id: string) => IMPORT_FORMATS.find((f) => f.id === id)!;
    expect(parId("cryptocom").aliases).not.toEqual(
      parId("cryptocom_transfer").aliases
    );
    expect(parId("hyperliquid_trade").aliases).not.toEqual(
      parId("hyperliquid_funding").aliases
    );
  });

  it("les libellés ne portent plus de nom de fichier technique", () => {
    for (const f of IMPORT_FORMATS) {
      expect(f.label).not.toMatch(/Trade History|Transaction history|Fills/i);
    }
  });

  it("generic et dynamic restent disponibles", () => {
    expect(platformHintForFormat("generic")).toBeNull();
    expect(platformHintForFormat("dynamic")).toBeNull();
    expect(IMPORT_FORMATS.map((f) => f.id)).toContain("generic");
    expect(IMPORT_FORMATS.map((f) => f.id)).toContain("dynamic");
  });
});
