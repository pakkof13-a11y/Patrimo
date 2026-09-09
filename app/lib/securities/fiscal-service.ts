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
import { convertToEurSync, getEurRates } from "../market/fx";
import {
  securitiesEnvelopeLabel,
  type CashAttribution,
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
   * D'où vient — ou pourquoi manque — le montant ci-dessus. Voir
   * `CashAttribution` : hors de `ATTRIBUTED`, `cashEur` vaut zéro et ce zéro
   * n'est pas un relevé.
   */
  cashAttribution: CashAttribution;
  /**
   * Titres + espèces imputées — l'assiette du calcul de retrait.
   *
   * **Complète sous `ATTRIBUTED` seulement.** Dans les deux autres états la
   * part espèces vaut zéro sans avoir été relevée, et ce montant est un
   * minorant.
   *
   * Le commentaire précédent n'examinait qu'`ENVELOPE_LEVEL` pour conclure que
   * le PEA était à l'abri. C'était faux d'une moitié. `ENVELOPE_LEVEL` ne
   * concerne effectivement que le CTO — PEA et PEA-PME sont uniques par
   * personne (`SINGLE_ACCOUNT_ENVELOPES`, index partiel en base) — mais
   * `NOT_TRACKED`, lui, les atteint de plein fouet : c'est l'état de tout plan
   * dont l'utilisateur n'a pas déclaré la poche d'espèces, et le simulateur de
   * retrait s'y alimente.
   *
   * Mesuré : 20 000 € de titres, 5 000 € d'espèces non suivies, 22 000 € de
   * versements. Gain réel +3 000 €, gain calculé −2 000 €, donc gain imposable
   * ramené à 0 et impôt nul ; et un retrait de 22 000 € que la trésorerie
   * couvre est refusé par « Montant supérieur à la valeur du plan »
   * (`app/lib/securities/pea.ts`).
   *
   * Le calcul n'est donc pas seulement incomplet : il est faux. Ce qui l'entoure
   * doit le savoir — `WithdrawalSimulator` masque la simulation hors
   * `ATTRIBUTED` et dit pourquoi, plutôt que de rendre ces chiffres-là.
   */
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

/** Enveloppes titres portant une poche d'espèces. L'AV n'est pas de ce ressort. */
const CASH_ENVELOPES = ["PEA", "CTO"] as const;

/**
 * Répartit les poches d'espèces entre les comptes.
 *
 * `EnvelopeCash` est tenue par enveloppe (`CTO`, `PEA`, `AV`), pas par compte —
 * elle est même unique par `(userId, envelope)` au schéma. L'imputation n'est
 * donc exacte que lorsqu'un seul compte porte l'enveloppe : c'est toujours le
 * cas du PEA, unique par personne, et seulement parfois celui du CTO. Le
 * PEA-PME n'a aucune poche dédiée dans le modèle actuel — lui attribuer celle
 * du PEA fausserait les deux.
 *
 * Quand l'imputation est impossible, ce compte-ci porte zéro et le dit. La
 * poche n'est pas perdue pour autant : elle ressort sur l'enveloppe, via
 * `unattributedEnvelopeCash`, et le total de la page l'ajoute une fois.
 *
 * Elle n'est **pas** attribuée d'office au premier compte venu : `cashEur`
 * nourrit `liquidationValueEur`, donc le gain fiscal du compte. Prêter à un
 * compte-titres les espèces d'un autre fausserait ce gain sur les deux, pour
 * rendre juste un total qu'on sait rendre juste autrement.
 *
 * L'ordre des tests n'est pas indifférent. L'absence de poche se tranche
 * **avant** le nombre de comptes : deux CTO sans un euro d'espèces n'ont rien
 * à se partager, et les renvoyer « non ventilés » accusait d'un échec de
 * ventilation deux comptes qui n'avaient rien à ventiler. C'est exactement le
 * reproche fait au PEA-PME, sur un cas bien plus courant.
 *
 * L'état rendu est le miroir exact de `unattributedEnvelopeCash` :
 * `ENVELOPE_LEVEL` sur un compte ⟺ son enveloppe figure dans
 * `unattributedCashByEnvelope`. Les deux fonctions décident sur les mêmes
 * conditions, dans le même ordre, pour qu'aucune poche ne puisse être
 * annoncée deux fois ni oubliée par les deux.
 */
function attributeCash(
  envelopeType: SecuritiesEnvelopeType,
  accountsOfSameEnvelope: number,
  pockets: Map<string, Decimal>
): { cashEur: Decimal; cashAttribution: CashAttribution } {
  if (envelopeType === "PEA_PME") {
    return { cashEur: d(0), cashAttribution: "NOT_TRACKED" };
  }

  const pocket = pockets.get(envelopeType === "PEA" ? "PEA" : "CTO");

  // Pas de poche, ou une poche à zéro : rien à imputer, et rien à signaler.
  // Le zéro rendu ici est un fait — l'enveloppe est suivie, son solde est nul.
  if (!pocket || pocket.isZero()) {
    return { cashEur: d(0), cashAttribution: "ATTRIBUTED" };
  }

  if (accountsOfSameEnvelope !== 1) {
    return { cashEur: d(0), cashAttribution: "ENVELOPE_LEVEL" };
  }

  return { cashEur: pocket, cashAttribution: "ATTRIBUTED" };
}

/**
 * Espèces d'enveloppe qu'aucun compte ne peut porter.
 *
 * Deux cas : plusieurs comptes se partagent l'enveloppe — on ne sait pas
 * lequel détient la poche — ou aucun compte titres n'est déclaré alors que la
 * poche existe, l'état ordinaire d'un début de saisie.
 *
 * Ce montant sortait nulle part. Le drapeau censé l'annoncer ne pouvait même
 * pas s'allumer : le garde de `computeTotals` exigeait
 * `!cashAttributed && cashEur !== 0`, alors qu'`attributeCash` met justement le
 * montant à zéro dans les deux branches où il baisse le drapeau. Mesuré : deux
 * comptes-titres et une poche CTO de 5 000 € — les 5 000 € n'apparaissaient ni
 * dans le total, ni dans un bandeau.
 *
 * Il est compté **une fois par enveloppe**, jamais par compte : le distribuer
 * aux comptes en doublerait le montant sur la page.
 *
 * Le signe ne filtre pas. Une poche négative — découvert, appel de marge,
 * règlement différé — est un fait comptable au même titre qu'une poche
 * créditrice, et `attributeCash` ne l'a jamais filtrée : avec un seul compte
 * de l'enveloppe, un solde de −1 200 € entre dans son `cashEur`, donc dans le
 * total. La jeter ici faisait dépendre le total de la page du **nombre de
 * comptes** : 1 200 € d'écart entre un CTO et deux, pour la même dette. Seul
 * le zéro strict est sauté, parce qu'il n'y a rien à annoncer.
 */
function unattributedEnvelopeCash(
  pockets: Map<string, Decimal>,
  countByEnvelope: Map<string, number>
): Record<string, Decimal> {
  const out: Record<string, Decimal> = {};
  for (const envelope of CASH_ENVELOPES) {
    const pocket = pockets.get(envelope);
    if (!pocket || pocket.isZero()) continue;
    // Un seul compte de cette enveloppe : la poche lui est imputée, elle
    // compte déjà dans son `cashEur`.
    if ((countByEnvelope.get(envelope) ?? 0) === 1) continue;
    out[envelope] = pocket;
  }
  return out;
}

export type SecuritiesFiscalBundle = {
  accounts: AccountFiscalSummary[];
  /**
   * Espèces d'enveloppe qu'aucun compte ne porte, **par enveloppe**.
   *
   * Par enveloppe et non en un seul montant : c'est la maille à laquelle la
   * poche existe, celle où l'écran doit la ranger — la répartition par
   * enveloppe en a besoin — et celle que le bandeau doit nommer. « Une partie
   * des liquidités » n'apprend rien ; « Liquidités CTO : 5 000 € » se vérifie.
   *
   * Vide quand tout est imputé. Voir `unattributedEnvelopeCash`.
   */
  unattributedCashByEnvelope: Record<string, Decimal>;
};

/**
 * Situation fiscale de tous les comptes titres de l'utilisateur.
 *
 * Le plafond est calculé après avoir rassemblé les versements des deux plans :
 * la place disponible sur l'un dépend de ce qui a été versé sur l'autre, via le
 * plafond commun (cf. `peaContributionRoom`). Un calcul compte par compte,
 * isolément, donnerait un chiffre trop élevé.
 *
 * Aucun compte déclaré ne fait plus sortir tôt : une poche d'enveloppe peut
 * exister sans compte en face — c'est même l'état ordinaire d'un début de
 * saisie — et la taire cacherait du capital.
 */
export async function getSecuritiesFiscalBundle(
  userId: string,
  at: Date = new Date()
): Promise<SecuritiesFiscalBundle> {
  const accounts = await prisma.securitiesAccount.findMany({
    where: { userId },
    select: {
      id: true,
      envelopeType: true,
      openDate: true,
      assets: { select: { id: true } },
      contributions: { select: { type: true, amountEur: true } },
    },
    /*
      `envelopeType` croissant trie les valeurs stockées `CTO | PEA | PEA_PME`,
      donc les comptes-titres d'abord. L'ordre de lecture utile est celui du
      poids fiscal — le PEA en tête — et l'écran le rétablit de son côté
      (`securities-overview.tsx`). Le commentaire disait l'inverse du code ;
      c'est le commentaire qui avait tort.
    */
    orderBy: [{ envelopeType: "asc" }, { openDate: "asc" }],
  });

  const allAssetIds = accounts.flatMap((a) => a.assets.map((x) => x.id));
  const [values, envelopeRows, rates] = await Promise.all([
    allAssetIds.length > 0
      ? getAssetValues(userId, allAssetIds)
      : Promise.resolve(new Map()),
    prisma.envelopeCash.findMany({ where: { userId } }),
    getEurRates(),
  ]);

  /*
    La poche se convertit, elle ne se relabellise pas.

    `EnvelopeCash` porte un `balance` **et** une `currency` — le panneau
    laisse changer celle du CTO et de l'AV. Cette carte ne lisait que le
    nominal : une poche CTO de 5 000 USD entrait pour 5 000 dans un `cashEur`
    dont le nom dit l'unité, et de là dans la valeur liquidative du compte,
    dans l'assiette d'une simulation de retrait, et — depuis que le bandeau
    nomme chaque poche — à l'écran, en toutes lettres, suivie d'un « € ».

    Les deux consommateurs de cette carte, `attributeCash` et
    `unattributedEnvelopeCash`, décident sur les mêmes montants : convertir
    ici les corrige tous les deux d'un coup, et aucun des deux n'a à
    connaître les taux.

    Une devise sans taux fait remonter `FxRateUnknownError`, et la route rend
    son 500 : c'est le troisième état. Ni zéro — la poche existe —, ni le
    nominal étiqueté euro, qui est le défaut qu'on ferme.
  */
  const pockets = new Map<string, Decimal>(
    envelopeRows.map((e) => [
      e.envelope,
      d(convertToEurSync(e.balance.toString(), e.currency, rates)),
    ])
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

  const summaries = accounts.map((a) => {
    const envelopeType = a.envelopeType as SecuritiesEnvelopeType;
    const isPea = envelopeType !== "CTO";

    let positionsValue = d(0);
    for (const asset of a.assets) {
      const v = values.get(asset.id);
      if (v) positionsValue = positionsValue.plus(v.marketValueEur);
    }

    const { cashEur, cashAttribution } = attributeCash(
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
      cashAttribution,
      liquidationValueEur: liquidationValue,
      gainEur: liquidationValue.minus(totalsForAccount.deposits),
    };
  });

  return {
    accounts: summaries,
    unattributedCashByEnvelope: unattributedEnvelopeCash(
      pockets,
      countByEnvelope
    ),
  };
}
