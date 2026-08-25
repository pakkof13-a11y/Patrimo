/**
 * Bascule de l'assurance-vie vers le journal de transactions.
 *
 * ## Le problème corrigé
 *
 * L'AV disposait d'une table dédiée (`LifeInsurance` + `LifeInsuranceProduct`)
 * valorisée à la main, alimentant le patrimoine net **par le cash**
 * (`getExplicitCashTotalEur`), tandis que les mêmes supports pouvaient exister
 * comme positions du journal, alimentant le patrimoine **par `marketValue`**.
 * Trois conséquences, toutes constatées en base :
 *
 * 1. un support saisi des deux côtés comptait deux fois ;
 * 2. une UC actions était rangée dans « Cash », faussant l'allocation ;
 * 3. aucun prix de revient, donc aucune plus-value calculable sur l'AV.
 *
 * ## Ce que fait la migration
 *
 * Chaque support qui n'existe que dans la table devient une position du journal
 * (actif + transaction d'achat), comme n'importe quel autre placement. Les
 * supports déjà présents dans le journal ne sont **pas** recréés : leur ligne de
 * table est simplement retirée, puisqu'elle faisait doublon.
 *
 * Le contrat lui-même (`LifeInsurance`) survit : il porte l'assureur et la
 * **date d'ouverture**, dont dépend l'antériorité fiscale des huit ans. Cette
 * information n'a pas d'équivalent dans le journal et n'est pas redondante.
 *
 * ## Valorisation : quantité 1 × prix
 *
 * La table ne stocke qu'une valorisation, jamais un nombre de parts ni une
 * valeur liquidative. Reconstituer des parts fictives donnerait un faux
 * sentiment de précision ; on pose donc `quantity = 1` et
 * `unitPrice = valorisation`, exactement comme l'immobilier pose la quote-part
 * en quantité. Réévaluer le support revient à mettre à jour son `manualPrice`.
 *
 * Conséquence assumée : la plus-value d'un support migré part de sa
 * valorisation du jour de la migration, pas de son versement d'origine — cette
 * information n'a jamais existé dans la table, la migration ne peut pas
 * l'inventer.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d, zero } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import {
  euroFundAlreadyTaken,
  isEuroFundName,
  reconcileSupports,
  type LedgerSupport,
  type TableSupport,
} from "./reconcile";

/** Type de plateforme portant les contrats d'assurance-vie. */
export const LIFE_INSURANCE_PLATFORM_TYPE = "ASSURANCE_VIE";

/**
 * Classe d'actif d'un support migré.
 *
 * Un fonds euro est adossé à de l'obligataire ; toute autre unité de compte est
 * inconnue à ce stade et rangée en « AUTRE » plutôt que classée à tort en
 * actions. L'utilisateur reclasse ensuite depuis Positions, ce que l'UI permet
 * déjà.
 */
export function assetClassForSupport(name: string): string {
  return /fonds\s*(en\s*)?euros?/i.test(name) ? "OBLIGATIONS" : "AUTRE";
}

export type ContractAudit = {
  lifeInsuranceId: string;
  insurer: string;
  openDate: string | null;
  /** Fonds euro porté par le contrat lui-même. */
  cashEuro: string;
  /** Supports présents des deux côtés — comptés deux fois aujourd'hui. */
  duplicates: Array<{ tableName: string; ledgerName: string; valueEur: string }>;
  /** Supports à migrer vers le journal. */
  toMigrate: Array<{ name: string; valueEur: string }>;
};

export type AuditResult = {
  contracts: ContractAudit[];
  /**
   * Positions AV du journal qu'aucun contrat ne revendique — déjà correctes.
   *
   * Rendu une fois pour l'utilisateur, pas par contrat : rien ne relie une
   * position à un contrat précis, si bien que les lister sous chacun donnerait
   * l'illusion d'autant de positions qu'il y a de contrats.
   */
  ledgerOnly: Array<{ name: string; marketValueEur: string }>;
  /** Total actuellement compté deux fois dans le patrimoine net. */
  doubleCountedEur: string;
  /** Total qui disparaîtrait si on retirait la table sans migrer. */
  toMigrateEur: string;
};

type LoadedContract = {
  id: string;
  insurer: string;
  openDate: Date | null;
  cashEuro: Prisma.Decimal;
  currency: string;
  products: Array<{ id: string; name: string; currentValue: Prisma.Decimal }>;
};

type Loaded = {
  contracts: LoadedContract[];
  /** Positions AV du journal, tous contrats confondus. */
  ledger: LedgerSupport[];
  /**
   * Contrats portant déjà un fonds euro au journal.
   *
   * Lu sur `LifeInsuranceSupport` : `lifeInsuranceId` dit à quel contrat la
   * position appartient, `kind` dit ce qu'elle est. Le pool `ledger` étant
   * commun à tous les contrats, c'est le seul moyen de répondre « ce
   * contrat-ci » plutôt que « quelque part au journal ».
   */
  contractsWithLedgerEuroFund: Set<string>;
};

async function loadContracts(userId: string): Promise<Loaded> {
  // La valorisation vient de `getHoldings`, pas d'un calcul local.
  //
  // Une première version multipliait la quantité par `manualPrice` et rendait
  // 0 € pour tout support coté : le prix d'un actif suivi par un fournisseur
  // vit dans `PriceQuote`, pas sur l'actif. Réimplémenter la valorisation, c'est
  // s'engager à répliquer le repli manualPrice → quote → devise → FX ; autant
  // appeler le calcul qui fait déjà foi partout ailleurs.
  const { getHoldings } = await import("../portfolio/service");

  const [rows, holdings, euroFundSupports] = await Promise.all([
    prisma.lifeInsurance.findMany({
      where: { userId },
      include: { products: true },
      orderBy: { insurer: "asc" },
    }),
    getHoldings(userId, "EUR"),
    prisma.lifeInsuranceSupport.findMany({
      where: {
        kind: "FONDS_EURO",
        lifeInsuranceId: { not: null },
        asset: { is: { userId } },
      },
      select: { lifeInsuranceId: true },
    }),
  ]);

  const ledger: LedgerSupport[] = holdings
    .filter((h) => h.accountType === "AV")
    .map((h) => ({
      assetId: h.assetId,
      name: h.name,
      marketValueEur: d(h.marketValueEur).toFixed(2),
    }));

  return {
    ledger,
    contractsWithLedgerEuroFund: new Set(
      euroFundSupports
        .map((s) => s.lifeInsuranceId)
        .filter((id): id is string => id != null)
    ),
    contracts: rows.map((r) => ({
      id: r.id,
      insurer: r.insurer,
      openDate: r.openDate,
      cashEuro: r.cashEuro,
      currency: r.currency,
      products: r.products.map((p) => ({
        id: p.id,
        name: p.name,
        currentValue: p.currentValue,
      })),
    })),
  };
}

/**
 * Rapproche tous les contrats en une passe, contre le **même** pool de
 * positions.
 *
 * Rien ne relie techniquement un contrat de la table à une plateforme du
 * journal : le rapprochement doit donc considérer toutes les positions AV. Mais
 * il doit le faire globalement, pas contrat par contrat — sinon deux contrats
 * portant un support homonyme revendiqueraient tous deux la même position, et
 * le total « compté deux fois » serait lui-même compté deux fois.
 */
function reconcileAllContracts(loaded: Loaded) {
  const remaining = [...loaded.ledger];
  return loaded.contracts.map((c) => {
    const tableSupports: TableSupport[] = c.products.map((p) => ({
      id: p.id,
      name: p.name,
      valueEur: p.currentValue.toString(),
    }));
    const r = reconcileSupports(tableSupports, remaining);
    // Les positions appariées sortent du pool : elles ne peuvent plus être
    // revendiquées par un contrat suivant.
    const claimed = new Set(r.duplicates.map((dp) => dp.ledger.assetId));
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (claimed.has(remaining[i]!.assetId)) remaining.splice(i, 1);
    }
    return { contract: c, ...r };
  });
}

/**
 * État des lieux, sans rien modifier.
 *
 * Sert de mode « à blanc » avant migration, et d'écran de contrôle : un
 * patrimoine faux doit pouvoir être expliqué ligne à ligne avant d'être
 * corrigé.
 */
export async function auditLifeInsurance(userId: string): Promise<AuditResult> {
  const loaded = await loadContracts(userId);
  const perContract = reconcileAllContracts(loaded);

  let doubleCounted = zero();
  let toMigrateTotal = zero();

  const out: ContractAudit[] = perContract.map(
    ({ contract: c, duplicates, tableOnly }) => {
      for (const dup of duplicates) {
        doubleCounted = doubleCounted.plus(d(dup.table.valueEur));
      }
      for (const t of tableOnly) {
        toMigrateTotal = toMigrateTotal.plus(d(t.valueEur));
      }
      // Même règle que la migration, sans quoi le total annoncé ne
      // correspondrait pas à ce qui sera réellement créé.
      const cash = d(c.cashEuro.toString());
      if (
        cash.gt(0) &&
        !euroFundAlreadyTaken({
          contractId: c.id,
          tableOnly,
          contractsWithLedgerEuroFund: loaded.contractsWithLedgerEuroFund,
        })
      ) {
        toMigrateTotal = toMigrateTotal.plus(cash);
      }

      return {
        lifeInsuranceId: c.id,
        insurer: c.insurer,
        openDate: c.openDate?.toISOString() ?? null,
        cashEuro: c.cashEuro.toString(),
        duplicates: duplicates.map((dp) => ({
          tableName: dp.table.name,
          ledgerName: dp.ledger.name,
          valueEur: dp.table.valueEur,
        })),
        toMigrate: tableOnly.map((t) => ({
          name: t.name,
          valueEur: t.valueEur,
        })),
      };
    }
  );

  // Positions non revendiquées : celles du dernier état du pool après que
  // chaque contrat a consommé les siennes.
  const claimed = new Set(
    perContract.flatMap(({ duplicates }) =>
      duplicates.map((dp) => dp.ledger.assetId)
    )
  );

  return {
    contracts: out,
    ledgerOnly: loaded.ledger
      .filter((l) => !claimed.has(l.assetId))
      .map((l) => ({ name: l.name, marketValueEur: l.marketValueEur })),
    doubleCountedEur: doubleCounted.toFixed(2),
    toMigrateEur: toMigrateTotal.toFixed(2),
  };
}

export type MigrateResult = {
  /** Positions créées au journal. */
  created: number;
  /** Lignes de table retirées parce qu'elles faisaient doublon. */
  duplicatesRemoved: number;
  errors: string[];
};

/**
 * Migre les supports d'un utilisateur vers le journal.
 *
 * Idempotent : un support déjà rapproché d'une position du journal n'est jamais
 * recréé. Relancer la migration ne peut donc pas dupliquer une position.
 */
export async function migrateLifeInsuranceToLedger(
  userId: string,
  opts?: { dryRun?: boolean }
): Promise<MigrateResult> {
  const dryRun = opts?.dryRun ?? false;
  const result: MigrateResult = {
    created: 0,
    duplicatesRemoved: 0,
    errors: [],
  };

  const loaded = await loadContracts(userId);
  const perContract = reconcileAllContracts(loaded);

  for (const { contract: c, duplicates, tableOnly } of perContract) {
    // Le fonds euro du contrat devient un support comme un autre : sans cela,
    // il resterait dans un champ que le patrimoine ne lit plus.
    //
    // Sauf s'il a **déjà** été repris — soit qu'il figure encore dans la liste
    // des supports à migrer, soit qu'il vive déjà au journal de ce contrat. La
    // saisie historique le répétait presque toujours (champ `cashEuro` +
    // support « Fonds euro X »), et reprendre les deux créerait deux positions
    // pour les mêmes euros. Le support fait alors foi, et le champ est soldé.
    const cash = d(c.cashEuro.toString());
    const euroFundAlreadyListed = euroFundAlreadyTaken({
      contractId: c.id,
      tableOnly,
      contractsWithLedgerEuroFund: loaded.contractsWithLedgerEuroFund,
    });
    const pending = [...tableOnly];
    if (cash.gt(0) && !euroFundAlreadyListed) {
      pending.push({
        id: `cash:${c.id}`,
        name: `Fonds euro ${c.insurer}`.slice(0, 120),
        valueEur: cash.toString(),
      });
    }

    if (dryRun) {
      result.created += pending.length;
      result.duplicatesRemoved += duplicates.length;
      continue;
    }

    let platformId: string;
    try {
      platformId = await ensurePlatform(userId, c.insurer);
    } catch (e) {
      result.errors.push(
        `${c.insurer} : plateforme impossible (${e instanceof Error ? e.message : "échec"})`
      );
      continue;
    }

    // Fonds euro déjà porté par un support de la liste : le champ est soldé sur
    // la foi de ce support, sans créer de position supplémentaire.
    let cashMigrated = cash.gt(0) && euroFundAlreadyListed;
    for (const support of pending) {
      const isCash = support.id.startsWith("cash:");
      try {
        await createSupportPosition(userId, platformId, {
          name: support.name,
          valueEur: support.valueEur,
          currency: c.currency,
          // L'ouverture du contrat est la seule date connue ; à défaut, aujourd'hui.
          occurredAt: c.openDate ?? new Date(),
          // Rattachement au contrat dès la reprise : sans lui, la position
          // arriverait « sans contrat » dans l'onglet de saisie et l'encours du
          // contrat resterait à zéro.
          lifeInsuranceId: c.id,
          kind: isEuroFundName(support.name) ? "FONDS_EURO" : "UC",
        });
        result.created++;
        if (isCash) {
          cashMigrated = true;
        } else {
          await prisma.lifeInsuranceProduct.deleteMany({
            where: { id: support.id, lifeInsurance: { userId } },
          });
        }
      } catch (e) {
        result.errors.push(
          `${support.name} : ${e instanceof Error ? e.message : "échec"}`
        );
      }
    }

    // Le champ n'est remis à zéro que si SA position a bien été créée : le
    // vider sur la foi d'un autre support ferait disparaître le fonds euro du
    // patrimoine. La condition porte donc sur cette migration précise, pas sur
    // l'absence globale d'erreurs.
    if (cashMigrated) {
      await prisma.lifeInsurance.updateMany({
        where: { id: c.id, userId },
        data: { cashEuro: new Prisma.Decimal(0) },
      });
    }

    for (const dup of duplicates) {
      await prisma.lifeInsuranceProduct.deleteMany({
        where: { id: dup.table.id, lifeInsurance: { userId } },
      });
      result.duplicatesRemoved++;
    }
  }

  return result;
}

/** Plateforme AV du même nom, créée si absente. */
async function ensurePlatform(userId: string, insurer: string): Promise<string> {
  const name = insurer.trim().slice(0, 120) || "Assurance-vie";
  const existing = await prisma.platform.findFirst({
    where: { userId, name, type: LIFE_INSURANCE_PLATFORM_TYPE },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.platform.create({
    data: { userId, name, type: LIFE_INSURANCE_PLATFORM_TYPE },
    select: { id: true },
  });
  return created.id;
}

/** Actif + achat, en une transaction atomique. */
async function createSupportPosition(
  userId: string,
  platformId: string,
  input: {
    name: string;
    valueEur: string;
    currency: string;
    occurredAt: Date;
    lifeInsuranceId: string;
    kind: string;
  }
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId,
        name: input.name,
        assetClass: assetClassForSupport(input.name),
        accountType: "AV",
        currency: input.currency || "EUR",
        // Pas de cotation publique pour une UC : la valeur est saisie.
        priceProvider: "MANUAL",
        manualPrice: new Prisma.Decimal(input.valueEur),
        acquisitionDate: input.occurredAt,
      },
      select: { id: true },
    });

    await tx.lifeInsuranceSupport.create({
      data: {
        assetId: asset.id,
        lifeInsuranceId: input.lifeInsuranceId,
        kind: input.kind,
      },
    });

    await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId,
        assetId: asset.id,
        quantity: "1",
        unitPrice: input.valueEur,
        fees: "0",
        currency: input.currency || "EUR",
        fxRateToEur: "1",
        occurredAt: input.occurredAt.toISOString(),
        allowNegativeCash: true,
        notes: "[av:migration] Reprise du support depuis l'onglet Assurance-vie",
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );
  });
}
