/**
 * Anti-double-compte DeFi — fonctions pures, sans accès Prisma.
 *
 * Le risque que ce module adresse n'est pas cosmétique : en DeFi, la **même**
 * valeur économique existe simultanément sous plusieurs formes techniques. 1 ETH
 * déposé chez Lido devient 1 stETH ; ce stETH déposé chez Aave devient 1 astETH ;
 * bridgé sur Arbitrum, il devient 1 stETH.arb. Compter chaque forme fait
 * apparaître quatre fois le même euro au patrimoine.
 *
 * Deux mécanismes, volontairement distincts :
 * - `selectValuationLegs` (dans `defi-valuation.ts`) écarte les doublons
 *   **à l'intérieur** d'une position (dépôt vs reçu, part vs sous-jacents) ;
 * - ce module détecte les doublons **entre** positions (bridge, wrap, migration,
 *   multi-source) et les signale sans les résoudre en silence.
 *
 * Rien n'est supprimé automatiquement : une position masquée par erreur est
 * invisible et introuvable, alors qu'un conflit signalé se tranche en un clic.
 */

import { isRepresentativeLeg } from "./defi-taxonomy";

/** Position telle que la déduplication la voit. */
export type DedupPosition = {
  id: string;
  /** Clé d'identité du fournisseur — `df:chain:proto:type:asset` chez Zerion. */
  providerKey?: string | null;
  dataOrigin: string;
  protocol: string;
  protocolVersion?: string | null;
  chain?: string | null;
  positionType: string;
  /** Symboles des jambes non-représentatives — l'exposition réelle. */
  symbols: string[];
  /** Position liée explicitement (jambe opposée d'un bridge, ancêtre d'une migration). */
  linkedPositionId?: string | null;
  status: string;
  /** Référence du NFT support d'une position concentrée, s'il y en a un. */
  nftPositionRef?: string | null;
  /**
   * Date d'ouverture — sert à trancher le sens d'un pont quand les deux côtés
   * sont encore actifs. Le statut ne suffit pas : deux positions `ACTIVE` ne
   * disent pas laquelle est la destination, et choisir selon l'ordre du tableau
   * rendrait le résultat dépendant de l'ordre de lecture en base.
   */
  openedAt?: Date | string | null;
};

export type ConflictKind =
  /** Deux sources décrivent la même position. */
  | "MULTI_SOURCE_DUPLICATE"
  /** Les deux extrémités d'un pont sont présentes et comptées. */
  | "BRIDGE_BOTH_SIDES"
  /** Un jeton et sa version encapsulée coexistent. */
  | "WRAP_DUPLICATE"
  /** L'ancienne et la nouvelle position d'une migration coexistent. */
  | "MIGRATION_LEFTOVER"
  /** Un NFT de position est déclaré deux fois. */
  | "NFT_POSITION_DUPLICATE";

export type Conflict = {
  kind: ConflictKind;
  /** Position à conserver — celle qui compte au patrimoine. */
  keepId: string;
  /** Position en doublon — à exclure des agrégats après revue. */
  duplicateId: string;
  reason: string;
};

/**
 * Paires (encapsulé, sous-jacent) reconnues.
 *
 * Table explicite plutôt que détection « intelligente » sur le préfixe : un `W`
 * initial ne signifie pas encapsulé — WIF et WLD sont des jetons à part
 * entière. Une table se corrige d'une ligne, une heuristique se trompe en
 * silence.
 *
 * Volontairement limitée aux cas où l'équivalence économique tient : `WETH`/`ETH`
 * est 1:1 par construction, `STETH`/`ETH` ne l'est pas (le stETH accumule du
 * rendement) mais représente la même exposition — ce qui est le critère
 * pertinent ici.
 */
const WRAPPED_EQUIVALENTS: Record<string, string> = {
  WETH: "ETH",
  WBTC: "BTC",
  WSOL: "SOL",
  WMATIC: "MATIC",
  WPOL: "POL",
  WAVAX: "AVAX",
  WBNB: "BNB",
  STETH: "ETH",
  WSTETH: "ETH",
  RETH: "ETH",
  CBETH: "ETH",
  SFRXETH: "ETH",
  FRXETH: "ETH",
  METH: "ETH",
  EZETH: "ETH",
  WEETH: "ETH",
  RSETH: "ETH",
  OSETH: "ETH",
  SWETH: "ETH",
  JITOSOL: "SOL",
  MSOL: "SOL",
  BSOL: "SOL",
  JUPSOL: "SOL",
};

/** Sous-jacent économique d'un jeton, ou le jeton lui-même. */
export function underlyingSymbol(symbol: string): string {
  const s = symbol.trim().toUpperCase();
  return WRAPPED_EQUIVALENTS[s] ?? s;
}

/** `true` quand les deux symboles représentent la même exposition économique. */
export function isSameExposure(a: string, b: string): boolean {
  return underlyingSymbol(a) === underlyingSymbol(b);
}

/**
 * Clé d'identité logique d'une position, indépendante de la source.
 *
 * Deux lignes qui produisent la même clé décrivent la même position vue par
 * deux fournisseurs — c'est ce qui permet de détecter qu'une saisie manuelle et
 * une synchronisation wallet parlent du même dépôt Aave.
 *
 * La chaîne et la version du protocole entrent dans la clé : un dépôt USDC sur
 * Aave V3 Ethereum et un dépôt USDC sur Aave V3 Arbitrum sont deux positions
 * distinctes, avec deux risques distincts.
 */
export function logicalPositionKey(p: DedupPosition): string {
  const proto = p.protocol.trim().toLowerCase().replace(/\s+/g, "-");
  const version = (p.protocolVersion || "").trim().toLowerCase();
  const chain = (p.chain || "?").trim().toLowerCase();
  const symbols = [...new Set(p.symbols.map(underlyingSymbol))].sort().join("+");
  return `${chain}|${proto}${version ? `@${version}` : ""}|${p.positionType}|${symbols}`;
}

/**
 * Priorité d'une origine de donnée lors d'un conflit.
 *
 * La saisie manuelle gagne : c'est une affirmation explicite de l'utilisateur,
 * et l'écraser par une synchronisation détruirait un travail délibéré (c'est
 * déjà la règle portée par `DefiPositionDetail.source`). Entre deux sources
 * automatiques, l'API de plateforme prime sur le scan de wallet — elle voit le
 * produit tel que la plateforme le comptabilise.
 */
const ORIGIN_PRIORITY: Record<string, number> = {
  MANUAL: 40,
  PLATFORM_API: 30,
  WALLET_SYNC: 20,
  CSV_IMPORT: 10,
};

function originPriority(origin: string): number {
  return ORIGIN_PRIORITY[origin] ?? 0;
}

function openedTime(p: DedupPosition): number | null {
  if (!p.openedAt) return null;
  const at = p.openedAt instanceof Date ? p.openedAt : new Date(p.openedAt);
  return Number.isNaN(at.getTime()) ? null : at.getTime();
}

/** Côté d'un pont qui porte la valeur — cf. commentaire à l'appel. */
function pickBridgeDestination(a: DedupPosition, b: DedupPosition): DedupPosition {
  const aActive = a.status === "ACTIVE";
  const bActive = b.status === "ACTIVE";
  if (aActive !== bActive) return aActive ? a : b;

  const aOpened = openedTime(a);
  const bOpened = openedTime(b);
  if (aOpened != null && bOpened != null && aOpened !== bOpened) {
    return aOpened > bOpened ? a : b;
  }

  return a.id.localeCompare(b.id) <= 0 ? a : b;
}

/**
 * Détecte les doublons entre positions.
 *
 * Ne modifie rien : renvoie la liste des conflits, à charge de l'appelant de
 * poser `conflictFlag` et de laisser l'utilisateur trancher. Les positions
 * fermées et liquidées sont ignorées — elles ne comptent déjà plus.
 */
export function detectDoubleCounting(positions: DedupPosition[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const live = positions.filter(
    (p) => p.status !== "CLOSED" && p.status !== "LIQUIDATED"
  );

  // ── 1. Même position vue par deux sources ────────────────────────────────
  // Regroupement par clé logique, pas par `providerKey` : deux fournisseurs
  // n'utilisent pas la même convention de clé, et une saisie manuelle n'en a
  // aucune. La clé logique est la seule comparable entre origines.
  const byLogicalKey = new Map<string, DedupPosition[]>();
  for (const p of live) {
    const key = logicalPositionKey(p);
    byLogicalKey.set(key, [...(byLogicalKey.get(key) ?? []), p]);
  }

  for (const [key, group] of byLogicalKey) {
    if (group.length < 2) continue;
    // Celle qu'on garde : priorité d'origine, puis la plus ancienne (id stable).
    const sorted = [...group].sort((a, b) => {
      const byOrigin = originPriority(b.dataOrigin) - originPriority(a.dataOrigin);
      return byOrigin !== 0 ? byOrigin : a.id.localeCompare(b.id);
    });
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      conflicts.push({
        kind: "MULTI_SOURCE_DUPLICATE",
        keepId: keep.id,
        duplicateId: dup.id,
        reason: `Même position (${key}) vue par ${dup.dataOrigin} et ${keep.dataOrigin} — seule la source ${keep.dataOrigin} est retenue`,
      });
    }
  }

  // ── 2. Deux extrémités d'un pont / d'une migration ───────────────────────
  // Le lien est explicite (`linkedPositionId`) : ce n'est pas une heuristique,
  // c'est le service de bridge qui l'a posé. Une seule extrémité doit compter,
  // sinon la valeur traverse le pont en se dupliquant.
  const byId = new Map(live.map((p) => [p.id, p]));
  const seenPairs = new Set<string>();

  for (const p of live) {
    if (!p.linkedPositionId) continue;
    const other = byId.get(p.linkedPositionId);
    if (!other) continue;

    const pairKey = [p.id, other.id].sort().join("~");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    // La destination porte la valeur aujourd'hui. Trois critères, du plus
    // fiable au plus arbitraire : un côté actif face à un côté qui ne l'est
    // pas, sinon la position ouverte le plus récemment, sinon l'identifiant —
    // ce dernier ne dit rien du métier mais garantit un résultat stable, là où
    // l'ordre du tableau ferait varier la réponse d'une lecture à l'autre.
    const keep = pickBridgeDestination(p, other);
    const dup = keep.id === p.id ? other : p;

    const sameChain = (p.chain || "") === (other.chain || "");
    conflicts.push({
      kind: sameChain ? "MIGRATION_LEFTOVER" : "BRIDGE_BOTH_SIDES",
      keepId: keep.id,
      duplicateId: dup.id,
      reason: sameChain
        ? `Migration de protocole : ${dup.protocol} a été remplacé par ${keep.protocol}, l'ancienne position ne doit plus compter`
        : `Pont ${dup.chain || "?"} → ${keep.chain || "?"} : la même valeur existe des deux côtés, seule la destination compte`,
    });
  }

  // ── 3. Jeton encapsulé et sous-jacent sur la même chaîne ─────────────────
  // Cas typique : un wallet détient ETH et WETH, et une position les déclare
  // tous deux comme exposition. Détecté seulement à protocole et chaîne
  // identiques — détenir de l'ETH natif et du stETH chez Lido est parfaitement
  // légitime, ce sont deux expositions réelles.
  const wrapGroups = new Map<string, DedupPosition[]>();
  for (const p of live) {
    if (p.positionType === "LP" || p.positionType === "CONCENTRATED_LIQUIDITY") continue;
    const chain = (p.chain || "?").toLowerCase();
    const proto = p.protocol.trim().toLowerCase();
    for (const sym of p.symbols) {
      const key = `${chain}|${proto}|${underlyingSymbol(sym)}`;
      wrapGroups.set(key, [...(wrapGroups.get(key) ?? []), p]);
    }
  }
  const reportedWrap = new Set<string>();
  for (const [key, group] of wrapGroups) {
    const unique = [...new Map(group.map((p) => [p.id, p])).values()];
    if (unique.length < 2) continue;
    // Les symboles doivent réellement différer : deux positions sur le même
    // symbole exact relèvent du cas 1, déjà traité.
    const rawSymbols = new Set(
      unique.flatMap((p) => p.symbols.map((s) => s.trim().toUpperCase()))
    );
    if (rawSymbols.size < 2) continue;

    const sorted = [...unique].sort((a, b) => a.id.localeCompare(b.id));
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      const pairKey = [keep.id, dup.id].sort().join("~");
      if (reportedWrap.has(pairKey) || seenPairs.has(pairKey)) continue;
      reportedWrap.add(pairKey);
      conflicts.push({
        kind: "WRAP_DUPLICATE",
        keepId: keep.id,
        duplicateId: dup.id,
        reason: `Jeton encapsulé et sous-jacent déclarés séparément sur ${key} — la même exposition est comptée deux fois`,
      });
    }
  }

  // ── 4. NFT de position déclaré deux fois ─────────────────────────────────
  // Une position concentrée Uniswap V3 est matérialisée par un NFT. Si ce NFT
  // est aussi déclaré dans le module NFT, sa valeur est comptée deux fois : une
  // fois par les jambes, une fois par le marché NFT.
  const byNft = new Map<string, DedupPosition[]>();
  for (const p of live) {
    if (!p.nftPositionRef) continue;
    const key = p.nftPositionRef.trim().toLowerCase();
    byNft.set(key, [...(byNft.get(key) ?? []), p]);
  }
  for (const [ref, group] of byNft) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const keep = sorted[0];
    for (const dup of sorted.slice(1)) {
      conflicts.push({
        kind: "NFT_POSITION_DUPLICATE",
        keepId: keep.id,
        duplicateId: dup.id,
        reason: `NFT de position ${ref} déclaré par deux positions — sa valeur vient des jambes, jamais du marché NFT`,
      });
    }
  }

  return conflicts;
}

/**
 * Identifiants à exclure des agrégats, d'après les conflits détectés.
 *
 * Une position peut être en doublon de plusieurs façons ; elle n'est exclue
 * qu'une fois. Ne jamais exclure une position qui est par ailleurs celle
 * retenue : dans une chaîne A→B→C, B est à la fois gardée et doublon, et
 * l'exclure viderait la chaîne.
 */
export function duplicateIdsToExclude(conflicts: Conflict[]): Set<string> {
  const keep = new Set(conflicts.map((c) => c.keepId));
  const exclude = new Set<string>();
  for (const c of conflicts) {
    if (!keep.has(c.duplicateId)) exclude.add(c.duplicateId);
  }
  return exclude;
}

/**
 * Vérifie qu'une position ne compte pas deux fois **en interne**.
 *
 * Complète `selectValuationLegs` : celui-ci écarte les doublons au moment de
 * valoriser, celle-ci les signale au moment de la saisie, pour qu'une position
 * mal décrite soit corrigée à la source plutôt que silencieusement rabotée.
 */
export function describeLegOverlap(
  legs: Array<{ legType: string; symbol: string }>
): string | null {
  const representative = legs.filter((l) => isRepresentativeLeg(l.legType));
  const exposures = legs.filter(
    (l) => l.legType === "ASSET" || l.legType === "UNDERLYING"
  );
  if (representative.length === 0 || exposures.length === 0) return null;

  // Un reçu qui représente le même jeton que le dépôt : c'est la forme normale
  // d'un staking liquide (déposer ETH, recevoir stETH). Ce n'est un problème
  // que si les deux sont valorisés — ce que `selectValuationLegs` empêche. On
  // le signale comme information, pas comme erreur bloquante.
  const overlapping = representative.filter((r) =>
    exposures.some((e) => isSameExposure(r.symbol, e.symbol))
  );
  if (overlapping.length === 0) return null;

  return `Jetons de reçu (${overlapping
    .map((r) => r.symbol)
    .join(", ")}) et dépôt correspondant présents : seule la représentation est valorisée`;
}

/**
 * Clé de déduplication d'un événement.
 *
 * Une re-synchronisation doit pouvoir rejouer les mêmes événements sans les
 * empiler. `txHash` seul ne suffit pas : une transaction qui retire deux jetons
 * d'une LP produit deux événements légitimes.
 */
export function eventDedupKey(e: {
  defiPositionId: string;
  txHash?: string | null;
  eventType: string;
  symbol?: string | null;
}): string {
  return [
    e.defiPositionId,
    e.txHash?.trim().toLowerCase() || "no-tx",
    e.eventType,
    e.symbol?.trim().toUpperCase() || "",
  ].join("|");
}
