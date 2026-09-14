import { describe, expect, it } from "vitest";
import {
  resolveFirstOperationsOptions,
  shouldOfferFirstOperations,
  type FirstOperationsPlatformInput,
} from "@/components/dashboard/first-operations-options";

describe("resolveFirstOperationsOptions", () => {
  it("propose toujours la saisie manuelle et l'import CSV", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p1", name: "Boursorama", type: "BANQUE" },
    ]);
    expect(opts.manual).toBe(true);
    expect(opts.csv).toBe(true);
  });

  it("n'offre pas la synchronisation pour une banque — UNKNOWN n'est pas ZERO, mais ici la réponse est connue et négative", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p1", name: "Boursorama", type: "BANQUE" },
    ]);
    expect(opts.sync).toBeNull();
  });

  it("n'offre pas la synchronisation pour un courtier classique", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p1", name: "Trade Republic", type: "COURTIER" },
    ]);
    expect(opts.sync).toBeNull();
  });

  it("offre la synchronisation pour un wallet Solana reconnu par logoKey", () => {
    const platforms: FirstOperationsPlatformInput[] = [
      { id: "p1", name: "Mon wallet", type: "BLOCKCHAIN", logoKey: "SOLANA" },
    ];
    const opts = resolveFirstOperationsOptions(platforms);
    expect(opts.sync).not.toBeNull();
    expect(opts.sync?.id).toBe("p1");
    expect(opts.sync?.chainLabel).toBe("Solana (SOL)");
  });

  it("offre la synchronisation pour une chaîne EVM Zerion reconnue", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p2", name: "Ma chaîne", type: "BLOCKCHAIN", logoKey: "ETHEREUM" },
    ]);
    expect(opts.sync?.chainLabel).toBe("Ethereum (ETH)");
  });

  it("offre la synchronisation pour Monero (déclaration locale, mais capacité reconnue)", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p3", name: "Mon Monero", type: "BLOCKCHAIN", logoKey: "MONERO" },
    ]);
    expect(opts.sync?.chainLabel).toBe("Monero (XMR)");
    // Monero se déclare à la main — la description ne doit jamais prétendre
    // une récupération automatique depuis une adresse publique.
    expect(opts.sync?.description).toContain("solde manuel");
  });

  it("retombe sur la détection par nom si le logoKey est absent — même règle que le reste du dépôt", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p4", name: "Wallet Solana perso", type: "BLOCKCHAIN" },
    ]);
    expect(opts.sync?.chainLabel).toBe("Solana (SOL)");
  });

  it("un type BLOCKCHAIN sans indice reconnu ne suffit pas à lui seul — pas de synchro devinée", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p5", name: "Wallet perso", type: "BLOCKCHAIN" },
    ]);
    expect(opts.sync).toBeNull();
  });

  it("s'arrête à la première plateforme synchronisable du lot", () => {
    const opts = resolveFirstOperationsOptions([
      { id: "p1", name: "Boursorama", type: "BANQUE" },
      { id: "p2", name: "Mon wallet", type: "BLOCKCHAIN", logoKey: "SOLANA" },
      { id: "p3", name: "Ma chaîne", type: "BLOCKCHAIN", logoKey: "ETHEREUM" },
    ]);
    expect(opts.sync?.id).toBe("p2");
  });

  it("une liste vide n'offre aucune synchronisation", () => {
    expect(resolveFirstOperationsOptions([]).sync).toBeNull();
  });
});

describe("shouldOfferFirstOperations", () => {
  it("propose la deuxième étape après création réussie depuis le chemin dédié, compte sans transaction", () => {
    expect(
      shouldOfferFirstOperations({
        target: "standalone",
        created: true,
        transactionCountBeforeCreate: 0,
      })
    ).toBe(true);
  });

  it("ne propose rien si la création vient du formulaire de transaction — l'utilisateur y est déjà", () => {
    expect(
      shouldOfferFirstOperations({
        target: "tx",
        created: true,
        transactionCountBeforeCreate: 0,
      })
    ).toBe(false);
  });

  it("ne propose rien si la création vient de l'import CSV — même raison", () => {
    expect(
      shouldOfferFirstOperations({
        target: "import",
        created: true,
        transactionCountBeforeCreate: 0,
      })
    ).toBe(false);
  });

  it("ne propose rien si la plateforme existait déjà (upsert, pas de création)", () => {
    expect(
      shouldOfferFirstOperations({
        target: "standalone",
        created: false,
        transactionCountBeforeCreate: 0,
      })
    ).toBe(false);
  });

  it("ne propose rien si le compte a déjà un journal", () => {
    expect(
      shouldOfferFirstOperations({
        target: "standalone",
        created: true,
        transactionCountBeforeCreate: 4,
      })
    ).toBe(false);
  });
});
