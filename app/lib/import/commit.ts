import { prisma } from "../prisma";
import { createTransaction } from "../transactions/service";
import { resolveAssetLogo } from "../assets/logos";
import { assetReuseByTickerWhere } from "../assets/reuse";
import type { ImportDraftRow } from "./map-rows";
import type { TxType } from "../accounting/types";
import { AccountingError } from "../accounting";

export type CommitResult = {
  created: number;
  skipped: number;
  assetsCreated: number;
  errors: Array<{ line: number; message: string }>;
};

async function resolveOrCreateAsset(
  userId: string,
  platformId: string,
  row: ImportDraftRow
): Promise<string | null> {
  const needsAsset =
    row.type &&
    ["ACHAT", "VENTE", "DIVIDENDE", "COUPON", "LOYER"].includes(row.type);

  if (!needsAsset) return null;

  const ticker = row.ticker;
  const name = row.name || ticker || "Actif importé";

  const assetClass = row.assetClass || "ACTIONS";
  const priceProvider =
    assetClass === "CRYPTO" ? "COINGECKO" : assetClass === "ACTIONS" ? "YAHOO" : "MANUAL";
  const accountType =
    assetClass === "CRYPTO"
      ? "CRYPTO"
      : assetClass === "IMMOBILIER"
        ? "IMMOBILIER"
        : "CTO";

  if (ticker) {
    // Same ticker + envelope only — never mutate home platformId.
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
      providerSymbol: ticker || null,
      logoUrl: logoUrl || null,
    },
  });

  return created.id;
}

export async function commitImportRows(params: {
  userId: string;
  platformId: string;
  rows: ImportDraftRow[];
}): Promise<CommitResult> {
  const { userId, platformId } = params;

  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
  });
  if (!platform) {
    throw new AccountingError("PLATFORM_NOT_FOUND", "Plateforme introuvable");
  }

  // Sort chronological so CUMP / qty checks make sense
  const selected = params.rows
    .filter((r) => r.selected && r.status !== "error" && r.type)
    .filter((r) => r.type !== "TRANSFERT_CASH" && r.type !== "TRANSFERT_TITRE")
    .sort((a, b) => {
      const da = a.occurredAt ? new Date(a.occurredAt).getTime() : 0;
      const db = b.occurredAt ? new Date(b.occurredAt).getTime() : 0;
      return da - db;
    });

  let created = 0;
  let skipped = params.rows.length - selected.length;
  let assetsCreated = 0;
  const errors: Array<{ line: number; message: string }> = [];

  // Track known assets before import for count
  const assetCountBefore = await prisma.asset.count({ where: { userId } });

  for (const row of selected) {
    try {
      const assetId = await resolveOrCreateAsset(userId, platformId, row);
      const type = row.type as TxType;

      await createTransaction({
        userId,
        type,
        platformId,
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
  assetsCreated = Math.max(0, assetCountAfter - assetCountBefore);

  return { created, skipped, assetsCreated, errors };
}
