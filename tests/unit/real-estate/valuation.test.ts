import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * IMM-04 : un bien en mode `MANUAL` ne doit jamais voir sa valeur saisie
 * écrasée par un clic sur "Estimer depuis les ventes réelles" — l'écran
 * affiche juste au-dessus "Valeur saisie — non écrasée par l'estimation", et
 * ce texte doit rester vrai. Le fautif n'était pas le calcul DVF (médiane,
 * comparables) mais le garde-fou qui décide si l'estimation peut s'écrire :
 * le bouton envoyait toujours `apply: true`, y compris en mode manuel.
 *
 * `revalueFromDvf` touche la base (asset, realEstateDetail, priceHistory,
 * priceQuote) : on isole Prisma comme dans les autres tests du module
 * immobilier, et on bouchonne l'estimation/le géocodage pour n'exercer que le
 * garde-fou.
 */

const assetFindFirst = vi.fn();
const detailFindFirst = vi.fn();
const detailUpdate = vi.fn();
const assetUpdate = vi.fn();
const priceHistoryCreate = vi.fn();
const priceQuoteDeleteMany = vi.fn();
const transactionFn = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
    realEstateDetail: {
      findFirst: (...a: unknown[]) => detailFindFirst(...a),
      update: (...a: unknown[]) => detailUpdate(...a),
    },
    priceHistory: {
      create: (...a: unknown[]) => priceHistoryCreate(...a),
    },
    priceQuote: {
      deleteMany: (...a: unknown[]) => priceQuoteDeleteMany(...a),
    },
    $transaction: (...a: unknown[]) => transactionFn(...a),
  },
}));

vi.mock("@/app/lib/real-estate/estimate", () => ({
  estimateProperty: vi.fn(),
  isDvfCoveredDepartment: () => true,
}));

vi.mock("@/app/lib/real-estate/geocode", () => ({
  departmentFromCode: () => "13",
  geocodeAddress: vi.fn(),
}));

import { estimateProperty } from "@/app/lib/real-estate/estimate";
import { geocodeAddress } from "@/app/lib/real-estate/geocode";
import {
  canApplyDvfEstimateDirectly,
  revalueFromDvf,
} from "@/app/lib/real-estate/valuation";

const USER = "user-1";
const ASSET = "asset-1";

function baseDetail(over: Record<string, unknown> = {}) {
  return {
    propertyType: "APPARTEMENT",
    livingAreaM2: 50,
    landAreaM2: null,
    rooms: 2,
    latitude: 43.3,
    longitude: 5.4,
    inseeCode: "13055",
    valuationMode: "MANUAL",
    lastValuedAt: null,
    energyRating: null,
    gesRating: null,
    orientation: null,
    viewType: null,
    windowQuality: null,
    floor: null,
    totalFloors: null,
    hasElevator: null,
    hasBalcony: null,
    balconyAreaM2: null,
    hasGarden: null,
    gardenAreaM2: null,
    hasCellar: null,
    parkingSpots: null,
    isCopropriete: null,
    annualCoproChargesEur: null,
    ...over,
  };
}

beforeEach(() => {
  assetFindFirst.mockReset();
  detailFindFirst.mockReset().mockResolvedValue({
    latitude: 43.3,
    longitude: 5.4,
    addressLine: "1 rue du port",
    postalCode: "13001",
    city: "Marseille",
  });
  detailUpdate.mockReset().mockResolvedValue({});
  assetUpdate.mockReset().mockResolvedValue({});
  priceHistoryCreate.mockReset().mockResolvedValue({});
  priceQuoteDeleteMany.mockReset().mockResolvedValue({});
  transactionFn.mockReset().mockResolvedValue([]);
  (geocodeAddress as unknown as ReturnType<typeof vi.fn>).mockReset();
  (estimateProperty as unknown as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({
    estimateEur: "340000",
    distribution: null,
    comparableCount: 8,
    radiusUsedM: 500,
    monthsUsed: 24,
    confidence: "HIGH",
    insufficientData: false,
    samples: [],
    refinement: null,
    source: "LOCAL",
    dpeClass: null,
    dpeCoefficient: 1,
    adjustedEstimateEur: "340000",
  });
});

describe("canApplyDvfEstimateDirectly", () => {
  it("interdit l'écriture directe tant que le bien est en mode manuel", () => {
    expect(canApplyDvfEstimateDirectly("MANUAL")).toBe(false);
  });

  it("autorise l'écriture directe seulement en mode DVF_AUTO", () => {
    expect(canApplyDvfEstimateDirectly("DVF_AUTO")).toBe(true);
  });
});

describe("IMM-04 golden : le bouton d'estimation ne doit pas écraser une valeur saisie", () => {
  it("bien MANUAL à 312000 : apply=false (garde-fou correct) laisse manualPrice intact", async () => {
    assetFindFirst.mockResolvedValue({
      id: ASSET,
      manualPrice: { toString: () => "312000" },
      realEstate: baseDetail({ valuationMode: "MANUAL" }),
    });
    (geocodeAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "ok",
      result: { latitude: 43.3, longitude: 5.4, inseeCode: "13055" },
    });

    // Reproduit exactement ce que fait désormais le bouton pour un bien
    // manuel : `canApplyDvfEstimateDirectly("MANUAL")` vaut false, donc
    // `apply` est false.
    const apply = canApplyDvfEstimateDirectly("MANUAL");
    expect(apply).toBe(false);

    const outcome = await revalueFromDvf(USER, ASSET, { force: true, apply });

    // L'estimation est bien calculée et renvoyée à l'écran…
    expect(outcome.kind).toBe("updated");
    if (outcome.kind === "updated") {
      expect(outcome.valueEur).toBe("340000");
    }
    // …mais rien n'est écrit : la valeur saisie (312000) reste la seule
    // vérité en base, et le mode reste MANUAL puisqu'il n'a pas bougé.
    expect(assetUpdate).not.toHaveBeenCalled();
    expect(detailUpdate).not.toHaveBeenCalled();
    expect(transactionFn).not.toHaveBeenCalled();
  });

  it("l'ancien comportement (apply=true forcé) aurait écrasé la valeur saisie sans changer le mode — exactement le défaut du ticket", async () => {
    assetFindFirst.mockResolvedValue({
      id: ASSET,
      manualPrice: { toString: () => "312000" },
      realEstate: baseDetail({ valuationMode: "MANUAL" }),
    });
    (geocodeAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "ok",
      result: { latitude: 43.3, longitude: 5.4, inseeCode: "13055" },
    });

    // Appel tel que le bouton le faisait avant le correctif :
    // `{ force: true, apply: true }` inconditionnellement.
    await revalueFromDvf(USER, ASSET, { force: true, apply: true });

    // La médiane DVF écrase bien manualPrice…
    expect(transactionFn).toHaveBeenCalledTimes(1);
    const writes = transactionFn.mock.calls[0]![0] as unknown[];
    expect(assetUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ manualPrice: expect.anything() }) })
    );
    // …et pourtant le mode n'est jamais rebasculé vers DVF_AUTO : c'est
    // exactement l'incohérence texte/état du ticket IMM-04 (mode toujours
    // affiché MANUAL alors que la valeur ne l'est plus). D'où le choix retenu
    // : ne jamais atteindre ce chemin depuis le bouton en mode manuel.
    const detailWriteArg = detailUpdate.mock.calls[0]?.[0] as
      | { data?: Record<string, unknown> }
      | undefined;
    expect(detailWriteArg?.data).not.toHaveProperty("valuationMode");
    void writes;
  });

  it("bien DVF_AUTO : apply reste true, la mise à jour automatique n'est pas régressée", async () => {
    assetFindFirst.mockResolvedValue({
      id: ASSET,
      manualPrice: { toString: () => "300000" },
      realEstate: baseDetail({ valuationMode: "DVF_AUTO" }),
    });
    (geocodeAddress as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: "ok",
      result: { latitude: 43.3, longitude: 5.4, inseeCode: "13055" },
    });

    const apply = canApplyDvfEstimateDirectly("DVF_AUTO");
    expect(apply).toBe(true);

    const outcome = await revalueFromDvf(USER, ASSET, { force: true, apply });

    expect(outcome.kind).toBe("updated");
    expect(transactionFn).toHaveBeenCalledTimes(1);
  });
});
