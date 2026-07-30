import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  assessNftMetadataQuality,
  classifyNftSpam,
  spamStatusToAssetFlags,
} from "@/app/lib/crypto/nft-classification";

describe("classifyNftSpam", () => {
  it("cas 9 : un airdrop non sollicité, collection non vérifiée, sans floor est SUSPECTED", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "UNVERIFIED",
      hasReliableFloor: false,
      acquisitionSource: "AIRDROP",
      acquisitionCostEur: null,
      name: "Free Mint Club",
      description: null,
    });
    expect(out.spamStatus).toBe("SUSPECTED");
    expect(out.reason).toBeTruthy();
  });

  it("cas 10 : un motif de phishing dans le nom/description est CONFIRMED_SPAM", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "VERIFIED",
      hasReliableFloor: true,
      acquisitionSource: "AIRDROP",
      acquisitionCostEur: null,
      name: "Claim your reward now at http://scam.xyz",
      description: null,
    });
    expect(out.spamStatus).toBe("CONFIRMED_SPAM");
  });

  it("le phishing prévaut même sur une collection vérifiée avec floor fiable", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "VERIFIED",
      hasReliableFloor: true,
      acquisitionSource: "MANUAL",
      acquisitionCostEur: d(100),
      name: "Visit airdrop-claim.io to redeem now",
      description: null,
    });
    expect(out.spamStatus).toBe("CONFIRMED_SPAM");
  });

  it("un achat secondaire payant classique est CLEAN", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "VERIFIED",
      hasReliableFloor: true,
      acquisitionSource: "SECONDARY_PURCHASE",
      acquisitionCostEur: d(500),
      name: "Bored Ape #1234",
      description: "A classic PFP",
    });
    expect(out.spamStatus).toBe("CLEAN");
    expect(out.reason).toBeNull();
  });

  it("cas 55 : une saisie manuelle payante d'un NFT par ailleurs suspect reste CLEAN (payé = volontaire)", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "UNVERIFIED",
      hasReliableFloor: false,
      acquisitionSource: "MANUAL",
      acquisitionCostEur: d(10),
      name: "Some random NFT",
      description: null,
    });
    expect(out.spamStatus).toBe("CLEAN");
  });

  it("un airdrop non sollicité mais sur une collection vérifiée reste CLEAN", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "VERIFIED",
      hasReliableFloor: false,
      acquisitionSource: "AIRDROP",
      acquisitionCostEur: null,
      name: "Official Partner Drop",
      description: null,
    });
    expect(out.spamStatus).toBe("CLEAN");
  });

  it("un airdrop avec un floor fiable connu n'est pas suspect", () => {
    const out = classifyNftSpam({
      collectionVerifiedStatus: "UNVERIFIED",
      hasReliableFloor: true,
      acquisitionSource: "AIRDROP",
      acquisitionCostEur: null,
      name: "Some Drop",
      description: null,
    });
    expect(out.spamStatus).toBe("CLEAN");
  });
});

describe("spamStatusToAssetFlags", () => {
  it("CONFIRMED_SPAM pose les deux booléens", () => {
    expect(spamStatusToAssetFlags("CONFIRMED_SPAM")).toEqual({ isSpam: true, isScamSuspected: true });
  });

  it("SUSPECTED pose uniquement isScamSuspected", () => {
    expect(spamStatusToAssetFlags("SUSPECTED")).toEqual({ isSpam: false, isScamSuspected: true });
  });

  it("CLEAN ne pose aucun booléen", () => {
    expect(spamStatusToAssetFlags("CLEAN")).toEqual({ isSpam: false, isScamSuspected: false });
  });

  it("IGNORED_BY_USER (reclassification) ne pose aucun booléen — redevient comme CLEAN", () => {
    expect(spamStatusToAssetFlags("IGNORED_BY_USER")).toEqual({ isSpam: false, isScamSuspected: false });
  });
});

describe("assessNftMetadataQuality — cas 5/6 (sans image, metadata cassée)", () => {
  it("cas 6 : une réponse provider non interprétable est BROKEN, prioritaire sur tout le reste", () => {
    const quality = assessNftMetadataQuality({
      hasName: true,
      hasImage: true,
      hasRawMetadata: true,
      parseFailed: true,
    });
    expect(quality).toBe("BROKEN");
  });

  it("nom et image présents : COMPLETE", () => {
    const quality = assessNftMetadataQuality({
      hasName: true,
      hasImage: true,
      hasRawMetadata: true,
      parseFailed: false,
    });
    expect(quality).toBe("COMPLETE");
  });

  it("cas 5 : sans image mais avec un nom : PARTIAL", () => {
    const quality = assessNftMetadataQuality({
      hasName: true,
      hasImage: false,
      hasRawMetadata: false,
      parseFailed: false,
    });
    expect(quality).toBe("PARTIAL");
  });

  it("aucune donnée exploitable : UNKNOWN", () => {
    const quality = assessNftMetadataQuality({
      hasName: false,
      hasImage: false,
      hasRawMetadata: false,
      parseFailed: false,
    });
    expect(quality).toBe("UNKNOWN");
  });
});
