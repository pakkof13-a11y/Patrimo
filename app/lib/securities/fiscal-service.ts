/**
 * Situation fiscale des comptes titres — seule couche du module à croiser
 * Prisma et le moteur pur `pea.ts`.
 *
 * Deux grandeurs alimentent le calcul, et elles ne viennent pas du même
 * endroit :
 *
 * - **Les versements cumulés** viennent du journal déclaratif
 *   `SecuritiesAccountContribution`, et non du journal des transactions.
 *   Un `APPORT` y est un dépôt de liquidité bancaire rattaché à une
 *   plateforme, sans notion d'enveloppe, et le prix de revient des positions
 *   ne dit rien des versements dès qu'un gain a été réinvesti (cf. la note du
 *   modèle Prisma).
 * - **La valeur liquidative** vient du journal des transactions, via
 *   `getAssetValues` — jamais d'un champ recopié, comme partout ailleurs.
 */

import Decimal from "decimal.js";
import { d } from "../money/decimal";
import { prisma } from "../prisma";
import { owned, wroteOne } from "../db/tenant-scope";
import { getAssetValues } from "../portfolio/asset-values";
import {
  securitiesEnvelopeLabel,
  type SecuritiesEnvelopeType,
} from "./constants";
import { SecuritiesInputError } from "./account-service";
import {
  peaContributionRoom,
  peaMaturityStatus,
  peaTaxStatusLabel,
  type PeaContributionRoom,
  type PeaMaturityStatus,
} from "./pea";

export const CONTRIBUTION_TYPES = ["DEPOSIT", "WITHDRAWAL"] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

export type ContributionRow = {
  id: string;
  type: ContributionType;
  amountEur: Decimal;
  occurredAt: Date;
  notes: string | null;
};

export type AccountFiscalSummary = {
  accountId: string;
  envelopeType: SecuritiesEnvelopeType;
  envelopeLabel: string;
  openDate: Date;

  /** Absent sur un compte-titres : la règle des 5 ans ne le concerne pas. */
  maturity: PeaMaturityStatus | null;
  /** Absent sur un compte-titres : aucun plafond de versement. */
  room: PeaContributionRoom | null;
  /** Absent sur un compte-titres, dont l'imposition relève de `fiscal-year.ts`. */
  taxStatusLabel: string | null;

  /** Somme des versements déclarés — bruts, les retraits ne les réduisent pas. */
  contributionsEur: Decimal;
  /** Somme des retraits déclarés, pour information. */
  withdrawalsEur: Decimal;

  positionsValueEur: Decimal;
  cashEur: Decimal;
  /**
   * Faux quand les espèces de l'enveloppe n'ont pas pu être imputées à ce
   * compte en particulier. La poche `EnvelopeCash` est tenue par enveloppe et
   * non par compte : elle s'impute exactement au PEA, qui est unique, mais
   * répartir un solde CTO entre plusieurs comptes-titres relèverait de
   * l'invention. L'UI doit le signaler plutôt que d'afficher un total faux.
   */
  cashAttributed: boolean;
  /** Titres + espèces imputées — l'assiette du calcul de retrait. */
  liquidationValueEur: Decimal;
  /** Valeur liquidative − versements. Négatif en cas de moins-value. */
  gainEur: Decimal;
};

// ─── Versements ───────────────────────────────────────────────────────────────

async function assertAccountOwned(userId: string, accountId: string) {
  const account = await prisma.securitiesAccount.findFirst({
    where: owned(accountId, userId),
    select: { id: true },
  });
  if (!account) throw new SecuritiesInputError("Compte introuvable");
}

export async function listContributions(
  userId: string,
  accountId: string
): Promise<ContributionRow[]> {
  await assertAccountOwned(userId, accountId);
  const rows = await prisma.securitiesAccountContribution.findMany({
    where: { securitiesAccountId: accountId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type as ContributionType,
    amountEur: d(r.amountEur.toString()),
    occurredAt: r.occurredAt,
    notes: r.notes,
  }));
}

export async function recordContribution(
  userId: string,
  accountId: string,
  input: {
    type: string;
    amountEur: string;
    occurredAt: string;
    notes?: string | null;
  }
): Promise<ContributionRow> {
  await assertAccountOwned(userId, accountId);

  if (!(CONTRIBUTION_TYPES as readonly string[]).includes(input.type)) {
    throw new SecuritiesInputError("Type de mouvement inconnu");
  }

  // Le signe est porté par `type`, jamais par le montant : un versement
  // négatif serait un retrait déguisé, que les totaux ne sauraient pas classer.
  const amount = d(input.amountEur);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new SecuritiesInputError("Le montant doit être strictement positif");
  }

  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new SecuritiesInputError("Date de mouvement invalide");
  }

  const row = await prisma.securitiesAccountContribution.create({
    data: {
      securitiesAccountId: accountId,
      type: input.type,
      amountEur: amount.toFixed(12),
      occurredAt,
      notes: input.notes?.trim() || null,
    },
  });

  return {
    id: row.id,
    type: row.type as ContributionType,
    amountEur: d(row.amountEur.toString()),
    occurredAt: row.occurredAt,
    notes: row.notes,
  };
}

export async function deleteContribution(
  userId: string,
  contributionId: string
): Promise<{ deleted: boolean }> {
  // `SecuritiesAccountContribution` n'a pas de `userId` propre :
  // l'appartenance passe par le compte, comme les positions DeFi par l'actif.
  const result = await prisma.securitiesAccountContribution.deleteMany({
    where: { id: contributionId, account: { is: { userId } } },
  });
  return { deleted: wroteOne(result) };
}

// ─── Situation par compte ─────────────────────────────────────────────────────

/**
 * Répartit les poches d'espèces entre les comptes.
 *
 * `EnvelopeCash` est tenue par enveloppe (`CTO`, `PEA`, `AV`), pas par compte.
 * L'imputation n'est donc exacte que lorsqu'un seul compte porte l'enveloppe :
 * c'est toujours le cas du PEA, qui est unique par personne, et seulement
 * parfois celui du CTO. Le PEA-PME n'a aucune poche dédiée dans le modèle
 * actuel — lui attribuer celle du PEA fausserait les deux.
 *
 * Quand l'imputation est impossible, on renvoie zéro **et** on le signale,
 * plutôt que de répartir arbitrairement.
 */
function attributeCash(
  envelopeType: SecuritiesEnvelopeType,
  accountsOfSameEnvelope: number,
  pockets: Map<string, Decimal>
): { cashEur: Decimal; cashAttributed: boolean } {
  if (envelopeType === "PEA_PME") {
    return { cashEur: d(0), cashAttributed: false };
  }
  if (accountsOfSameEnvelope !== 1) {
    return { cashEur: d(0), cashAttributed: false };
  }
  const pocket = pockets.get(envelopeType === "PEA" ? "PEA" : "CTO");
  return { cashEur: pocket ?? d(0), cashAttributed: true };
}

/**
 * Situation fiscale de tous les comptes titres de l'utilisateur.
 *
 * Le plafond est calculé après avoir rassemblé les versements des deux plans :
 * la place disponible sur l'un dépend de ce qui a été versé sur l'autre, via le
 * plafond commun (cf. `peaContributionRoom`). Un calcul compte par compte,
 * isolément, donnerait un chiffre trop élevé.
 */
export async function getSecuritiesFiscalBundle(
  userId: string,
  at: Date = new Date()
): Promise<AccountFiscalSummary[]> {
  const accounts = await prisma.securitiesAccount.findMany({
    where: { userId },
    select: {
      id: true,
      envelopeType: true,
      openDate: true,
      assets: { select: { id: true } },
      contributions: { select: { type: true, amountEur: true } },
    },
    orderBy: [{ envelopeType: "asc" }, { openDate: "asc" }],
  });
  if (accounts.length === 0) return [];

  const allAssetIds = accounts.flatMap((a) => a.assets.map((x) => x.id));
  const [values, envelopeRows] = await Promise.all([
    allAssetIds.length > 0
      ? getAssetValues(userId, allAssetIds)
      : Promise.resolve(new Map()),
    prisma.envelopeCash.findMany({ where: { userId } }),
  ]);

  const pockets = new Map<string, Decimal>(
    envelopeRows.map((e) => [e.envelope, d(e.balance.toString())])
  );

  const countByEnvelope = new Map<string, number>();
  for (const a of accounts) {
    countByEnvelope.set(
      a.envelopeType,
      (countByEnvelope.get(a.envelopeType) ?? 0) + 1
    );
  }

  // Totaux par plan, requis avant toute évaluation de plafond : le plafond
  // commun croise les deux.
  const totals = { PEA: d(0), PEA_PME: d(0) };
  const contributionsByAccount = new Map<
    string,
    { deposits: Decimal; withdrawals: Decimal }
  >();
  for (const a of accounts) {
    let deposits = d(0);
    let withdrawals = d(0);
    for (const c of a.contributions) {
      const amount = d(c.amountEur.toString());
      if (c.type === "WITHDRAWAL") withdrawals = withdrawals.plus(amount);
      else deposits = deposits.plus(amount);
    }
    contributionsByAccount.set(a.id, { deposits, withdrawals });
    if (a.envelopeType === "PEA") totals.PEA = totals.PEA.plus(deposits);
    if (a.envelopeType === "PEA_PME")
      totals.PEA_PME = totals.PEA_PME.plus(deposits);
  }

  return accounts.map((a) => {
    const envelopeType = a.envelopeType as SecuritiesEnvelopeType;
    const isPea = envelopeType !== "CTO";

    let positionsValue = d(0);
    for (const asset of a.assets) {
      const v = values.get(asset.id);
      if (v) positionsValue = positionsValue.plus(v.marketValueEur);
    }

    const { cashEur, cashAttributed } = attributeCash(
      envelopeType,
      countByEnvelope.get(envelopeType) ?? 0,
      pockets
    );
    const liquidationValue = positionsValue.plus(cashEur);

    const totalsForAccount = contributionsByAccount.get(a.id)!;
    const maturity = isPea ? peaMaturityStatus(a.openDate, at) : null;

    return {
      accountId: a.id,
      envelopeType,
      envelopeLabel: securitiesEnvelopeLabel(envelopeType),
      openDate: a.openDate,
      maturity,
      room: isPea
        ? peaContributionRoom({
            envelopeType,
            peaContributionsEur: totals.PEA,
            peaPmeContributionsEur: totals.PEA_PME,
          })
        : null,
      taxStatusLabel: maturity ? peaTaxStatusLabel(maturity.isMatured) : null,
      contributionsEur: totalsForAccount.deposits,
      withdrawalsEur: totalsForAccount.withdrawals,
      positionsValueEur: positionsValue,
      cashEur,
      cashAttributed,
      liquidationValueEur: liquidationValue,
      gainEur: liquidationValue.minus(totalsForAccount.deposits),
    };
  });
}
