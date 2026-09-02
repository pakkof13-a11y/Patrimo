/**
 * CRUD des comptes titres — seule couche de ce module qui touche Prisma.
 *
 * Un `SecuritiesAccount` ne porte aucune valorisation : ce que le compte pèse
 * se recalcule depuis le journal des positions qui lui sont rattachées, comme
 * partout ailleurs dans le dépôt. Le supprimer ne perd donc aucune donnée
 * financière — les actifs sont détachés (`onDelete: SetNull`), leur journal
 * intact.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { owned, wroteOne } from "../db/tenant-scope";
import { recordEnvelopeEvent } from "./envelope-history";
import {
  accountTypeForEnvelope,
  isSecuritiesEnvelopeType,
  isSingleAccountEnvelope,
  securitiesEnvelopeLabel,
  type SecuritiesEnvelopeType,
} from "./constants";

export class SecuritiesInputError extends Error {
  readonly code = "SECURITIES_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "SecuritiesInputError";
  }
}

export type SecuritiesAccountSummary = {
  id: string;
  envelopeType: SecuritiesEnvelopeType;
  envelopeLabel: string;
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  openDate: Date;
  iban: string | null;
  notes: string | null;
  /** Nombre de lignes de titres rattachées — jamais leur valeur. */
  positionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateAccountInput = {
  envelopeType: string;
  platformId: string;
  openDate: string;
  iban?: string | null;
  notes?: string | null;
};

export type UpdateAccountInput = {
  platformId?: string;
  openDate?: string;
  iban?: string | null;
  notes?: string | null;
};

const accountSelect = {
  id: true,
  envelopeType: true,
  platformId: true,
  openDate: true,
  iban: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  platform: { select: { name: true, logoUrl: true } },
  _count: { select: { assets: true } },
} satisfies Prisma.SecuritiesAccountSelect;

type AccountRow = Prisma.SecuritiesAccountGetPayload<{
  select: typeof accountSelect;
}>;

function toSummary(row: AccountRow): SecuritiesAccountSummary {
  return {
    id: row.id,
    envelopeType: row.envelopeType as SecuritiesEnvelopeType,
    envelopeLabel: securitiesEnvelopeLabel(row.envelopeType),
    platformId: row.platformId,
    platformName: row.platform.name,
    platformLogoUrl: row.platform.logoUrl,
    openDate: row.openDate,
    iban: row.iban,
    notes: row.notes,
    positionCount: row._count.assets,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Date d'ouverture — refusée dans le futur.
 *
 * Ce n'est pas du zèle de validation : `openDate` est le point de départ des
 * 5 ans du PEA. Une date future rendrait la maturité fiscale négative et
 * afficherait un compte qui « n'existe pas encore ».
 */
function parseOpenDate(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new SecuritiesInputError("Date d'ouverture invalide");
  }
  if (date.getTime() > Date.now()) {
    throw new SecuritiesInputError(
      "La date d'ouverture ne peut pas être dans le futur"
    );
  }
  return date;
}

async function assertPlatformOwned(userId: string, platformId: string) {
  const platform = await prisma.platform.findFirst({
    where: { id: platformId, userId },
    select: { id: true },
  });
  if (!platform) throw new SecuritiesInputError("Courtier introuvable");
}

function duplicateEnvelopeError(
  envelopeType: SecuritiesEnvelopeType
): SecuritiesInputError {
  return new SecuritiesInputError(
    `Vous détenez déjà un ${securitiesEnvelopeLabel(envelopeType)} — la loi n'en autorise qu'un par personne.`
  );
}

export async function listAccounts(
  userId: string
): Promise<SecuritiesAccountSummary[]> {
  const rows = await prisma.securitiesAccount.findMany({
    where: { userId },
    // PEA d'abord, puis PEA-PME, puis les CTO : l'ordre de lecture utile est
    // celui du poids fiscal, pas celui de la création.
    orderBy: [{ envelopeType: "asc" }, { openDate: "asc" }],
    select: accountSelect,
  });
  return rows.map(toSummary);
}

export async function createAccount(
  userId: string,
  input: CreateAccountInput
): Promise<SecuritiesAccountSummary> {
  if (!isSecuritiesEnvelopeType(input.envelopeType)) {
    throw new SecuritiesInputError("Type de compte inconnu");
  }
  const envelopeType = input.envelopeType;

  await assertPlatformOwned(userId, input.platformId);
  const openDate = parseOpenDate(input.openDate);

  // Contrôle applicatif d'abord, pour le message. La contrainte base reste
  // la vraie garantie : entre ce SELECT et l'INSERT, une requête concurrente
  // peut créer le même compte — d'où le rattrapage P2002 plus bas.
  if (isSingleAccountEnvelope(envelopeType)) {
    const existing = await prisma.securitiesAccount.findFirst({
      where: { userId, envelopeType },
      select: { id: true },
    });
    if (existing) throw duplicateEnvelopeError(envelopeType);
  }

  try {
    const row = await prisma.securitiesAccount.create({
      data: {
        userId,
        envelopeType,
        platformId: input.platformId,
        openDate,
        iban: input.iban?.trim() || null,
        notes: input.notes?.trim() || null,
      },
      select: accountSelect,
    });
    return toSummary(row);
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw duplicateEnvelopeError(envelopeType);
    }
    throw e;
  }
}

/**
 * Met à jour un compte. `envelopeType` est volontairement absent des champs
 * modifiables : transformer un PEA en CTO changerait le régime fiscal de
 * toutes les lignes qu'il détient sans qu'aucune opération réelle n'ait eu
 * lieu. Changer d'enveloppe, c'est ouvrir un autre compte.
 */
export async function updateAccount(
  userId: string,
  id: string,
  input: UpdateAccountInput
): Promise<SecuritiesAccountSummary> {
  if (input.platformId) await assertPlatformOwned(userId, input.platformId);

  // Variante `Unchecked` : `updateMany` ne passe pas par les relations, la
  // clé étrangère `platformId` s'y écrit comme un scalaire.
  const data: Prisma.SecuritiesAccountUncheckedUpdateManyInput = {};
  if (input.platformId) data.platformId = input.platformId;
  if (input.openDate) data.openDate = parseOpenDate(input.openDate);
  if (input.iban !== undefined) data.iban = input.iban?.trim() || null;
  if (input.notes !== undefined) data.notes = input.notes?.trim() || null;

  const result = await prisma.securitiesAccount.updateMany({
    where: owned(id, userId),
    data,
  });
  if (!wroteOne(result)) throw new SecuritiesInputError("Compte introuvable");

  const row = await prisma.securitiesAccount.findFirstOrThrow({
    where: { id },
    select: accountSelect,
  });
  return toSummary(row);
}

/**
 * Supprime un compte. Les titres qu'il détenait ne sont jamais supprimés :
 * `SetNull` les détache, leur journal — donc leur valorisation et leur prix de
 * revient — reste intact.
 */
export async function deleteAccount(
  userId: string,
  id: string
): Promise<{ deleted: boolean; detachedPositions: number }> {
  const account = await prisma.securitiesAccount.findFirst({
    where: owned(id, userId),
    select: {
      envelopeType: true,
      // Les lignes détachées sont nommées avant la suppression : après, la
      // base les aura déjà déliées et il n'y aurait plus rien à journaliser.
      assets: { select: { id: true, accountType: true } },
    },
  });
  if (!account) return { deleted: false, detachedPositions: 0 };

  /*
    Le détachement par suppression de compte n'a aucun code applicatif : il se
    produit dans la base, par `SetNull`, à la seconde où le compte disparaît.
    C'était donc la seule porte capable de changer le rattachement d'une ligne
    sans laisser la moindre trace.

    On journalise avant, dans la même transaction : chaque ligne enregistre
    qu'elle devient non rattachée, puis le compte est supprimé. L'ordre
    importe — après, on ne saurait plus quelles lignes il portait.
  */
  const result = await prisma.$transaction(async (tx) => {
    for (const a of account.assets) {
      await recordEnvelopeEvent(tx, {
        assetId: a.id,
        userId,
        kind: "CHANGED",
        state: {
          accountType: a.accountType,
          securitiesAccountId: null,
          envelopeType: null,
        },
      });
    }
    return tx.securitiesAccount.deleteMany({ where: owned(id, userId) });
  });

  return {
    deleted: wroteOne(result),
    detachedPositions: account.assets.length,
  };
}

/**
 * Rattache (ou détache si `securitiesAccountId` est `null`) une ligne de
 * titres à un compte.
 *
 * Un écart d'enveloppe est refusé plutôt que corrigé : déplacer une ligne d'un
 * CTO vers un PEA n'est pas une correction de saisie, c'est un transfert de
 * titres — opération qui a ses propres conséquences fiscales et que l'app ne
 * doit pas simuler d'un changement de champ.
 */
export async function setAssetAccount(
  userId: string,
  assetId: string,
  securitiesAccountId: string | null
): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, userId },
    select: { id: true, accountType: true },
  });
  if (!asset) throw new SecuritiesInputError("Position introuvable");

  let envelopeType: string | null = null;

  if (securitiesAccountId) {
    const account = await prisma.securitiesAccount.findFirst({
      where: owned(securitiesAccountId, userId),
      select: { envelopeType: true },
    });
    if (!account) throw new SecuritiesInputError("Compte introuvable");

    const expected = accountTypeForEnvelope(
      account.envelopeType as SecuritiesEnvelopeType
    );
    if (asset.accountType !== expected) {
      throw new SecuritiesInputError(
        `Cette position est en enveloppe ${asset.accountType}, elle ne peut pas être rattachée à un ${securitiesEnvelopeLabel(account.envelopeType)}.`
      );
    }
    envelopeType = account.envelopeType;
  }

  /*
    Rattachement et journalisation dans la même transaction.

    Un rattachement change ce qu'était la ligne à partir de cet instant : c'est
    un événement historique au même titre qu'un changement d'enveloppe. Le
    détachement en est un aussi — `securitiesAccountId` à `null` est un fait,
    pas une absence de fait.
  */
  await prisma.$transaction(async (tx) => {
    await tx.asset.update({
      where: { id: assetId },
      data: { securitiesAccountId },
    });
    await recordEnvelopeEvent(tx, {
      assetId,
      userId,
      kind: "CHANGED",
      state: {
        accountType: asset.accountType,
        securitiesAccountId,
        envelopeType,
      },
    });
  });
}
