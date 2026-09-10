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
 *
 * ## Date de la reprise : aujourd'hui, au taux du jour
 *
 * La reprise était datée de l'**ouverture du contrat** et convertie au taux de
 * ce jour-là (`fxRateToEurOnDate`). Le montant repris, lui, est la
 * valorisation d'aujourd'hui : le prix de revient sortait donc à un taux, la
 * valeur de marché à un autre, et l'écart des deux s'affichait comme une
 * plus-value. Mesuré sur un support de 10 000 USD repris au taux du
 * 02/03/2015 : +362,46 € de plus-value latente le jour même de la reprise,
 * sans qu'aucun euro ait bougé.
 *
 * Une valeur du jour se convertit au taux du jour. La transaction de reprise
 * est donc datée de l'instant courant — qui appartient par construction au
 * jour civil Europe/Paris d'aujourd'hui, cf. `app/lib/dates/paris.ts` — et
 * convertie par `fxRateToEur(devise)`, le même taux que celui dont
 * `getHoldings` se sert pour valoriser la position. Coût en euros et valeur en
 * euros partent donc du même produit `montant × taux` : la plus-value latente
 * d'un support repris vaut zéro au centime près (résidu mesuré : 2,6 × 10⁻⁷ €
 * sur 10 000 USD, l'arrondi du taux à dix décimales).
 *
 * Ce que la migration ne fait plus : inventer une antériorité. Le journal ne
 * connaît le support que depuis sa reprise, et le dit. L'antériorité fiscale,
 * elle, reste portée par `LifeInsurance.openDate`, qui ne bouge pas.
 *
 * Devise dont aucune source ne fonde le taux : rien n'est écrit, la ligne de
 * table survit, l'erreur nomme le support. Une relance reprend le support si
 * le taux redevient disponible.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d, zero } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { FxRateUnknownError, fxRateToEur } from "../market/fx";
import { assetClassForKind } from "./constants";
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
 * Classe d'actif d'un support repris, **déduite de son `kind`**.
 *
 * Un fonds euro est adossé à de l'obligataire ; toute autre unité de compte est
 * inconnue à ce stade et rangée en « AUTRE » plutôt que classée à tort en
 * actions. L'utilisateur reclasse ensuite depuis Positions, ce que l'UI permet
 * déjà. Cette règle est celle de `assetClassForKind`, et elle n'est pas
 * réécrite ici.
 *
 * Elle l'était : une expression régulière propre, plus étroite que
 * `isEuroFundName`. Un support « Sécurité Euro » repartait donc avec
 * `kind = "FONDS_EURO"` et `assetClass = "AUTRE"` — le fonds à capital garanti
 * atterrissait dans « Autre » dans la répartition par classe, et les positions
 * dépourvues de fiche (celles reprises avant que la migration n'en écrive une)
 * se relisaient ensuite en UC par `kindFromAssetClass`, capital annoncé à
 * risque là où l'assureur le garantit. Deux règles sur la même question
 * donnaient deux réponses.
 *
 * Une seule règle décide désormais : `isEuroFundName` pour le `kind`, et la
 * classe s'en déduit.
 */
export function assetClassForSupport(name: string): string {
  return assetClassForKind(isEuroFundName(name) ? "FONDS_EURO" : "UC");
}

export type ContractAudit = {
  lifeInsuranceId: string;
  insurer: string;
  openDate: string | null;
  /** Fonds euro porté par le contrat lui-même. */
  cashEuro: string;
  /**
   * Le champ ne sera ni repris ni soldé : un fonds euro existe déjà pour ce
   * contrat, avec son propre montant.
   *
   * La migration ne peut pas trancher — l'égalité des deux montants n'est pas
   * vérifiable, seul leur nom les rapproche. Le montant est donc conservé, et
   * signalé ici pour qu'un relevé d'assureur l'arbitre.
   */
  cashEuroNeedsReview: boolean;
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
  products: Array<{
    id: string;
    name: string;
    currentValue: Prisma.Decimal;
    /** Devise de `currentValue` — le modèle la porte, elle était perdue ici. */
    currency: string;
  }>;
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
  /**
   * À quel contrat appartient chaque position du journal.
   *
   * Absent de la carte = position non rattachée : le nom reste alors le seul
   * indice, et le rapprochement par présomption s'applique. Présent = la
   * question est tranchée, et aucun autre contrat ne peut la revendiquer.
   */
  contractByAssetId: Map<string, string>;
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

  const [rows, holdings, attachedSupports] = await Promise.all([
    prisma.lifeInsurance.findMany({
      where: { userId },
      include: { products: true },
      orderBy: { insurer: "asc" },
    }),
    getHoldings(userId, "EUR"),
    prisma.lifeInsuranceSupport.findMany({
      where: {
        lifeInsuranceId: { not: null },
        asset: { is: { userId } },
      },
      select: { lifeInsuranceId: true, assetId: true, kind: true },
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
      attachedSupports
        .filter((s) => s.kind === "FONDS_EURO")
        .map((s) => s.lifeInsuranceId)
        .filter((id): id is string => id != null)
    ),
    contractByAssetId: new Map(
      attachedSupports
        .filter((s): s is typeof s & { lifeInsuranceId: string } =>
          s.lifeInsuranceId != null
        )
        .map((s) => [s.assetId, s.lifeInsuranceId])
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
        currency: p.currency,
      })),
    })),
  };
}

/**
 * Rapproche tous les contrats en une passe, contre le **même** pool de
 * positions.
 *
 * Rien ne relie techniquement un contrat de la table à une plateforme du
 * journal : le rapprochement doit donc considérer les positions AV sans
 * rattachement connu. Mais il doit le faire globalement, pas contrat par
 * contrat — sinon deux contrats portant un support homonyme revendiqueraient
 * tous deux la même position, et le total « compté deux fois » serait lui-même
 * compté deux fois.
 *
 * ## Le rattachement l'emporte sur le nom
 *
 * Un ETF World se retrouve dans la moitié des assurances-vie. Deux contrats
 * peuvent donc porter un support homonyme sans que ce soit le même. Rapprochés
 * sur le seul nom, le premier contrat servi emportait la position : sa ligne de
 * table était supprimée comme « doublon » d'une position qui ne lui appartenait
 * pas, et le second migrait la sienne en doublant celle du premier. Une valeur
 * historique effacée sans contrepartie, et une position attribuée au mauvais
 * contrat.
 *
 * `LifeInsuranceSupport.lifeInsuranceId` tranche la question quand il est
 * renseigné, et il est le seul à pouvoir le faire. Une position rattachée n'est
 * donc proposée qu'à son contrat ; une position non rattachée reste offerte à
 * tous, le nom demeurant alors le seul indice disponible.
 */
function reconcileAllContracts(loaded: Loaded) {
  const remaining = [...loaded.ledger];
  return loaded.contracts.map((c) => {
    const tableSupports: TableSupport[] = c.products.map((p) => ({
      currency: p.currency,
      id: p.id,
      name: p.name,
      valueEur: p.currentValue.toString(),
    }));
    const recevables = remaining.filter((l) => {
      const proprietaire = loaded.contractByAssetId.get(l.assetId);
      return proprietaire == null || proprietaire === c.id;
    });
    const r = reconcileSupports(tableSupports, recevables);
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
      const alreadyTaken = euroFundAlreadyTaken({
        contractId: c.id,
        tableOnly,
        contractsWithLedgerEuroFund: loaded.contractsWithLedgerEuroFund,
      });
      if (cash.gt(0) && !alreadyTaken) {
        toMigrateTotal = toMigrateTotal.plus(cash);
      }

      return {
        lifeInsuranceId: c.id,
        insurer: c.insurer,
        openDate: c.openDate?.toISOString() ?? null,
        cashEuro: c.cashEuro.toString(),
        cashEuroNeedsReview: cash.gt(0) && alreadyTaken,
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

  /*
    Instant de la reprise : maintenant, et le même pour tout le passage.

    `occurredAt` est un instant, pas une clé de jour. Deux instants
    appartiennent au jour civil parisien d'aujourd'hui — minuit Paris et
    l'instant courant — et c'est le second qui est écrit, pour trois raisons :

    1. minuit heure de Paris vaut 22 h ou 23 h UTC **la veille**. Tout code qui
       tire un jour d'une date par `toISOString().slice(0, 10)` — et il y en a,
       jusque dans `resolveFx` — lirait donc la reprise comme datée d'hier ;
    2. un versement saisi ce matin à 9 h porte cet horaire. Une reprise estampée
       à minuit se rangerait avant lui, affirmant qu'elle l'a précédé ;
    3. `support-service.ts` répond déjà `?? new Date()` à la même question, et
       refuse de rétrodater un versement à l'ouverture du contrat. Deux règles
       pour une question, c'est exactement ce que ce fichier corrige ailleurs.

    Rien n'est perdu côté jour civil : `parisDayKey(now)` est aujourd'hui par
    construction, aucune conversion n'est nécessaire pour l'obtenir.

    Un seul instant pour tous les supports du passage : la reprise est un
    événement, pas une série d'événements espacés du temps des appels réseau.
  */
  const migratedAt = new Date();

  for (const { contract: c, duplicates, tableOnly } of perContract) {
    // Le fonds euro du contrat devient un support comme un autre : sans cela,
    // il resterait dans un champ que le patrimoine ne lit plus.
    //
    // Sauf s'il a **déjà** été repris — soit qu'il figure encore dans la liste
    // des supports à migrer, soit qu'il vive déjà au journal de ce contrat. La
    // saisie historique le répétait presque toujours (champ `cashEuro` +
    // support « Fonds euro X »), et reprendre les deux créerait deux positions
    // pour les mêmes euros. Le support fait alors foi, et rien n'est créé.
    //
    // Le champ n'est pas soldé pour autant. Il porte son propre montant, qui
    // n'est pas celui du support : sur le contrat Spirica du compte de
    // démonstration, 15 200 € d'un côté, 25 500 € de l'autre. Les rapprocher
    // repose sur un nom, pas sur une égalité ; les solder reviendrait à
    // décréter que ce sont les mêmes euros, et à en effacer 15 200 sans trace.
    // Le montant reste donc en place, annoncé hors encours par l'API comme
    // reliquat à reprendre — l'arbitrage appartient au relevé d'assureur, que
    // la migration n'a pas.
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
        // Le fonds euro du contrat, lui, est bien dans la devise du contrat.
        currency: c.currency,
      });
    }

    /*
      Le taux de chaque support, résolu **avant** le branchement à blanc.

      Un support dont le taux n'est pas démontré ne sera pas repris. Compter
      `pending.length` annonçait donc comme créables des positions que la passe
      réelle allait refuser, et c'est précisément ce nombre que l'opérateur lit
      avant de lancer `--apply`. La résolution est une lecture — aucune écriture
      n'a lieu, et un support en euros ne fait même pas d'appel sortant — donc
      elle a sa place des deux côtés du branchement.

      Un seul endroit résout le taux : la simulation et la migration ne peuvent
      pas en donner deux réponses différentes.
    */
    const repris: Array<{
      support: TableSupport;
      fxRateToEur: string;
    }> = [];
    for (const support of pending) {
      /*
        Jamais 1 par défaut, et jamais le taux d'une date passée.

        La migration écrivait `currency: c.currency` et `fxRateToEur: "1"`. Or
        `resolveFx` ne force le taux historique que sur les revenus : un ACHAT
        en devise avec un taux fourni à 1 le garde. Un produit à 10 000 USD
        devenait donc une position de 10 000 €, et l'inverse — un produit en
        euros dans un contrat en dollars — se voyait appliquer un change à un
        montant qui n'en avait pas besoin.

        Puis le taux est venu de `fxRateToEurOnDate(devise, openDate)`, ce qui
        n'a corrigé qu'à moitié : un taux d'il y a dix ans appliqué à une
        valorisation d'aujourd'hui. Le taux est désormais celui du jour, seul
        cohérent avec le montant qu'il convertit (voir l'en-tête du fichier).

        Taux non fondé : on renonce à ce support et on le dit. Inventer une
        parité écrirait un `grossAmountEur` que rien ne distinguerait plus d'un
        montant constaté — la raison pour laquelle `resolveFx` refuse déjà
        d'écrire dans ce cas.
      */
      let taux: string;
      try {
        taux = await fxRateToEur(support.currency);
      } catch (e) {
        result.errors.push(
          `${c.insurer} / ${support.name} : taux ${support.currency}→EUR ` +
            `indisponible (${
              e instanceof FxRateUnknownError
                ? "aucune source ne fonde cette devise"
                : e instanceof Error
                  ? e.message
                  : "échec"
            }), support non repris — ligne conservée, relancez la migration ` +
            `quand le taux sera disponible`
        );
        continue;
      }
      repris.push({ support, fxRateToEur: taux });
    }

    if (dryRun) {
      result.created += repris.length;
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

    // Le champ ne sera soldé que si SA position a été écrite — voir plus bas.
    // Partir de `true` parce qu'un fonds euro existe ailleurs effaçait le
    // montant sans qu'aucune position ne le porte : le seul cas de perte sèche
    // que la migration pouvait produire.
    let cashMigrated = false;
    for (const { support, fxRateToEur } of repris) {
      const isCash = support.id.startsWith("cash:");
      try {
        await createSupportPosition(userId, platformId, {
          name: support.name,
          valueEur: support.valueEur,
          currency: support.currency,
          fxRateToEur,
          occurredAt: migratedAt,
          /*
            La date d'acquisition, elle, peut être celle du contrat.

            Elle décrit depuis quand la position est détenue ; l'écriture de
            reprise décrit quand le journal l'a apprise. Les confondre
            afficherait un support souscrit en 2015 comme acquis ce matin.

            Ce qui interdit de rétrodater la **transaction** ne s'applique pas
            ici : `Asset.acquisitionDate` ne porte aucun montant, n'entre dans
            aucun calcul de prix de revient et n'alimente aucune série
            historique — c'est un attribut descriptif, nullable, qu'aucun total
            ne lit. Elle peut donc porter la date la plus vraie que la table
            connaisse sans fabriquer d'historique.

            Bornée à l'instant de reprise : une ouverture postérieure à
            aujourd'hui est une donnée fausse, pas une acquisition future.
          */
          acquisitionDate:
            c.openDate && c.openDate.getTime() <= migratedAt.getTime()
              ? c.openDate
              : migratedAt,
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
    /** Taux 1 unité `currency` → EUR du jour, résolu par l'appelant. */
    fxRateToEur: string;
    currency: string;
    /** Instant de l'écriture de reprise — aujourd'hui. */
    occurredAt: Date;
    /** Depuis quand la position est détenue — l'ouverture du contrat si connue. */
    acquisitionDate: Date;
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
        acquisitionDate: input.acquisitionDate,
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
        fxRateToEur: input.fxRateToEur,
        occurredAt: input.occurredAt.toISOString(),
        allowNegativeCash: true,
        notes: "[av:migration] Reprise du support depuis l'onglet Assurance-vie",
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );
  });
}
