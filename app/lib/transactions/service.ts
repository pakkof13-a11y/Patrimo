import { prisma } from "../prisma";
import { d, toFixed } from "../money/decimal";
import { normalizeFxRate } from "../accounting/fx";
import {
  AccountingError,
  applyTransaction,
  computeNetCashImpactEur,
  createEmptyLedger,
  replayTransactions,
  type LedgerState,
  type LedgerTx,
  type TxType,
} from "../accounting";
import type { createTransactionSchema } from "../schemas";
import type { z } from "zod";
import { Prisma } from "@/app/lib/prisma-client/client";
import {
  fxRateToEur as liveFxToEur,
  fxRateToEurOnDate,
} from "../market/fx";
import { resolveWhtRate } from "../tax/withholding";
import { loadLedgerForUser } from "../portfolio/service";

/** Client Prisma générique — singleton global ou `tx` d'une transaction interactive. */
type DbClient = Prisma.TransactionClient;

export type CreateTxInput = z.infer<typeof createTransactionSchema> & {
  userId: string;
  autoFundCash?: boolean;
  allowNegativeCash?: boolean;
};
export type UpdateTxInput = CreateTxInput & { id: string };

function toLedgerTx(
  id: string,
  input: CreateTxInput,
  occurredAt: Date,
  whtRate?: number | null
): LedgerTx {
  const fx = normalizeFxRate(input.fxRateToEur ?? "1");
  const fees = d(input.fees ?? "0");
  const quantity = input.quantity ? d(input.quantity) : null;
  const unitPrice = input.unitPrice ? d(input.unitPrice) : null;
  const cashAmount = input.cashAmount ? d(input.cashAmount) : null;

  return {
    id,
    type: input.type as TxType,
    platformId: input.platformId,
    toPlatformId: input.toPlatformId,
    assetId: input.assetId || null,
    quantity,
    unitPrice,
    fees,
    currency: (input.currency ?? "EUR").toUpperCase(),
    fxRateToEur: fx,
    cashAmountOriginal: cashAmount,
    grossOriginal: quantity && unitPrice ? quantity.times(unitPrice) : cashAmount,
    withholdingTaxRate:
      whtRate != null && whtRate > 0 ? d(String(whtRate)) : null,
    occurredAt,
    allowNegativeCash: Boolean(input.allowNegativeCash),
  };
}

async function resolveIncomeWhtRate(
  input: CreateTxInput,
  client: DbClient = prisma
): Promise<number> {
  if (
    !["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(input.type)
  ) {
    return 0;
  }
  let countryCode: string | null = null;
  let assetRate: string | null = null;
  if (input.assetId) {
    const asset = await client.asset.findFirst({
      where: { id: input.assetId, userId: input.userId },
      select: { countryCode: true, withholdingTaxRate: true, accountType: true },
    });
    countryCode = asset?.countryCode ?? null;
    assetRate = asset?.withholdingTaxRate?.toString() ?? null;
  }
  return resolveWhtRate({
    countryCode,
    assetWithholdingTaxRate: assetRate,
    txWithholdingTaxRate: input.withholdingTaxRate,
  });
}

function mapExisting(row: {
  id: string;
  type: string;
  platformId: string;
  toPlatformId: string | null;
  assetId: string | null;
  quantity: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
  fees: Prisma.Decimal;
  currency: string;
  fxRateToEur: Prisma.Decimal;
  grossAmountEur: Prisma.Decimal;
  withholdingTaxEur?: Prisma.Decimal | null;
  withholdingTaxRate?: Prisma.Decimal | null;
  occurredAt: Date;
}): LedgerTx {
  const qty = row.quantity ? d(row.quantity.toString()) : null;
  const unit = row.unitPrice ? d(row.unitPrice.toString()) : null;
  const fx = d(row.fxRateToEur.toString());
  const grossEur = d(row.grossAmountEur.toString());
  const cashAmountOriginal =
    qty && unit ? qty.times(unit) : fx.isZero() ? grossEur : grossEur.div(fx);

  return {
    id: row.id,
    type: row.type as TxType,
    platformId: row.platformId,
    toPlatformId: row.toPlatformId,
    assetId: row.assetId,
    quantity: qty,
    unitPrice: unit,
    fees: d(row.fees.toString()),
    currency: row.currency,
    fxRateToEur: fx,
    cashAmountOriginal,
    grossOriginal: qty && unit ? qty.times(unit) : null,
    withholdingTaxEur: row.withholdingTaxEur
      ? d(row.withholdingTaxEur.toString())
      : null,
    withholdingTaxRate: row.withholdingTaxRate
      ? d(row.withholdingTaxRate.toString())
      : null,
    occurredAt: row.occurredAt,
  };
}

/**
 * Mémo des appartenances déjà vérifiées pour UN utilisateur, sur la durée d'un
 * lot (import CSV). Un import répète la même plateforme et les mêmes quelques
 * tickers sur des centaines de lignes : revérifier à chaque ligne coûte un
 * aller-retour SQL pour un résultat déjà connu.
 *
 * L'isolation multi-tenant est préservée : le cache porte son `userId`, n'est
 * consulté que pour ce même userId, et ne vit que le temps d'un appel.
 * Une entrée signifie « cet id appartient bien à cet utilisateur, vérifié en
 * base plus tôt dans ce même lot » — jamais « non vérifié, on laisse passer ».
 */
export type OwnershipCache = {
  userId: string;
  platforms: Set<string>;
  assets: Set<string>;
};

export function createOwnershipCache(userId: string): OwnershipCache {
  return { userId, platforms: new Set(), assets: new Set() };
}

async function validateOwnership(
  input: CreateTxInput,
  client: DbClient = prisma,
  cache?: OwnershipCache
) {
  // Le cache n'est utilisable que s'il a été constitué pour CE utilisateur.
  const memo = cache && cache.userId === input.userId ? cache : null;

  if (!memo?.platforms.has(input.platformId)) {
    const platform = await client.platform.findFirst({
      where: { id: input.platformId, userId: input.userId },
    });
    if (!platform) throw new AccountingError("PLATFORM_NOT_FOUND", "Plateforme introuvable");
    memo?.platforms.add(input.platformId);
  }

  if (input.toPlatformId && !memo?.platforms.has(input.toPlatformId)) {
    const to = await client.platform.findFirst({
      where: { id: input.toPlatformId, userId: input.userId },
    });
    if (!to) throw new AccountingError("TO_PLATFORM_NOT_FOUND", "Plateforme de destination introuvable");
    memo?.platforms.add(input.toPlatformId);
  }

  if (input.assetId && !memo?.assets.has(input.assetId)) {
    const asset = await client.asset.findFirst({
      where: { id: input.assetId, userId: input.userId },
    });
    if (!asset) throw new AccountingError("ASSET_NOT_FOUND", "Actif introuvable");
    memo?.assets.add(input.assetId);
  }
}

async function resolveFx(input: CreateTxInput): Promise<CreateTxInput> {
  const currency = (input.currency ?? "EUR").toUpperCase();
  if (currency === "EUR") {
    return { ...input, currency, fxRateToEur: "1" };
  }
  const provided = input.fxRateToEur ? d(input.fxRateToEur) : d(1);
  // Revenus : taux historique à la payment date (ou occurredAt)
  const isIncome = ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(
    input.type
  );
  const forceHistorical =
    isIncome &&
    (provided.eq(1) || !input.fxRateToEur || input.fxRateToEur === "");

  if (forceHistorical) {
    const pay = input.paymentDate || input.occurredAt;
    const hist = await fxRateToEurOnDate(currency, pay);
    /*
      Taux historique introuvable : on refuse l'écriture.

      Les deux replis d'avant — taux du jour, puis aucun taux, ce qui vaut 1 —
      produisaient un `fxRateToEur` inventé, et `grossAmountEur` en découlait.
      Une fois en base, rien ne distinguait plus ce montant d'un montant
      constaté : la donnée était corrompue durablement et en silence.

      `Transaction.fxRateToEur` est un `Decimal @default(1)` non nullable, et
      `grossAmountEur` est requis : le modèle ne sait pas représenter « taux
      inconnu ». Tant que c'est le cas, ne rien écrire est la seule option qui
      ne mente pas. L'appelant reçoit une erreur explicite et peut fournir le
      taux lui-même — un taux saisi reste prioritaire et n'emprunte pas ce
      chemin.
    */
    if (hist == null) {
      throw new AccountingError(
        "FX_RATE_UNKNOWN",
        `Taux historique ${currency}→EUR indisponible pour le ${String(pay).slice(0, 10)} : ` +
          "renseignez-le manuellement plutôt que d'enregistrer un montant converti à un taux non constaté."
      );
    }
    return { ...input, currency, fxRateToEur: hist };
  }

  if (provided.eq(1) && currency !== "EUR") {
    /*
      Devise étrangère sans taux fourni : on demande le taux courant.

      `fxRateToEur` applique la politique décidée en B1 — taux du fournisseur,
      derniers taux réels si la panne est récente, table déclarée au-delà. Ce
      repli est assumé et reste valide : il décrit une approximation du jour,
      pas une valeur inventée pour une date passée.

      Ce qui ne l'était pas, c'est cette branche de secours. Elle rendait
      `{ ...input, currency }`, donc sans `fxRateToEur`, et la construction des
      données retombait sur le `Decimal @default(1)` du modèle : un dollar
      valait un euro, écrit comme un fait, pour la seule raison que le
      fournisseur n'avait pas répondu. Même doctrine qu'en A1 — un taux
      inconnu n'est ni zéro, ni un.
    */
    let live: string;
    try {
      live = await liveFxToEur(currency);
    } catch {
      throw new AccountingError(
        "FX_RATE_UNKNOWN",
        `Taux de conversion ${currency}→EUR indisponible : ` +
          "renseignez-le manuellement plutôt que d'enregistrer un montant converti à un taux non constaté."
      );
    }
    return { ...input, currency, fxRateToEur: live };
  }
  return { ...input, currency };
}

function buildPrismaData(
  input: CreateTxInput,
  occurredAt: Date,
  amounts: ReturnType<typeof computeNetCashImpactEur>,
  wht?: { rate: number; eur: number }
) {
  const paymentDate = input.paymentDate
    ? new Date(input.paymentDate)
    : occurredAt;
  const exDate = input.exDate ? new Date(input.exDate) : null;

  return {
    type: input.type,
    platformId: input.platformId,
    toPlatformId: input.toPlatformId || null,
    assetId: input.assetId || null,
    quantity: input.quantity ? new Prisma.Decimal(toFixed(d(input.quantity), 12)) : null,
    unitPrice: input.unitPrice ? new Prisma.Decimal(toFixed(d(input.unitPrice), 12)) : null,
    fees: new Prisma.Decimal(toFixed(d(input.fees ?? "0"), 12)),
    currency: (input.currency ?? "EUR").toUpperCase(),
    fxRateToEur: new Prisma.Decimal(toFixed(normalizeFxRate(input.fxRateToEur ?? "1"), 10)),
    grossAmountEur: new Prisma.Decimal(toFixed(amounts.grossAmountEur, 12)),
    feesEur: new Prisma.Decimal(toFixed(amounts.feesEur, 12)),
    netCashImpactEur: new Prisma.Decimal(toFixed(amounts.netCashImpactEur, 12)),
    withholdingTaxEur: new Prisma.Decimal(
      toFixed(d(wht?.eur ?? 0), 12)
    ),
    withholdingTaxRate:
      wht && wht.rate > 0
        ? new Prisma.Decimal(toFixed(d(wht.rate), 6))
        : null,
    exDate:
      exDate && !Number.isNaN(exDate.getTime()) ? exDate : null,
    paymentDate:
      paymentDate && !Number.isNaN(paymentDate.getTime())
        ? paymentDate
        : occurredAt,
    occurredAt,
    notes: input.notes || null,
  };
}

function validateLedger(
  existing: LedgerTx[],
  pending?: LedgerTx | LedgerTx[],
  excludeId?: string,
  allowNegativeCash?: boolean
) {
  const base = existing.filter((t) => t.id !== excludeId);
  const extra = pending ? (Array.isArray(pending) ? pending : [pending]) : [];
  const all = [...base, ...extra];
  const soft = Boolean(allowNegativeCash);

  // Aligné sur loadLedgerForUser : un journal seed/import peut contenir
  // des VENTE > stock. Sans clamp, TOUTE nouvelle écriture (REWARD wallet,
  // ACHAT Zerion…) échoue alors que le dashboard lit le ledger en mode soft.
  try {
    replayTransactions(all, { allowNegativeCash: soft });
  } catch (strictErr) {
    try {
      replayTransactions(all, {
        allowNegativeCash: true,
        clampOversell: true,
      });
    } catch {
      // Re-lancer l’erreur stricte d’origine (plus informative)
      throw strictErr;
    }
  }
}

function cloneLedgerState(state: LedgerState): LedgerState {
  return {
    positions: new Map(state.positions),
    cashByPlatform: new Map(state.cashByPlatform),
    realizedLots: [...state.realizedLots],
    cashIncomeEur: state.cashIncomeEur,
    totalFeesPaidEur: state.totalFeesPaidEur,
  };
}

/**
 * Valide une nouvelle transaction en l'appliquant sur une COPIE d'un ledger
 * déjà calculé (loadLedgerForUser, caché par fingerprint) plutôt que de
 * refaire un `findMany` + replay complet du journal à chaque écriture.
 * Même sémantique double-tentative (stricte puis permissive) que `validateLedger`.
 */
function validateLedgerIncremental(
  state: LedgerState,
  pending: LedgerTx,
  allowNegativeCash?: boolean
): LedgerState {
  const soft = Boolean(allowNegativeCash);
  try {
    return applyTransaction(cloneLedgerState(state), pending, { allowNegativeCash: soft });
  } catch (strictErr) {
    try {
      return applyTransaction(cloneLedgerState(state), pending, {
        allowNegativeCash: true,
        clampOversell: true,
      });
    } catch {
      // Re-lancer l’erreur stricte d’origine (plus informative)
      throw strictErr;
    }
  }
}

/**
 * Asset.platformId is home/display only. Positions live on (assetId × platformId)
 * via the ledger — never rewrite home platform when trading elsewhere.
 */

export async function createTransaction(
  raw: CreateTxInput,
  /**
   * Client Prisma optionnel — passer le `tx` d'une transaction interactive
   * (ex. exécution SL/TP, voir market/triggers.ts) pour que toutes les
   * lectures/écritures de cette création partagent les garanties d'isolation
   * de cette transaction. Sans `prismaClient`, utilise le singleton global
   * et le cache ledger (chemin le plus courant, écritures utilisateur).
   */
  prismaClient?: DbClient,
  /**
   * `ledgerState` : état partagé et réutilisé entre plusieurs écritures d'un
   * même lot (import CSV — voir commit.ts). Évite un `loadLedgerForUser` +
   * replay complet à CHAQUE ligne : sans ça, invalider le cache après
   * chaque insertion rend l'import en O(n²) sur le nombre de lignes déjà
   * en base, et un CSV de quelques centaines de lignes dépasse le timeout
   * serverless (10s). L'état est mis à jour en place après chaque écriture
   * réussie ; l'appelant invalide le cache une seule fois à la fin du lot
   * via `skipInvalidate`.
   */
  opts?: {
    ledgerState?: LedgerState;
    skipInvalidate?: boolean;
    /** Mémo d'appartenances du lot — voir OwnershipCache. */
    ownership?: OwnershipCache;
  }
) {
  const client = prismaClient ?? prisma;
  const input = await resolveFx(raw);
  await validateOwnership(input, client, opts?.ownership);

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AccountingError("INVALID_DATE", "Date de transaction invalide");
  }

  // Validate required fields for trades
  if (input.type === "ACHAT" || input.type === "VENTE") {
    if (!input.assetId) {
      throw new AccountingError("ASSET_REQUIRED", "Sélectionnez un actif");
    }
    if (!input.quantity || d(input.quantity).lte(0)) {
      throw new AccountingError("INVALID_QTY", "Quantité positive requise");
    }
    if (input.unitPrice == null || input.unitPrice === "" || d(input.unitPrice).lt(0)) {
      throw new AccountingError("INVALID_PRICE", "Prix unitaire requis");
    }
  }
  if (input.type === "REWARD" || input.type === "AIRDROP") {
    if (!input.assetId) {
      throw new AccountingError("ASSET_REQUIRED", "Sélectionnez un actif");
    }
    if (!input.quantity || d(input.quantity).lte(0)) {
      throw new AccountingError(
        "INVALID_QTY",
        input.type === "AIRDROP"
          ? "Quantité d'airdrop strictement positive requise"
          : "Quantité de récompense strictement positive requise"
      );
    }
    if (
      input.unitPrice != null &&
      input.unitPrice !== "" &&
      d(input.unitPrice).lt(0)
    ) {
      throw new AccountingError(
        "INVALID_PRICE",
        "Valeur de marché indicative ne peut pas être négative"
      );
    }
  }
  if (input.type === "SPLIT") {
    if (!input.assetId) {
      throw new AccountingError("ASSET_REQUIRED", "Sélectionnez un actif");
    }
    if (!input.quantity || d(input.quantity).lte(0)) {
      throw new AccountingError(
        "INVALID_QTY",
        "Ratio de split strictement positif (ex. 2 pour un 2-for-1)"
      );
    }
  }

  const whtRate = await resolveIncomeWhtRate(input, client);
  const newTx = toLedgerTx(`pending-${Date.now()}`, input, occurredAt, whtRate);

  // ACHAT / VENTE / REWARD / SPLIT / TRANSFERT_TITRE n’impactent pas le cash bancaire.
  // Si le journal historique a déjà des RETRAIT sans APPORT, le replay échouerait
  // sans allowNegativeCash — et bloquerait à tort l’écriture de positions (ex. sync wallet).
  const positionOnly = [
    "ACHAT",
    "VENTE",
    "REWARD",
    "AIRDROP",
    "SPLIT",
    "TRANSFERT_TITRE",
  ].includes(input.type);
  const allowNeg = Boolean(input.allowNegativeCash) || positionOnly;

  if (prismaClient) {
    // Dans une transaction interactive (ex. SL/TP, market/triggers.ts) : lecture
    // fraîche via `tx` obligatoire pour les garanties d'isolation — ne pas
    // réutiliser le cache loadLedgerForUser (basé sur le client singleton,
    // hors de cette transaction, il ne verrait pas les écritures en cours).
    const existingRows = await client.transaction.findMany({
      where: { userId: input.userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    validateLedger(existingRows.map(mapExisting), newTx, undefined, allowNeg);
  } else {
    // Chemin normal : réutilise le ledger déjà calculé/caché par
    // loadLedgerForUser (fingerprint) au lieu d'un findMany + replay complet.
    const ledgerState = opts?.ledgerState ?? (await loadLedgerForUser(input.userId));
    const nextState = validateLedgerIncremental(ledgerState, newTx, allowNeg);
    if (opts?.ledgerState) {
      // Lot (import CSV) : reporter la tx validée dans l'état partagé pour
      // que la ligne suivante la voie sans repasser par la DB.
      Object.assign(opts.ledgerState, nextState);
    }
  }

  const amounts = computeNetCashImpactEur(newTx);
  const whtEur = Number(
    amounts.grossAmountEur.minus(amounts.feesEur).minus(amounts.netCashImpactEur).toString()
  );

  const created = await client.transaction.create({
    data: {
      userId: input.userId,
      ...buildPrismaData(input, occurredAt, amounts, {
        rate: whtRate,
        eur: Math.max(0, whtEur),
      }),
    },
  });

  if (!opts?.skipInvalidate) {
    const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
    invalidateLedgerCache(input.userId);
  }

  return created;
}

export async function updateTransaction(raw: UpdateTxInput) {
  const input = await resolveFx(raw);
  await validateOwnership(input);

  const current = await prisma.transaction.findFirst({
    where: { id: raw.id, userId: input.userId },
  });
  if (!current) throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new AccountingError("INVALID_DATE", "Date de transaction invalide");
  }

  const existing = (
    await prisma.transaction.findMany({
      where: { userId: input.userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    })
  ).map(mapExisting);

  const whtRate = await resolveIncomeWhtRate(input);
  const updatedTx = toLedgerTx(raw.id, input, occurredAt, whtRate);
  validateLedger(existing, updatedTx, raw.id, Boolean(input.allowNegativeCash));

  const amounts = computeNetCashImpactEur(updatedTx);
  const whtEur = Number(
    amounts.grossAmountEur.minus(amounts.feesEur).minus(amounts.netCashImpactEur).toString()
  );

  const write = await prisma.transaction.updateMany({
    where: { id: raw.id, userId: input.userId },
    data: buildPrismaData(input, occurredAt, amounts, {
      rate: whtRate,
      eur: Math.max(0, whtEur),
    }),
  });
  if (write.count === 0) {
    throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");
  }

  const updated = await prisma.transaction.findFirst({
    where: { id: raw.id, userId: input.userId },
  });
  if (!updated) throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");

  const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
  invalidateLedgerCache(input.userId);

  return updated;
}

export async function deleteTransaction(userId: string, id: string) {
  const current = await prisma.transaction.findFirst({ where: { id, userId } });
  if (!current) throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");

  const existing = (
    await prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    })
  ).map(mapExisting);

  try {
    validateLedger(existing, undefined, id, false);
  } catch {
    validateLedger(existing, undefined, id, true);
  }

  const del = await prisma.transaction.deleteMany({ where: { id, userId } });
  if (del.count === 0) {
    throw new AccountingError("TX_NOT_FOUND", "Transaction introuvable");
  }

  const { invalidateLedgerCache } = await import("../portfolio/ledger-cache");
  invalidateLedgerCache(userId);

  return { ok: true };
}

export function simulateTransaction(existing: LedgerTx[], next: LedgerTx) {
  const state = createEmptyLedger();
  for (const t of existing) applyTransaction(state, t);
  applyTransaction(state, next);
  return state;
}
