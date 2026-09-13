import { recordEnvelopeEvent } from "@/app/lib/securities/envelope-history";
import { prisma } from "../prisma";
import { Prisma } from "@/app/lib/prisma-client/client";
import { createTransaction, createOwnershipCache } from "../transactions/service";
import { loadLedgerForUser } from "../portfolio/service";
import { invalidateLedgerCache } from "../portfolio/ledger-cache";
import { resolveAssetLogo } from "../assets/logos";
import { assetReuseByTickerWhere } from "../assets/reuse";
import { detailRequirementError } from "../assets/envelope-requirements";
import { resolveCoingeckoId } from "../market/providers/coingecko";
import { fxRatesToEurRange, type FxRangeResult } from "../market/fx";
import { findOrCreatePlatform } from "../platforms/upsert";
import { resolvePlatformLogo } from "../platforms/presets";
import type { ImportDraftRow } from "./map-rows";
import type { TxType } from "../accounting/types";
import { AccountingError } from "../accounting";
import {
  buildEconomicFingerprint,
  buildStrictFingerprint,
  classifyAgainstExisting,
  indexExistingTransactions,
  type ExistingTxLite,
} from "./dedupe";

export type CreatedPlatformSummary = {
  id: string;
  name: string;
  logoUrl: string | null;
};

export type CommitResult = {
  created: number;
  skipped: number;
  duplicates: number;
  /** Doublons stricts auto-ignorés */
  strictDuplicates: number;
  assetsCreated: number;
  /** Plateformes créées automatiquement pendant l’import */
  platformsCreated: CreatedPlatformSummary[];
  errors: Array<{ line: number; message: string }>;
};

export type SuspectDuplicate = {
  line: number;
  draft: ImportDraftRow;
  existing: {
    id: string;
    type: string;
    occurredAt: string;
    quantity: string | null;
    unitPrice: string | null;
    fees: string;
    currency: string;
    ticker: string | null;
    notes: string | null;
  };
  deltaMs: number;
};

export type AnalyzeImportResult = {
  toCreate: ImportDraftRow[];
  strictSkipped: ImportDraftRow[];
  suspects: SuspectDuplicate[];
  totalSelected: number;
};

type ResolvedAsset = {
  id: string | null;
  /**
   * Clé de cache pour un Asset TOUT JUSTE créé dans la transaction de la
   * ligne en cours, encore non confirmée — voir commitImport (IMP-11).
   * L'appelant ne l'enregistre dans `assetCache` qu'après le commit réussi
   * de cette transaction, jamais avant.
   */
  pendingCacheKey?: string;
};

async function resolveOrCreateAsset(
  userId: string,
  platformId: string,
  row: ImportDraftRow,
  overrideAccountType?: string,
  /**
   * Cache d'actifs du lot. Un relevé courtier répète les mêmes quelques
   * tickers sur des centaines de lignes (111 lignes Revolut = 5 tickers) :
   * sans cache, chaque ligne refait les deux findFirst de résolution.
   */
  assetCache?: Map<string, string>,
  /**
   * Client Prisma optionnel — passer le `tx` de la transaction interactive qui
   * enveloppe la ligne (voir commitImport, IMP-11) pour que la création
   * éventuelle de l'Asset et son constat d'enveloppe fassent partie de LA
   * MÊME transaction que `createTransaction` : si celle-ci échoue ensuite,
   * Prisma annule aussi l'Asset créé ici — plus d'Asset orphelin en base.
   * Sans `tx`, repli sur le singleton `prisma` (comportement historique,
   * inchangé pour tout autre appelant).
   */
  tx?: Prisma.TransactionClient
): Promise<ResolvedAsset> {
  const db = tx ?? prisma;
  const needsAsset =
    row.type &&
    ["ACHAT", "VENTE", "REWARD", "AIRDROP", "DIVIDENDE", "COUPON", "LOYER"].includes(
      row.type
    );

  if (!needsAsset) return { id: null };

  const ticker = row.ticker;
  const name = row.name || ticker || "Actif importé";

  const assetClass = row.assetClass || "ACTIONS";
  const priceProvider =
    assetClass === "CRYPTO"
      ? "COINGECKO"
      : assetClass === "ACTIONS"
        ? "YAHOO"
        : "MANUAL";
  const accountType =
    overrideAccountType ||
    (assetClass === "CRYPTO"
      ? "CRYPTO"
      : assetClass === "IMMOBILIER"
        ? "IMMOBILIER"
        : "CTO");

  // Clé = tout ce dont dépend la résolution ci-dessous.
  const cacheKey = `${platformId}|${accountType}|${ticker ?? ""}|${name.toLowerCase()}`;
  const memo = assetCache?.get(cacheKey);
  if (memo) return { id: memo };

  // Réutilisation d'un Asset déjà en base : la ligne (findFirst) existe
  // indépendamment du sort de la transaction en cours, donc la mémoriser
  // immédiatement est sans risque.
  const remember = (id: string) => {
    assetCache?.set(cacheKey, id);
    return { id };
  };

  if (ticker) {
    const byTicker = await db.asset.findFirst({
      where: assetReuseByTickerWhere(userId, ticker, accountType),
      orderBy: { createdAt: "asc" },
    });
    if (byTicker) return remember(byTicker.id);
  }

  const byName = await db.asset.findFirst({
    where: {
      userId,
      platformId,
      name: { equals: name, mode: "insensitive" },
    },
  });
  if (byName) return remember(byName.id);

  /*
    Passé les réutilisations ci-dessus, l'actif est neuf — il ne peut donc
    porter aucune fiche métier. Le créer en IMMOBILIER le ferait peser au
    patrimoine et dans l'assiette IFI sans figurer dans aucun onglet du module,
    l'état dans lequel deux SCPI ont vécu.

    Un relevé ne dit jamais s'il s'agit d'un bien détenu en direct ou d'une part
    de société, et l'import n'a ni adresse ni société de gestion à inscrire :
    inventer l'une des deux fiches serait faux. La ligne est donc rejetée, et
    elle seule — la boucle d'appel collecte le message et poursuit le fichier.
  */
  const refus = detailRequirementError(accountType, {
    hasRealEstate: false,
    hasIndirectRealEstate: false,
  });
  if (refus) {
    throw new Error(
      `${refus} L'import ne peut pas créer « ${name} » : ajoutez-le d'abord depuis Immobilier, puis relancez l'import.`
    );
  }

  const logoUrl = resolveAssetLogo({
    ticker,
    name,
    assetClass,
  });

  // CRYPTO : stocker l’id CoinGecko quand connu (MON→monad), sinon ticker
  const providerSymbol =
    assetClass === "CRYPTO" && ticker
      ? resolveCoingeckoId(ticker) || ticker
      : ticker || null;

  /*
    Création et constat d'enveloppe dans la même transaction.

    La date retenue est celle de la **création de la ligne**, pas celle des
    opérations importées. Un fichier peut porter des transactions de 2023 sans
    rien dire de l'enveloppe qui les abritait alors : la déduire reviendrait à
    fabriquer un passé. Ce que l'import démontre, c'est qu'à l'instant de
    l'import la ligne est dans cette enveloppe — et c'est tout ce qui est
    enregistré.

    Limite assumée, et documentée : pour une ligne importée, les périodes
    antérieures à l'import restent inconnues, même si ses opérations sont
    anciennes.
  */
  const createAssetAndEnvelope = async (client: Prisma.TransactionClient) => {
    const asset = await client.asset.create({
      data: {
        userId,
        platformId,
        name,
        ticker: ticker || null,
        assetClass,
        currency: row.currency || "EUR",
        accountType,
        priceProvider,
        providerSymbol,
        logoUrl: logoUrl || null,
      },
    });

    await recordEnvelopeEvent(client, {
      assetId: asset.id,
      userId,
      kind: "OBSERVED",
      state: {
        accountType: asset.accountType,
        securitiesAccountId: asset.securitiesAccountId,
        envelopeType: null,
      },
      occurredAt: asset.createdAt,
    });

    return asset;
  };

  // Un `tx` fourni (ligne du lot, voir commitImport/IMP-11) EST déjà une
  // transaction interactive : y ouvrir un `prisma.$transaction` imbriqué
  // n'est pas supporté par Prisma. On écrit alors directement dedans — c'est
  // déjà atomique avec le `createTransaction` qui suit, dans le même `tx`.
  // Sans `tx` (autre appelant éventuel), on garde le `prisma.$transaction`
  // isolé d'origine.
  const created = tx
    ? await createAssetAndEnvelope(tx)
    : await prisma.$transaction(createAssetAndEnvelope);

  // Ne PAS `remember()` ici quand `tx` est fourni : cet Asset n'est validé
  // qu'au commit de la transaction englobante (voir commitImport, IMP-11) —
  // si `createTransaction` échoue ensuite et fait tout annuler, un
  // `assetCache.set` immédiat laisserait un id d'Asset fantôme (rollback) dans
  // le cache du lot, que la ligne suivante avec le même ticker réutiliserait
  // à tort. Le cacheKey est rendu à l'appelant, qui ne le mémorise qu'après
  // succès confirmé de la transaction.
  return tx ? { id: created.id, pendingCacheKey: cacheKey } : remember(created.id);
}

async function loadExistingLite(
  userId: string,
  platformId?: string | null
): Promise<Array<ExistingTxLite & { platformId: string }>> {
  const existing = await prisma.transaction.findMany({
    where: platformId ? { userId, platformId } : { userId },
    select: {
      id: true,
      platformId: true,
      type: true,
      occurredAt: true,
      quantity: true,
      unitPrice: true,
      fees: true,
      currency: true,
      netCashImpactEur: true,
      notes: true,
      asset: { select: { ticker: true } },
    },
  });

  return existing.map((tx) => ({
    id: tx.id,
    platformId: tx.platformId,
    type: tx.type,
    occurredAt: tx.occurredAt,
    quantity: tx.quantity?.toString() ?? null,
    unitPrice: tx.unitPrice?.toString() ?? null,
    fees: tx.fees.toString(),
    currency: tx.currency,
    netCashImpactEur: tx.netCashImpactEur.toString(),
    ticker: tx.asset?.ticker ?? null,
    notes: tx.notes,
  }));
}

/**
 * Résout l’id plateforme pour une ligne (nom CSV → findOrCreate, sinon défaut).
 * Cache process-local + liste des créations.
 */
async function resolveRowPlatformId(
  userId: string,
  defaultPlatformId: string,
  row: ImportDraftRow,
  cache: Map<string, string>,
  created: CreatedPlatformSummary[]
): Promise<string> {
  const raw = row.platformName?.trim();
  if (!raw) return defaultPlatformId;

  const key = raw.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;

  const { platform, created: isNew } = await findOrCreatePlatform(userId, {
    name: raw,
  });
  cache.set(key, platform.id);
  // Aussi index par id pour éviter re-create
  cache.set(platform.id, platform.id);
  if (isNew) {
    created.push({
      id: platform.id,
      name: platform.name,
      logoUrl: resolvePlatformLogo({
        logoKey: platform.logoKey,
        logoUrl: platform.logoUrl,
        name: platform.name,
      }),
    });
  }
  return platform.id;
}

/** Jour civil (YYYY-MM-DD) décalé de `deltaDays`, en UTC — jamais une approximation en 365 jours. */
function shiftDay(day: string, deltaDays: number): string {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

/**
 * Stablecoins adossés au dollar sans série BCE propre — Frankfurter ne les
 * connaît pas, et USDT/USDC n'ont vocation qu'à suivre l'USD. La ligne garde
 * sa devise réelle (`Transaction.currency` reste "USDT"/"USDC", cf.
 * `map-rows.ts` qui ne les tronque plus en "USD") ; seule la *série* utilisée
 * pour résoudre un taux est celle du dollar — une conversion dédiée, pas un
 * dollar déguisé.
 *
 * Ce que ceci ne fait PAS : détecter un dépeg (USDC est brièvement tombé sous
 * 0,88 USD en mars 2023). Aucune source de prix spot n'est disponible dans ce
 * pipeline d'import synchrone — l'ajouter dépasserait ce correctif ponctuel.
 * Documenté, pas caché.
 */
const FX_SERIES_ALIAS: Record<string, string> = { USDT: "USD", USDC: "USD" };
function fxSeriesCurrency(cur: string): string {
  return FX_SERIES_ALIAS[cur] ?? cur;
}

/**
 * Taux de change à persister pour CETTE ligne d'import.
 *
 * EUR : "1", sans appel. Toute autre devise : cherche dans la série
 * pré-résolue pour le lot (`fxByCurrency`, un appel Frankfurter par devise,
 * jamais par ligne) le dernier jour de fixing BCE ≤ jour de la ligne, en
 * remontant au plus 7 jours civils (couvre les week-ends et jours fériés
 * BCE — le plus long trou constaté est Pâques, 4 jours).
 *
 * Ne fabrique jamais de taux : date manquante, devise hors série, plage
 * indisponible ou trou de plus de 7 jours rejettent la ligne (l'appelant
 * capture l'erreur et l'ajoute à `errors[]`).
 */
function resolveRowFxRate(
  row: ImportDraftRow,
  fxByCurrency: Map<string, FxRangeResult>
): string {
  const cur = (row.currency || "EUR").toUpperCase();
  if (cur === "EUR") return "1";

  const day = row.occurredAt ? row.occurredAt.slice(0, 10) : null;
  if (!day) {
    throw new Error(
      `Devise ${cur} : date de l'opération manquante — ligne non importée, aucun taux n'a été supposé. Saisissez cette opération manuellement avec son taux de change.`
    );
  }

  const range = fxByCurrency.get(fxSeriesCurrency(cur));
  if (!range || range.status === "unsupported") {
    throw new Error(
      `Devise ${cur} : aucune série de taux BCE (Frankfurter) — ligne non importée, aucun taux n'a été supposé. Saisissez cette opération manuellement avec son taux de change.`
    );
  }
  if (range.status === "unavailable") {
    throw new Error(
      `Fournisseur de taux (Frankfurter/BCE) injoignable — ligne non importée, aucun taux n'a été supposé. Relancez l'import plus tard.`
    );
  }

  for (let back = 0; back <= 7; back++) {
    const candidate = shiftDay(day, -back);
    const rate = range.byDay.get(candidate);
    if (rate) return rate;
  }

  throw new Error(
    `Taux ${cur}→EUR du ${day} introuvable dans la série BCE (Frankfurter) — ligne non importée, aucun taux n'a été supposé. Saisissez cette opération manuellement avec son taux de change.`
  );
}

function draftToInput(platformId: string, row: ImportDraftRow) {
  return {
    platformId,
    type: row.type || "",
    occurredAt: row.occurredAt,
    ticker: row.ticker,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    cashAmount: row.cashAmount,
    fees: row.fees,
    currency: row.currency,
  };
}

/**
 * Classe les lignes sélectionnées : créables / stricts / suspects.
 * Ne crée rien — pour l’UI d’arbitrage.
 */
export async function analyzeImportDuplicates(params: {
  userId: string;
  platformId: string;
  rows: ImportDraftRow[];
  /** Cache optionnel (partagé avec commit pour upserts) */
  platformCache?: Map<string, string>;
  platformsCreated?: CreatedPlatformSummary[];
}): Promise<AnalyzeImportResult> {
  const { userId, platformId } = params;
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
  });
  if (!platform) {
    throw new AccountingError("PLATFORM_NOT_FOUND", "Plateforme introuvable");
  }

  const selected = params.rows
    .filter((r) => r.selected && r.status !== "error" && r.type)
    .filter((r) => r.type !== "TRANSFERT_CASH" && r.type !== "TRANSFERT_TITRE")
    .sort((a, b) => {
      const da = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const db = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return da - db;
    });

  const cache = params.platformCache ?? new Map<string, string>();
  cache.set(platform.name.toLowerCase(), platform.id);
  const createdList = params.platformsCreated ?? [];

  // Multi-plateforme : charger tout le journal user pour un index correct
  const hasPerRowPlatform = selected.some((r) => r.platformName?.trim());
  const existing = await loadExistingLite(
    userId,
    hasPerRowPlatform ? null : platformId
  );
  // Index multi-plateforme : chaque tx avec son platformId réel
  const byStrict = new Map<string, ExistingTxLite>();
  const byEconomic = new Map<string, ExistingTxLite[]>();
  for (const tx of existing) {
    const pid = tx.platformId;
    const { byStrict: s, byEconomic: e } = indexExistingTransactions(pid, [tx]);
    for (const [k, v] of s) byStrict.set(k, v);
    for (const [k, list] of e) {
      const cur = byEconomic.get(k) || [];
      cur.push(...list);
      byEconomic.set(k, cur);
    }
  }

  const toCreate: ImportDraftRow[] = [];
  const strictSkipped: ImportDraftRow[] = [];
  const suspects: SuspectDuplicate[] = [];
  const seenStrict = new Set<string>(byStrict.keys());
  const seenEcoInFile = new Map<string, number>(); // eco+minute → first line

  for (const row of selected) {
    const rowPlatformId = await resolveRowPlatformId(
      userId,
      platformId,
      row,
      cache,
      createdList
    );
    const input = draftToInput(rowPlatformId, row);
    const strictFp = buildStrictFingerprint(input);
    const ecoFp = buildEconomicFingerprint(input);

    // Doublon dans le même fichier (strict)
    if (seenStrict.has(strictFp)) {
      strictSkipped.push(row);
      continue;
    }

    const match = classifyAgainstExisting(input, byStrict, byEconomic);
    if (match?.kind === "strict") {
      strictSkipped.push(row);
      seenStrict.add(strictFp);
      continue;
    }
    if (match?.kind === "suspect") {
      suspects.push({
        line: row.line,
        draft: row,
        existing: {
          id: match.existing.id,
          type: match.existing.type,
          occurredAt:
            match.existing.occurredAt instanceof Date
              ? match.existing.occurredAt.toISOString()
              : String(match.existing.occurredAt),
          quantity: match.existing.quantity,
          unitPrice: match.existing.unitPrice,
          fees: match.existing.fees,
          currency: match.existing.currency,
          ticker: match.existing.ticker,
          notes: match.existing.notes ?? null,
        },
        deltaMs: match.deltaMs,
      });
      continue;
    }

    // Suspect intra-fichier (même économie, autre seconde dans la tolérance)
    const fileKey = `${ecoFp}\u001f${row.occurredAt?.slice(0, 16) || ""}`;
    if (seenEcoInFile.has(fileKey)) {
      // treat as strict-ish skip within file same minute
      strictSkipped.push(row);
      continue;
    }

    seenStrict.add(strictFp);
    seenEcoInFile.set(fileKey, row.line);
    toCreate.push(row);
  }

  return {
    toCreate,
    strictSkipped,
    suspects,
    totalSelected: selected.length,
  };
}

export async function commitImportRows(params: {
  userId: string;
  platformId: string;
  rows: ImportDraftRow[];
  skipDuplicates?: boolean;
  /**
   * Lignes « suspectes » que l’utilisateur a explicitement acceptées
   * (n° de ligne CSV).
   */
  acceptSuspectLines?: number[];
  /**
   * Si true, n’importe pas les suspects non listés dans acceptSuspectLines.
   * Si false (legacy), comportement analyse + import direct sans UI.
   */
  requireSuspectDecision?: boolean;
  /** Enveloppe fiscale à appliquer (CTO, PEA, AV, CFD) */
  accountEnvelopeType?: string;
}): Promise<CommitResult> {
  const { userId, platformId } = params;
  const skipDuplicates = params.skipDuplicates !== false;
  const acceptSet = new Set(params.acceptSuspectLines || []);
  const requireDecision = params.requireSuspectDecision === true;

  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
  });
  if (!platform) {
    throw new AccountingError("PLATFORM_NOT_FOUND", "Plateforme introuvable");
  }

  const selectedBase = params.rows.filter(
    (r) =>
      r.selected &&
      r.status !== "error" &&
      r.type &&
      r.type !== "TRANSFERT_CASH" &&
      r.type !== "TRANSFERT_TITRE"
  );

  const platformCache = new Map<string, string>();
  platformCache.set(platform.name.toLowerCase(), platform.id);
  const platformsCreated: CreatedPlatformSummary[] = [];

  const analysis = skipDuplicates
    ? await analyzeImportDuplicates({
        userId,
        platformId,
        rows: params.rows,
        platformCache,
        platformsCreated,
      })
    : {
        toCreate: selectedBase,
        strictSkipped: [] as ImportDraftRow[],
        suspects: [] as SuspectDuplicate[],
        totalSelected: selectedBase.length,
      };

  const toImport = [...analysis.toCreate];
  if (requireDecision) {
    for (const s of analysis.suspects) {
      if (acceptSet.has(s.line)) toImport.push(s.draft);
    }
  } else {
    // Sans UI : n’auto-importe pas les suspects (sécurité) — seulement les clairs
    // (déjà dans toCreate). Stricts déjà exclus.
  }

  toImport.sort((a, b) => {
    const da = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
    const db = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
    return da - db;
  });

  /*
    Pré-résolution FX du lot : un seul appel Frankfurter par devise étrangère
    présente dans `toImport`, jamais un par ligne — cf. `maxDuration = 60` sur
    la route commit, budget que dépasserait un relevé de plusieurs centaines
    de lignes en appels séquentiels.
  */
  const fxByCurrency = new Map<string, FxRangeResult>();
  {
    const daysByCurrency = new Map<string, { min: string; max: string }>();
    for (const row of toImport) {
      const cur = (row.currency || "EUR").toUpperCase();
      if (cur === "EUR") continue;
      const day = row.occurredAt ? row.occurredAt.slice(0, 10) : null;
      if (!day) continue; // rejeté ligne par ligne dans resolveRowFxRate
      // USDT/USDC partagent la série USD (`fxSeriesCurrency`) : un seul appel
      // Frankfurter pour les trois, pas un par devise affichée.
      const seriesCur = fxSeriesCurrency(cur);
      const bounds = daysByCurrency.get(seriesCur);
      if (!bounds) {
        daysByCurrency.set(seriesCur, { min: day, max: day });
      } else {
        if (day < bounds.min) bounds.min = day;
        if (day > bounds.max) bounds.max = day;
      }
    }
    for (const [cur, bounds] of daysByCurrency) {
      const fromDay = shiftDay(bounds.min, -7);
      fxByCurrency.set(cur, await fxRatesToEurRange(cur, fromDay, bounds.max));
    }
  }

  let created = 0;
  let duplicates = analysis.strictSkipped.length;
  if (requireDecision) {
    duplicates += analysis.suspects.filter((s) => !acceptSet.has(s.line)).length;
  } else {
    duplicates += analysis.suspects.length;
  }
  let skipped = params.rows.length - analysis.totalSelected + duplicates;
  const strictDuplicates = analysis.strictSkipped.length;
  const errors: Array<{ line: number; message: string }> = [];

  const assetCountBefore = await prisma.asset.count({ where: { userId } });
  const seenStrict = new Set<string>();

  // État de ledger chargé une seule fois et mis à jour en place au fil des
  // lignes (voir createTransaction/service.ts) — sans ça, invalider le cache
  // après chaque insertion force un replay complet du journal à CHAQUE ligne,
  // en O(n²) sur un CSV de plusieurs centaines de lignes (timeout serverless).
  const ledgerState = await loadLedgerForUser(userId);
  // Mémos du lot : évitent de revérifier en base, à chaque ligne, la même
  // plateforme et les mêmes tickers (cf. OwnershipCache / resolveOrCreateAsset).
  const ownership = createOwnershipCache(userId);
  const assetCache = new Map<string, string>();

  for (const row of toImport) {
    try {
      const rowPlatformId = await resolveRowPlatformId(
        userId,
        platformId,
        row,
        platformCache,
        platformsCreated
      );
      const input = draftToInput(rowPlatformId, row);
      const sfp = buildStrictFingerprint(input);
      if (seenStrict.has(sfp)) {
        duplicates += 1;
        skipped += 1;
        continue;
      }

      const rowFxRateToEur = resolveRowFxRate(row, fxByCurrency);

      // IMP-11 : `resolveOrCreateAsset` (création d'Asset possible) et
      // `createTransaction` de CETTE ligne partagent maintenant une seule
      // transaction Prisma. Si `createTransaction` échoue (ex. FX_RATE_UNKNOWN),
      // Prisma annule aussi l'Asset créé juste avant — plus d'Asset orphelin.
      // `ledgerState` reste le cache en mémoire du lot (IMP-04) : passé à
      // `createTransaction` via `opts.ledgerState`, il prime désormais sur la
      // présence de `tx` (voir service.ts) et n'est publié dans l'état partagé
      // qu'après le commit réussi de CETTE ligne — un rollback ne le corrompt
      // donc pas pour la ligne suivante.
      let pendingAssetCacheEntry: { key: string; id: string } | undefined;
      await prisma.$transaction(async (tx) => {
        const resolved = await resolveOrCreateAsset(
          userId,
          rowPlatformId,
          row,
          params.accountEnvelopeType,
          assetCache,
          tx
        );
        if (resolved.pendingCacheKey && resolved.id) {
          pendingAssetCacheEntry = { key: resolved.pendingCacheKey, id: resolved.id };
        }
        await createTransaction(
          {
            userId,
            type: row.type as TxType,
            platformId: rowPlatformId,
            assetId: resolved.id || null,
            quantity: row.quantity || undefined,
            unitPrice: row.unitPrice || undefined,
            cashAmount: row.cashAmount || undefined,
            fees: row.fees || "0",
            currency: row.currency || "EUR",
            fxRateToEur: rowFxRateToEur,
            occurredAt: row.occurredAt || new Date().toISOString(),
            notes: row.notes
              ? `[Import CSV L${row.line}] ${row.notes}`
              : `[Import CSV L${row.line}]`,
            autoFundCash: true,
            allowNegativeCash: true,
          },
          tx,
          { ledgerState, skipInvalidate: true, ownership }
        );
      });
      // Transaction de la ligne commitée avec succès (aucune exception levée
      // jusqu'ici) : c'est seulement maintenant qu'un Asset tout juste créé
      // (voir ResolvedAsset.pendingCacheKey) devient sûr à mémoriser pour les
      // lignes suivantes du même lot — avant ce point, un rollback l'aurait
      // rendu fantôme.
      if (pendingAssetCacheEntry) {
        assetCache.set(pendingAssetCacheEntry.key, pendingAssetCacheEntry.id);
      }
      seenStrict.add(sfp);
      created++;
    } catch (e) {
      const message =
        e instanceof AccountingError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Erreur inconnue";
      errors.push({ line: row.line, message });
      skipped++;
    }
  }

  if (created > 0) {
    invalidateLedgerCache(userId);
  }

  const assetCountAfter = await prisma.asset.count({ where: { userId } });
  const assetsCreated = Math.max(0, assetCountAfter - assetCountBefore);

  // Dédupliquer platformsCreated par id
  const seenPlat = new Set<string>();
  const uniquePlatforms = platformsCreated.filter((p) => {
    if (seenPlat.has(p.id)) return false;
    seenPlat.add(p.id);
    return true;
  });

  return {
    created,
    skipped,
    duplicates,
    strictDuplicates,
    assetsCreated,
    platformsCreated: uniquePlatforms,
    errors,
  };
}
