import { describe, it, expect } from "vitest";
import {
  buildPlatformView,
  buildPlatformViews,
  computePlatformsOverview,
  matchesStatusFilter,
  platformConnectionStatus,
  platformSearchFields,
  platformValue,
  STALE_SYNC_DAYS,
} from "@/app/lib/platforms/connection";
import type { PlatformRow } from "@/app/lib/types/ui";

const NOW = new Date("2026-08-22T12:00:00Z");

const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

function row(over: Partial<PlatformRow> = {}): PlatformRow {
  return {
    id: "p1",
    name: "Boursorama",
    type: "BANQUE",
    cashEur: "0",
    cashBase: "0",
    logoUrl: null,
    ...over,
  };
}

describe("statut de connexion", () => {
  it("une banque n'a aucune connexion à surveiller : elle est manuelle, pas en erreur", () => {
    /*
      C'est le cas majoritaire. Le marquer « erreur » ou « non synchronisé »
      inventerait une panne sur une plateforme qui fonctionne exactement comme
      prévu : tenue à la main ou alimentée par import.
    */
    const v = buildPlatformView(row({ type: "BANQUE" }), NOW);
    expect(v.status).toBe("MANUAL");
    expect(v.needsAttention).toBe(false);
    expect(v.canSync).toBe(false);
  });

  it("un wallet reconnu sans adresse demande une action", () => {
    const s = platformConnectionStatus(
      row({ name: "Solana", type: "BLOCKCHAIN", logoKey: "SOLANA" }),
      NOW
    );
    expect(s).toBe("ADDRESS_MISSING");
  });

  it("un wallet avec adresse mais jamais synchronisé est signalé", () => {
    const s = platformConnectionStatus(
      row({
        name: "Solana",
        logoKey: "SOLANA",
        walletAddress: "9xQeWvG816bUx9EPa2vpXKMfr1nJhCq5DBVDktsyU9Rn",
        lastSyncedAt: null,
      }),
      NOW
    );
    expect(s).toBe("NEVER_SYNCED");
  });

  it("une synchronisation récente est à jour, une ancienne ne l'est plus", () => {
    const base = {
      name: "Solana",
      logoKey: "SOLANA",
      walletAddress: "9xQeWvG816bUx9EPa2vpXKMfr1nJhCq5DBVDktsyU9Rn",
    };
    expect(platformConnectionStatus(row({ ...base, lastSyncedAt: daysAgo(1) }), NOW)).toBe(
      "SYNCED"
    );
    expect(
      platformConnectionStatus(
        row({ ...base, lastSyncedAt: daysAgo(STALE_SYNC_DAYS + 1) }),
        NOW
      )
    ).toBe("STALE");
  });

  it("Monero se déclare à la main : ne jamais réclamer une adresse", () => {
    /*
      Monero n'expose pas de solde depuis une adresse publique : la
      synchronisation est un montant déclaré. Exiger une adresse afficherait
      une alerte permanente sur une plateforme parfaitement en ordre.
    */
    const s = platformConnectionStatus(
      row({ name: "Monero", logoKey: "MONERO", lastSyncedAt: daysAgo(2) }),
      NOW
    );
    expect(s).toBe("SYNCED");
  });
});

describe("valeur et dormance", () => {
  it("la valeur suit le même repli que le tri", () => {
    expect(platformValue(row({ totalValueBase: "100", cashBase: "5" }))).toBe(100);
    expect(platformValue(row({ cashBase: "5" }))).toBe(5);
    expect(platformValue(row({ totalValueBase: "n/a" }))).toBe(0);
  });

  it("une plateforme vide de tout est dormante, pas en erreur", () => {
    const v = buildPlatformView(row(), NOW);
    expect(v.isDormant).toBe(true);
    expect(v.needsAttention).toBe(false);
  });

  it("une plateforme qui porte des opérations passées n'est pas dormante", () => {
    const v = buildPlatformView(row({ transactionCount: 12 }), NOW);
    expect(v.isDormant).toBe(false);
  });
});

describe("synthèse", () => {
  const views = buildPlatformViews(
    [
      row({ id: "a", name: "Boursorama", totalValueBase: "1000", positionCount: 2,
        envelopes: [{ accountType: "CTO", valueEur: "1000", valueBase: "1000", positionCount: 2 }] }),
      row({ id: "b", name: "Fortuneo", totalValueBase: "500", positionCount: 1,
        envelopes: [{ accountType: "PEA", valueEur: "500", valueBase: "500", positionCount: 1 }] }),
      row({ id: "c", name: "Solana", logoKey: "SOLANA" }),
    ],
    NOW
  );

  it("agrège plateformes, valeur, positions et enveloppes distinctes", () => {
    const o = computePlatformsOverview(views);
    expect(o.platformCount).toBe(3);
    expect(o.totalValue).toBe(1500);
    expect(o.positionCount).toBe(3);
    expect(o.envelopeCount).toBe(2);
  });

  it("le compteur de synchro se rapporte aux seules plateformes synchronisables", () => {
    /*
      « 24 synchronisées sur 12 plateformes » n'aurait aucun sens si le
      dénominateur incluait les banques : elles ne se synchronisent pas.
    */
    const o = computePlatformsOverview(views);
    expect(o.syncableCount).toBe(1);
    expect(o.syncedCount).toBe(0);
    expect(o.attentionCount).toBe(1);
  });
});

describe("filtres et recherche", () => {
  const wallet = buildPlatformView(row({ name: "Solana", logoKey: "SOLANA" }), NOW);
  const bank = buildPlatformView(row({ name: "Boursorama" }), NOW);

  it("le filtre « à traiter » ne retient que ce qui demande une action", () => {
    expect(matchesStatusFilter(wallet, "ATTENTION")).toBe(true);
    expect(matchesStatusFilter(bank, "ATTENTION")).toBe(false);
    expect(matchesStatusFilter(bank, "MANUAL")).toBe(true);
    expect(matchesStatusFilter(bank, "ALL")).toBe(true);
  });

  it("la recherche couvre l'adresse publique mais jamais un secret", () => {
    const v = buildPlatformView(
      row({
        name: "Ledger",
        walletAddress: "0xabc123",
        hasWalletApiKey: true,
        notes: "hardware",
      }),
      NOW
    );
    const fields = platformSearchFields(v);
    expect(fields).toContain("0xabc123");
    expect(fields).toContain("hardware");
    // Aucun champ de recherche ne peut porter de secret : le serveur n'en
    // envoie jamais, seule sa présence est connue.
    expect(JSON.stringify(fields)).not.toContain("true");
    expect(Object.keys(v.row)).not.toContain("walletApiKey");
  });
});
