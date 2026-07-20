import { prisma } from "../prisma";
import { createTransaction } from "../transactions/service";
import { resolveAssetLogo } from "../assets/logos";
import { assetReuseByTickerWhere } from "../assets/reuse";
import { resolveCoingeckoId } from "../market/providers/coingecko";
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

async function resolveOrCreateAsset(
  userId: string,
  platformId: string,
  row: ImportDraftRow
): Promise<string | null> {
  const needsAsset =
    row.type &&
    ["ACHAT", "VENTE", "REWARD", "AIRDROP", "DIVIDENDE", "COUPON", "LOYER"].includes(
      row.type
    );

  if (!needsAsset) return null;

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
    assetClass === "CRYPTO"
      ? "CRYPTO"
      : assetClass === "IMMOBILIER"
        ? "IMMOBILIER"
        : "CTO";

  if (ticker) {
    const byTicker = await prisma.asset.findFirst({
      where: assetReuseByTickerWhere(userId, ticker, accountType),
      orderBy: { createdAt: "asc" },
    });
    if (byTicker) return byTicker.id;
  }

  const byName = await prisma.asset.findFirst({
    where: {
      userId,
      platformId,
      name: { equals: name, mode: "insensitive" },
    },
  });
  if (byName) return byName.id;

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

  const created = await prisma.asset.create({
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

  return created.id;
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

      const assetId = await resolveOrCreateAsset(userId, rowPlatformId, row);
      await createTransaction({
        userId,
        type: row.type as TxType,
        platformId: rowPlatformId,
        assetId: assetId || null,
        quantity: row.quantity || undefined,
        unitPrice: row.unitPrice || undefined,
        cashAmount: row.cashAmount || undefined,
        fees: row.fees || "0",
        currency: row.currency || "EUR",
        fxRateToEur: "1",
        occurredAt: row.occurredAt || new Date().toISOString(),
        notes: row.notes
          ? `[Import CSV L${row.line}] ${row.notes}`
          : `[Import CSV L${row.line}]`,
        autoFundCash: true,
        allowNegativeCash: true,
      });
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
