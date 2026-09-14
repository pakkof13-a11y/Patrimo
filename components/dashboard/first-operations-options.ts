/**
 * Décision « quelles options proposer » pour la deuxième étape de
 * l'onboarding — juste après la création d'une plateforme sur un compte sans
 * journal.
 *
 * Trois chemins possibles : saisie manuelle, import CSV, synchronisation.
 * Les deux premiers sont toujours valides — n'importe quelle plateforme
 * accepte une transaction saisie à la main ou un relevé importé. Le
 * troisième ne l'est pas : Patrimo ne synchronise que les wallets on-chain
 * reconnus (`resolveChainSyncForPlatform`, cf. `app/lib/platforms/
 * connection.ts` et `app/lib/market/chain-wallet-sync.ts`). Proposer une
 * synchronisation qui échouera est pire que ne rien proposer — donc pas de
 * détection par nom ou par intuition ici, seulement la capacité déjà connue
 * du dépôt.
 *
 * Module pur, sans DOM : testable directement dans `tests/unit`.
 */

import {
  describeChainSyncFeatures,
  resolveChainSyncForPlatform,
} from "@/app/lib/market/chain-wallet-sync";

export type FirstOperationsPlatformInput = {
  id: string;
  name: string;
  type: string;
  logoKey?: string | null;
};

export type SyncableFirstPlatform = {
  id: string;
  name: string;
  /** Libellé neutre du module de synchro (« Solana (SOL) », « Ethereum (ETH) »…). */
  chainLabel: string;
  /**
   * Ce que la synchro couvre réellement pour ce provider — Monero, par
   * exemple, ne récupère pas depuis une adresse publique comme Solana ou une
   * chaîne EVM : le solde y est déclaré à la main, seuls ticker/logo/cours
   * viennent de CoinGecko. Une phrase générique aurait été fausse pour lui.
   */
  description: string;
};

export type FirstOperationsOptions = {
  /** Toujours proposée. */
  manual: true;
  /** Toujours proposée. */
  csv: true;
  /**
   * `null` signifie « aucune des plateformes fournies ne s'y prête » — une
   * conclusion positive, pas une absence de réponse. La capacité de chaque
   * plateforme est toujours résolue via `resolveChainSyncForPlatform`, jamais
   * laissée indéterminée.
   */
  sync: SyncableFirstPlatform | null;
};

/**
 * Résout les trois chemins pour un jeu de plateformes — en pratique la
 * plateforme qui vient d'être créée, seule dans le tableau la plupart du
 * temps. La première capacité de synchro reconnue gagne ; s'il en existe
 * plusieurs, un seul chemin est proposé (pas une liste de wallets à choisir
 * à cette étape).
 */
export function resolveFirstOperationsOptions(
  platforms: FirstOperationsPlatformInput[]
): FirstOperationsOptions {
  let sync: SyncableFirstPlatform | null = null;
  for (const p of platforms) {
    const cap = resolveChainSyncForPlatform({
      logoKey: p.logoKey,
      name: p.name,
      type: p.type,
    });
    if (cap) {
      sync = {
        id: p.id,
        name: p.name,
        chainLabel: cap.label,
        description: describeChainSyncFeatures(cap),
      };
      break;
    }
  }
  return { manual: true, csv: true, sync };
}

/**
 * Faut-il proposer la deuxième étape après cette création de plateforme ?
 *
 * Seulement quand la création vient du chemin dédié (« Ajouter une
 * plateforme », pas un détour depuis le formulaire de transaction ou
 * d'import — ces flux mènent déjà à une opération), qu'elle a réellement créé
 * une plateforme (upsert peut retourner une plateforme existante), et que le
 * compte n'a encore aucune transaction : c'est exactement l'utilisateur
 * « sans journal » que ce lot adresse.
 */
export function shouldOfferFirstOperations(input: {
  target: "tx" | "import" | "standalone";
  created: boolean;
  transactionCountBeforeCreate: number;
}): boolean {
  return (
    input.target === "standalone" &&
    input.created &&
    input.transactionCountBeforeCreate <= 0
  );
}
