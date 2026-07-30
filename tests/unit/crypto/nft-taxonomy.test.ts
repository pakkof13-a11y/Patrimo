import { describe, expect, it } from "vitest";
import {
  allowsQuantityAboveOne,
  blocksPositiveValuationByDefault,
  defaultNftValuationConfidence,
  isEvmStandard,
  isIlliquidHoldingStatus,
  isInactiveHoldingStatus,
  isLedgerBackedNftEvent,
  isNonOwnedStatus,
  isSolanaStandard,
  isSyncedNftOrigin,
  isWeakNftValuation,
  nftDisposalOutcome,
  requiresContractIdentity,
  requiresMintIdentity,
} from "@/app/lib/crypto/nft-taxonomy";

describe("isEvmStandard / isSolanaStandard", () => {
  it("classe ERC_721/ERC_1155 comme EVM", () => {
    expect(isEvmStandard("ERC_721")).toBe(true);
    expect(isEvmStandard("ERC_1155")).toBe(true);
    expect(isEvmStandard("SPL")).toBe(false);
  });

  it("classe SPL/SPL_COMPRESSED comme Solana", () => {
    expect(isSolanaStandard("SPL")).toBe(true);
    expect(isSolanaStandard("SPL_COMPRESSED")).toBe(true);
    expect(isSolanaStandard("ERC_721")).toBe(false);
  });
});

describe("allowsQuantityAboveOne — cas 2 (ERC-1155)", () => {
  it("seul ERC_1155 autorise une quantité > 1", () => {
    expect(allowsQuantityAboveOne("ERC_1155")).toBe(true);
    expect(allowsQuantityAboveOne("ERC_721")).toBe(false);
    expect(allowsQuantityAboveOne("SPL")).toBe(false);
  });
});

describe("statuts de détention — cas 24/26/27/28/29", () => {
  it("BURNED/TRANSFERRED_OUT/SOLD sont inactifs", () => {
    expect(isInactiveHoldingStatus("BURNED")).toBe(true);
    expect(isInactiveHoldingStatus("TRANSFERRED_OUT")).toBe(true);
    expect(isInactiveHoldingStatus("SOLD")).toBe(true);
    expect(isInactiveHoldingStatus("HELD")).toBe(false);
  });

  it("BORROWED_IN n'est pas possédé", () => {
    expect(isNonOwnedStatus("BORROWED_IN")).toBe(true);
    expect(isNonOwnedStatus("HELD")).toBe(false);
    expect(isNonOwnedStatus("LOANED_OUT")).toBe(false);
  });

  it("LISTED_FOR_SALE/ESCROWED/LOANED_OUT/STAKED/BRIDGED_OUT/WRAPPED sont illiquides", () => {
    expect(isIlliquidHoldingStatus("LISTED_FOR_SALE")).toBe(true);
    expect(isIlliquidHoldingStatus("ESCROWED")).toBe(true);
    expect(isIlliquidHoldingStatus("LOANED_OUT")).toBe(true);
    expect(isIlliquidHoldingStatus("STAKED")).toBe(true);
    expect(isIlliquidHoldingStatus("BRIDGED_OUT")).toBe(true);
    expect(isIlliquidHoldingStatus("WRAPPED")).toBe(true);
    expect(isIlliquidHoldingStatus("HELD")).toBe(false);
  });
});

describe("blocksPositiveValuationByDefault", () => {
  it("seul CONFIRMED_SPAM bloque une valorisation positive par défaut", () => {
    expect(blocksPositiveValuationByDefault("CONFIRMED_SPAM")).toBe(true);
    expect(blocksPositiveValuationByDefault("SUSPECTED")).toBe(false);
    expect(blocksPositiveValuationByDefault("CLEAN")).toBe(false);
    expect(blocksPositiveValuationByDefault("IGNORED_BY_USER")).toBe(false);
  });
});

describe("isWeakNftValuation / defaultNftValuationConfidence", () => {
  it("qualifie les méthodes faibles", () => {
    expect(isWeakNftValuation("ACQUISITION_COST_FALLBACK")).toBe(true);
    expect(isWeakNftValuation("COLLECTION_ESTIMATE")).toBe(true);
    expect(isWeakNftValuation("UNKNOWN")).toBe(true);
    expect(isWeakNftValuation("ZERO")).toBe(true);
    expect(isWeakNftValuation("FLOOR_PRICE")).toBe(false);
  });

  it("ordonne la confiance par défaut selon la priorité métier", () => {
    expect(defaultNftValuationConfidence("MANUAL")).toBeGreaterThan(
      defaultNftValuationConfidence("LAST_SALE")
    );
    expect(defaultNftValuationConfidence("LAST_SALE")).toBeGreaterThan(
      defaultNftValuationConfidence("FLOOR_PRICE")
    );
    expect(defaultNftValuationConfidence("FLOOR_PRICE")).toBeGreaterThan(
      defaultNftValuationConfidence("ACQUISITION_COST_FALLBACK")
    );
    expect(defaultNftValuationConfidence("UNKNOWN")).toBe(0);
  });
});

describe("isSyncedNftOrigin", () => {
  it("WALLET_SYNC et PLATFORM_API sont des origines synchronisées", () => {
    expect(isSyncedNftOrigin("WALLET_SYNC")).toBe(true);
    expect(isSyncedNftOrigin("PLATFORM_API")).toBe(true);
    expect(isSyncedNftOrigin("MANUAL")).toBe(false);
  });
});

describe("isLedgerBackedNftEvent", () => {
  it("les événements qui déplacent une quantité sont adossés au journal", () => {
    expect(isLedgerBackedNftEvent("BUY")).toBe(true);
    expect(isLedgerBackedNftEvent("SELL")).toBe(true);
    expect(isLedgerBackedNftEvent("BURN")).toBe(true);
  });

  it("les événements de cycle de vie non financiers ne le sont pas", () => {
    expect(isLedgerBackedNftEvent("LIST")).toBe(false);
    expect(isLedgerBackedNftEvent("METADATA_REFRESH")).toBe(false);
    expect(isLedgerBackedNftEvent("SYNC_MISSING")).toBe(false);
    expect(isLedgerBackedNftEvent("STAKE")).toBe(false);
  });
});

describe("requiresContractIdentity / requiresMintIdentity", () => {
  it("un standard EVM exige contrat+tokenId", () => {
    expect(requiresContractIdentity("ERC_721")).toBe(true);
    expect(requiresMintIdentity("ERC_721")).toBe(false);
  });

  it("un standard Solana exige un mint", () => {
    expect(requiresMintIdentity("SPL")).toBe(true);
    expect(requiresContractIdentity("SPL")).toBe(false);
  });
});

describe("nftDisposalOutcome — cas 24/25/30/31/32/33/34", () => {
  it("SOLD -> événement SELL, statut SOLD", () => {
    expect(nftDisposalOutcome("SOLD")).toEqual({ eventType: "SELL", status: "SOLD" });
  });

  it("BURNED -> événement BURN, statut BURNED", () => {
    expect(nftDisposalOutcome("BURNED")).toEqual({ eventType: "BURN", status: "BURNED" });
  });

  it("TRANSFER_OUT -> événement TRANSFER_OUT, statut TRANSFERRED_OUT", () => {
    expect(nftDisposalOutcome("TRANSFER_OUT")).toEqual({
      eventType: "TRANSFER_OUT",
      status: "TRANSFERRED_OUT",
    });
  });

  it("DONATION_OUT -> événement DONATION_OUT, statut TRANSFERRED_OUT", () => {
    expect(nftDisposalOutcome("DONATION_OUT")).toEqual({
      eventType: "DONATION_OUT",
      status: "TRANSFERRED_OUT",
    });
  });

  it("BRIDGE_OUT -> événement BRIDGE_OUT, statut BRIDGED_OUT", () => {
    expect(nftDisposalOutcome("BRIDGE_OUT")).toEqual({
      eventType: "BRIDGE_OUT",
      status: "BRIDGED_OUT",
    });
  });

  it("WRAP -> événement WRAP, statut WRAPPED", () => {
    expect(nftDisposalOutcome("WRAP")).toEqual({ eventType: "WRAP", status: "WRAPPED" });
  });

  it("BUNDLE -> événement BUNDLE, statut TRANSFERRED_OUT (sort de la détention individuelle)", () => {
    expect(nftDisposalOutcome("BUNDLE")).toEqual({ eventType: "BUNDLE", status: "TRANSFERRED_OUT" });
  });

  it("une source inconnue/non mappée retombe sur MANUAL_OVERRIDE / UNKNOWN — jamais un statut inventé", () => {
    expect(nftDisposalOutcome("LOST")).toEqual({ eventType: "MANUAL_OVERRIDE", status: "UNKNOWN" });
    expect(nftDisposalOutcome("something-unrecognized")).toEqual({
      eventType: "MANUAL_OVERRIDE",
      status: "UNKNOWN",
    });
  });
});
