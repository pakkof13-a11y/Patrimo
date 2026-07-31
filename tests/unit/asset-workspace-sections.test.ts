import { describe, expect, it } from "vitest";
import {
  ASSET_WORKSPACE_SECTIONS,
  isAssetWorkspaceSection,
  sectionsForAsset,
} from "@/app/lib/portfolio/asset-workspace-sections";

describe("registre des sections de l'espace de travail", () => {
  it("n'expose pas deux fois le même identifiant", () => {
    const ids = ASSET_WORKSPACE_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("donne à chaque section un libellé et une phrase d'intention", () => {
    for (const s of ASSET_WORKSPACE_SECTIONS) {
      expect(s.label.trim()).not.toBe("");
      expect(s.hint.trim()).not.toBe("");
    }
  });

  it("ouvre sur la vue d'ensemble", () => {
    expect(ASSET_WORKSPACE_SECTIONS[0]!.id).toBe("overview");
  });

  it("ne déclare « pending » que les sections sans modèle de données", () => {
    const pending = ASSET_WORKSPACE_SECTIONS.filter(
      (s) => s.backing === "pending"
    ).map((s) => s.id);
    // Fiscalité (moteur par ligne à venir) et Documents (aucun stockage).
    // Toute autre section marquée « pending » signalerait qu'on a laissé un
    // écran vide alors que la donnée existe.
    expect(pending.sort()).toEqual(["documents", "tax"]);
  });
});

describe("sectionsForAsset", () => {
  it("masque DeFi et NFT hors crypto", () => {
    const ids = sectionsForAsset({ assetClass: "ACTIONS" }).map((s) => s.id);
    expect(ids).not.toContain("defi");
    expect(ids).not.toContain("nfts");
    expect(ids).toContain("overview");
  });

  it("les expose pour un actif crypto, quelle que soit la casse", () => {
    for (const cls of ["CRYPTO", "crypto"]) {
      const ids = sectionsForAsset({ assetClass: cls }).map((s) => s.id);
      expect(ids).toContain("defi");
      expect(ids).toContain("nfts");
    }
  });

  it("reste utilisable quand la classe est inconnue", () => {
    const ids = sectionsForAsset({ assetClass: null }).map((s) => s.id);
    expect(ids).toContain("overview");
    expect(ids).not.toContain("defi");
  });

  it("conserve l'ordre du registre", () => {
    const all = ASSET_WORKSPACE_SECTIONS.map((s) => s.id);
    const crypto = sectionsForAsset({ assetClass: "CRYPTO" }).map((s) => s.id);
    expect(crypto).toEqual(all);
  });
});

describe("isAssetWorkspaceSection", () => {
  it("accepte les identifiants du registre", () => {
    expect(isAssetWorkspaceSection("documents")).toBe(true);
    expect(isAssetWorkspaceSection("overview")).toBe(true);
  });

  it("rejette le reste", () => {
    expect(isAssetWorkspaceSection("")).toBe(false);
    expect(isAssetWorkspaceSection(null)).toBe(false);
    expect(isAssetWorkspaceSection("inconnu")).toBe(false);
  });
});
