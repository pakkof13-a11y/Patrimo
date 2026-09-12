/**
 * Séries de performance des contrats d'assurance-vie.
 *
 * Le calcul réutilise la machinerie déjà en place pour le P&L par classe :
 * rejeu du ledger pour les quantités **et le coût de revient** jour par jour,
 * cache de clôtures pour les cours. Rien n'est recalculé ici — une seconde
 * chaîne de valorisation finirait par diverger de la première, et c'est déjà
 * arrivé sur ce dépôt.
 *
 * Ce que ce module ajoute est le découpage : les supports d'assurance-vie sont
 * regroupés **par contrat**, puis convertis en série pondérée par le temps
 * (voir `performance.ts`), afin qu'un versement ne passe jamais pour un gain.
 */

import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { shiftDays } from "../dates/day-window";
import { getDailyCloses } from "../market/daily-closes";
import { valueHeldAtDay } from "../market/daily-valuation";
import {
  buildDailyAssetStates,
  buildDailyFlows,
  type DayKey,
} from "../portfolio/class-history";
import { enumerateDays } from "../portfolio/class-pnl-service";
import { mapDbTx } from "../portfolio/service";
import {
  buildPerformanceSeries,
  performanceYtd,
  rangeStartDay,
  type PerfRange,
  type PerformancePoint,
} from "./performance";

export type ContractSeries = {
  /** `null` pour la série consolidée de l'enveloppe. */
  lifeInsuranceId: string | null;
  points: PerformancePoint[];
  /** Performance sur toute la fenêtre demandée, en %. */
  performancePct: number | null;
  /** Performance depuis le 1er janvier, en %. */
  ytdPct: number | null;
  /**
   * Part de l'encours effectivement couverte par un historique de cours, en %.
   *
   * Un support valorisé à la main — le cas de presque tous les fonds en euros —
   * n'a pas d'historique : sa valeur d'hier est inconnue, donc sa performance
   * aussi. Ces supports sont **exclus** de la courbe plutôt que comptés à zéro,
   * ce qui reviendrait à affirmer qu'ils n'ont rien rapporté. Le taux de
   * couverture dit à l'écran quelle part de l'épargne la courbe décrit
   * réellement — et `0` veut dire qu'il n'y a pas de courbe à montrer.
   *
   * ## Le dénominateur est un encours, pas un mélange
   *
   * Il additionne la valeur de marché des supports couverts et la
   * **valorisation actuelle** des autres — celle que ces supports affichent
   * partout ailleurs à l'écran (`listSupports.currentValueEur`), donc leur
   * relevé saisi à la main. Le coût de revient y figurait à leur place, ce qui
   * faisait deux grandeurs de nature différente sous une même somme : un fonds
   * euro de 10 000 € versés valant 10 900 € au relevé rendait
   * 20 000 / 30 000 = 66,67 % de couverture pour un encours réel de 30 900 €,
   * soit 64,72 %. Le ratio surestimait donc la part décrite par la courbe —
   * d'autant plus que le hors-mesure a capitalisé.
   *
   * Ce que le ratio annonce reste inchangé : la part de l'épargne dont la
   * courbe décrit l'évolution. Ce qui change est que sa base est l'épargne
   * telle qu'elle vaut aujourd'hui.
   */
  coveragePct: number;
  /**
   * Encours couvert par des cours, en euros, au dernier jour **publiable**.
   *
   * Pour un contrat, le dernier jour de la fenêtre, ou `0` s'il y est amputé.
   * Pour le total, le dernier jour complet du total — voir la dérivation.
   */
  coveredValueEur: number;
  /**
   * Encours sans historique, au **coût de revient** des supports encore
   * détenus au dernier jour de la fenêtre (CUMP × quantité restante).
   *
   * C'est le montant investi restant, et non une valeur : un fonds euro de
   * 10 000 € versés qui affiche 10 900 € au relevé entre ici pour 10 000 €.
   * Faute d'historique, sa valeur à cette date est inconnue, et l'inventer
   * serait pire que l'assumer. Une position soldée en sort — elle n'a plus
   * rien à couvrir, quel qu'ait été le produit de son rachat.
   *
   * Ce montant **ne sert plus de dénominateur** à `coveragePct` : il dit ce qui
   * a été investi hors mesure, pas ce que cela vaut. Les deux réponses sont
   * publiées côte à côte.
   */
  uncoveredValueEur: number;
  /**
   * Encours sans historique à sa **valorisation actuelle**, en euros.
   *
   * La même valeur que l'écran des supports affiche pour ces lignes : quantité
   * détenue × prix relu par `getHoldings` (relevé manuel, cotation, change).
   * Le fonds euro de l'exemple ci-dessus entre ici pour 10 900 €, et pour
   * 10 000 € dans `uncoveredValueEur`.
   *
   * Sans aucun prix, `getHoldings` retombe de lui-même sur le coût de revient :
   * les deux grandeurs coïncident alors, et aucune position ne vaut zéro faute
   * de cours. Une valeur inconnue n'est jamais nulle.
   */
  uncoveredCurrentValueEur: number;
};

export type LifeInsurancePerformance = {
  range: PerfRange;
  fromDay: DayKey;
  toDay: DayKey;
  /** Enveloppe entière, tous contrats confondus. */
  total: ContractSeries;
  /** Une entrée par contrat portant au moins un support sur la fenêtre. */
  byContract: ContractSeries[];
};

/** Garde-fou : au-delà, la série est illisible et le calcul coûteux. */
const MAX_DAYS = 1900;

/**
 * Série de performance de l'enveloppe et de chaque contrat.
 *
 * `range = "all"` part de la première opération connue sur un support
 * d'assurance-vie : la seule borne qui ait un sens, et qu'aucune durée fixe ne
 * saurait deviner.
 */
export async function getLifeInsurancePerformance(
  userId: string,
  range: PerfRange,
  now = new Date()
): Promise<LifeInsurancePerformance> {
  const toDay = parisDayKey(now);

  // Les supports d'assurance-vie sont les actifs de l'enveloppe AV ; leur
  // contrat de rattachement vit sur la fiche support.
  const assets = await prisma.asset.findMany({
    where: { userId, accountType: "AV" },
    select: { id: true, lifeSupport: { select: { lifeInsuranceId: true } } },
  });

  const contractByAsset = new Map<string, string | null>(
    assets.map((a) => [a.id, a.lifeSupport?.lifeInsuranceId ?? null])
  );
  const avAssetIds = new Set(contractByAsset.keys());

  if (avAssetIds.size === 0) {
    return emptyResult(range, toDay);
  }

  const txRows = await prisma.transaction.findMany({
    where: { userId, assetId: { in: [...avAssetIds] } },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  if (txRows.length === 0) {
    return emptyResult(range, toDay);
  }

  const firstDay = parisDayKey(txRows[0]!.occurredAt);
  const requested = rangeStartDay(range, now);
  // La fenêtre ne commence jamais avant la première opération : afficher deux
  // ans de plat avant l'ouverture du contrat ne renseigne sur rien.
  let fromDay = requested && requested > firstDay ? requested : firstDay;

  /*
    Le plafond de profondeur se pose sur la borne **basse**, jamais sur la
    série déjà énumérée.

    `enumerateDays` s'arrête de lui-même au bout de 1 900 jours, en comptant
    depuis le début : « tout l'historique » d'un contrat ouvert en 2018 rendait
    une fenêtre qui s'achevait en 2023, soit une courbe arrêtée trois ans avant
    aujourd'hui — et, depuis que l'encours hors mesure se lit au dernier jour,
    un stock relevé à cette date-là. Le `slice` de la queue qui suivait n'y
    changeait rien : la queue manquait déjà. On recule donc d'au plus 1 900
    jours **depuis le dernier jour** : la série finit toujours au jour, quitte à
    commencer plus tard que demandé.
  */
  const earliestDay = shiftDays(
    new Date(`${toDay}T12:00:00Z`),
    -(MAX_DAYS - 1)
  );
  if (fromDay < earliestDay) fromDay = earliestDay;

  const days = enumerateDays(fromDay, toDay);
  if (days.length === 0) return emptyResult(range, toDay);
  fromDay = days[0]!;

  const ledgerTxs = txRows.map(mapDbTx);
  /*
    Un seul rejeu du journal pour les deux grandeurs qu'on en tire : la
    quantité détenue chaque jour, qui porte la courbe, et le coût de revient
    des positions encore détenues, qui porte l'encours hors mesure — un stock,
    cf. plus bas.
  */
  const states = buildDailyAssetStates(ledgerTxs, days);
  const flows = buildDailyFlows(ledgerTxs);

  const heldAssetIds = new Set<string>();
  for (const day of days) {
    const qtyOfDay = states.get(day)?.quantityByAsset ?? {};
    for (const [assetId, qty] of Object.entries(qtyOfDay)) {
      if (qty !== 0 && avAssetIds.has(assetId)) heldAssetIds.add(assetId);
    }
  }

  /*
    Lecture seule : `refresh: false`.

    Cet appel remplissait le cache depuis les fournisseurs à chaque ouverture
    de l'écran assurance-vie. Une consultation devenait donc une écriture, et
    la courbe dépendait de la disponibilité de Yahoo au moment du regard. La
    tâche planifiée entretient `AssetDailyClose` sans qu'aucun écran soit
    ouvert ; il n'y a plus de raison qu'une lecture s'en charge.
  */
  const { closes } = await getDailyCloses(
    userId,
    [...heldAssetIds],
    fromDay,
    toDay,
    { refresh: false }
  );

  /**
   * Un support n'entre dans la courbe que s'il a un historique. Les autres —
   * fonds en euros valorisés à la main, UC sans cotation — sont comptés à part,
   * à leur coût de revient, pour dire quelle part de l'épargne échappe à la
   * mesure.
   */
  const covered = new Set(
    [...heldAssetIds].filter((id) => (closes.get(id)?.size ?? 0) > 0)
  );

  /** Un seau de valeurs et de flux journaliers par contrat, plus le total. */
  type Bucket = {
    values: Map<DayKey, number>;
    netFlows: Map<DayKey, number>;
    /**
     * Jours où au moins un support couvert n'avait aucune clôture à reporter.
     *
     * Ces jours sont retirés de la série au lieu d'être publiés amputés : la
     * boucle précédente sautait le support sans cours mais gardait le total,
     * si bien qu'un contrat de quatre supports dont un seul manquait affichait
     * un décrochage — puis remontait dès que le cache se remplissait. Aucune
     * position n'avait bougé.
     */
    incompleteDays: Set<DayKey>;
    /**
     * Coût de revient des supports sans historique **encore détenus** au
     * dernier jour de la fenêtre — leur montant investi restant.
     */
    uncoveredBookValue: number;
    /**
     * Valorisation **actuelle** de ces mêmes supports — ce qu'ils valent, et
     * non ce qu'ils ont coûté. C'est la base du taux de couverture : la courbe
     * décrit une part de l'encours du jour, pas une part des versements.
     */
    uncoveredCurrentValue: number;
  };
  const nouveauSeau = (): Bucket => ({
    values: new Map(),
    netFlows: new Map(),
    incompleteDays: new Set(),
    uncoveredBookValue: 0,
    uncoveredCurrentValue: 0,
  });

  /*
    Un seau par contrat, et **pas** de seau pour le total.

    Le total était obtenu par `bucketFor(null)`, alors que `null` est aussi la
    clé d'un support sans contrat — le cas que `overview.ts` modélise sous
    `unattachedSupportCount`. Pour un tel support, `bucketFor(key)` rendait
    l'objet total lui-même, et les trois paires d'additions qui suivaient
    ajoutaient deux fois le même montant au même seau. `byContract` filtrant
    `key !== null`, rien ne compensait : 10 000 € de support orphelin
    ressortaient à 20 000 € au consolidé.

    Le total est désormais **dérivé** des seaux, plus bas : chaque grandeur s'y
    compose comme elle doit se composer, et le consolidé reste la somme de ce
    que les parties publient.
  */
  const buckets = new Map<string | null, Bucket>();
  const bucketFor = (key: string | null): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = nouveauSeau();
      buckets.set(key, b);
    }
    return b;
  };

  for (const day of days) {
    const qtyByAsset = states.get(day)?.quantityByAsset ?? {};
    const flowsOfDay = flows.get(day)?.netFlowByAsset ?? {};

    // Chaque seau doit avoir un point par jour, même nul : sans cela, un
    // contrat sans mouvement disparaîtrait de la courbe ces jours-là.
    for (const b of buckets.values()) {
      if (!b.values.has(day)) b.values.set(day, 0);
    }

    /*
      Les supports du jour sont regroupés par contrat, puis valorisés d'un
      bloc : `valueHeldAtDay` applique la règle « complet, ou absent » et le
      report depuis la dernière clôture observée, partagée avec la poche crypto.
    */
    const heldByContract = new Map<string | null, Array<{ assetId: string; quantity: number }>>();
    for (const [assetId, qty] of Object.entries(qtyByAsset)) {
      if (!covered.has(assetId) || qty === 0) continue;
      const key = contractByAsset.get(assetId) ?? null;
      const list = heldByContract.get(key) ?? [];
      list.push({ assetId, quantity: qty });
      heldByContract.set(key, list);
    }

    for (const [key, held] of heldByContract) {
      const b = bucketFor(key);
      if (!b.values.has(day)) b.values.set(day, 0);

      const valuation = valueHeldAtDay(held, closes, day);
      if (!valuation.complete) {
        // Le contrat est amputé ce jour-là et ne peut publier aucun montant.
        // Le total héritera de ce jour incomplet à la dérivation.
        b.incompleteDays.add(day);
        continue;
      }
      b.values.set(day, (b.values.get(day) ?? 0) + valuation.valueEur);
    }

    for (const [assetId, flow] of Object.entries(flowsOfDay)) {
      if (!covered.has(assetId) || flow === 0) continue;
      const b = bucketFor(contractByAsset.get(assetId) ?? null);
      b.netFlows.set(day, (b.netFlows.get(day) ?? 0) + flow);
    }
  }

  const lastDay = days[days.length - 1]!;

  /*
    Encours sans historique : le **coût de revient** des supports encore
    détenus, et non une somme de flux.

    C'est un stock, et il se lit dans le ledger — `costBasisByAsset` au dernier
    jour, soit CUMP × quantité restante. Les flux nets, eux, embarquent le
    résultat **réalisé** des parts rachetées : les deux coïncident tant qu'il
    n'y a pas de rachat, et divergent dès le premier, exactement du réalisé. Un
    support versé 10 000 dont 40 % sont rachetés pour 4 400 annonçait 5 600 au
    lieu de 6 000 ; rachetés 3 600, 6 400 au lieu de 6 000 ; soldé à 9 500, il
    gardait 500 € à couvrir **à vie**, pour une position qui n'existe plus.

    Rien à plafonner ici : un coût de revient n'est pas négatif, et une
    position soldée n'en a plus — le ledger l'a effacée. Reposer un
    `Math.max(0, …)` ne protégerait plus de rien et masquerait un défaut de
    rejeu au lieu de le montrer.

    La profondeur ne dépend pas de la fenêtre affichée : le rejeu applique
    toutes les écritures jusqu'au jour, dans la fenêtre ou avant elle. Un fonds
    euro versé il y a trois ans, sans un mouvement depuis, est donc bien là —
    le compter sur les seuls flux de la fenêtre ferait passer la couverture
    pour 100 % alors que la courbe ignore la moitié de l'épargne.
  */
  const stateOfLastDay = states.get(lastDay);
  const costOfLastDay = stateOfLastDay?.costBasisByAsset ?? {};
  /** Supports hors mesure encore détenus, et le seau qui les porte. */
  const uncoveredHeld: Array<{ assetId: string; bucket: Bucket }> = [];
  for (const [assetId, qty] of Object.entries(
    stateOfLastDay?.quantityByAsset ?? {}
  )) {
    if (qty === 0 || !avAssetIds.has(assetId) || covered.has(assetId)) continue;
    const b = bucketFor(contractByAsset.get(assetId) ?? null);
    b.uncoveredBookValue += costOfLastDay[assetId] ?? 0;
    uncoveredHeld.push({ assetId, bucket: b });
  }

  /*
    Ce que ces supports **valent**, pour le seul taux de couverture.

    La source est `getHoldings`, celle que `listSupports` expose déjà sous
    `currentValueEur` : quantité détenue × prix relu — relevé manuel, cotation,
    conversion de devise. Recalculer cette chaîne ici en ferait une seconde,
    qui finirait par annoncer un encours différent de celui que la liste des
    supports affiche à trois centimètres de la courbe.

    Import dynamique, comme `listSupports` et `revalueSupport`, et **jamais
    appelé** quand aucun support hors mesure n'est détenu : c'est le cas d'un
    contrat entièrement en UC cotées, qui ne doit pas payer les allers-retours
    du moteur de positions pour un dénominateur vide.

    Cet appel demande les taux de change du jour (`getEurRates`, borné et servi
    par cache). Il ne collecte aucune cotation et n'écrit rien — la règle T-04
    porte sur les collecteurs, et le même écran paie déjà cet appel pour sa
    liste de supports.

    Une position absente du moteur de positions retombe sur son coût de
    revient : c'est le montant investi, connu et non nul, et non un zéro qui
    ferait passer la couverture pour totale.
  */
  if (uncoveredHeld.length > 0) {
    const { getHoldings } = await import("../portfolio/service");
    const holdings = await getHoldings(userId, "EUR");
    const valueByAsset = new Map(
      holdings.map((h) => [h.assetId, Number(h.marketValueEur)])
    );
    for (const { assetId, bucket } of uncoveredHeld) {
      const valeur = valueByAsset.get(assetId);
      bucket.uncoveredCurrentValue +=
        valeur != null && Number.isFinite(valeur)
          ? valeur
          : (costOfLastDay[assetId] ?? 0);
    }
  }

  /*
    Le total, dérivé des seaux — jamais accumulé en parallèle.

    Chaque grandeur se compose comme elle doit se composer :

    - les **valeurs** et les **flux** s'additionnent jour par jour ;
    - un jour **incomplet** chez un seul contrat rend le total incomplet ce
      jour-là : il manque une pièce, le total ne peut pas être publié **à cette
      date**. Ce n'est pas dire qu'il n'a pas de valeur : il en a une au dernier
      jour complet, et c'est celle-là qu'il publie (voir `dernierJourPubliable`) ;
    - l'**encours non couvert** s'additionne tel quel. C'est une somme de coûts
      de revient de positions détenues : chaque part est positive ou nulle par
      construction, donc le total est la somme de ses parties sans qu'aucun
      plafond n'ait à le rattraper. Le `Math.max(0, …)` qui traînait ici
      corrigeait un défaut de la source — des flux nets négatifs sur un support
      soldé — que le coût de revient n'a plus.
  */
  const total = nouveauSeau();
  for (const day of days) {
    let valeur = 0;
    let flux = 0;
    for (const b of buckets.values()) {
      if (b.incompleteDays.has(day)) total.incompleteDays.add(day);
      valeur += b.values.get(day) ?? 0;
      flux += b.netFlows.get(day) ?? 0;
    }
    total.values.set(day, valeur);
    if (flux !== 0) total.netFlows.set(day, flux);
  }
  for (const b of buckets.values()) {
    total.uncoveredBookValue += b.uncoveredBookValue;
    total.uncoveredCurrentValue += b.uncoveredCurrentValue;
  }

  /**
   * Dernier jour de la fenêtre que ce seau peut publier — `null` s'il n'en a
   * aucun.
   *
   * Le total le cherche en remontant. Un seul contrat troué rend le consolidé
   * incomplet ce jour-là, et si ce jour était le dernier de la fenêtre, le
   * total tombait à `0 €` avec une série vide — pendant qu'un autre contrat
   * avait un historique parfaitement complet et connu, 20 000 € qu'il suffisait
   * de lire à la veille. Un jour amputé n'est pas une valeur nulle : le total
   * publie la valeur de son dernier jour complet, et la courbe s'arrête là
   * plutôt que de continuer sur des jours dont il manque une pièce.
   *
   * Aucun jour complet du tout : le comportement d'avant, `0` et pas de
   * courbe. Il n'y a alors rien à publier, et ce n'est pas un repli.
   *
   * ## Ce qui rend un dernier jour incomplet
   *
   * `closeAtOrBefore` reportant toute clôture antérieure, un support n'est
   * amputé un jour donné que s'il est détenu **avant sa première clôture
   * connue**. Comme le cache ne rend que les clôtures de la fenêtre, dont la
   * borne haute est le dernier jour, ce cas se situe aujourd'hui en tête de
   * fenêtre plutôt qu'en queue. La règle posée ici est donc celle de la
   * dérivation elle-même — le consolidé ne vaut jamais zéro parce qu'une de
   * ses parties est muette — et non le rattrapage d'un écran observé.
   */
  const dernierJourPubliable = (b: Bucket): DayKey | null => {
    for (let i = days.length - 1; i >= 0; i--) {
      const day = days[i]!;
      if (!b.incompleteDays.has(day)) return day;
    }
    return null;
  };

  /**
   * `refDay` : le jour dont la valeur et la couverture sont publiées.
   *
   * Chaque **contrat** garde sa règle propre — le dernier jour de la fenêtre,
   * ou rien s'il y est amputé. Seule la dérivation du total remonte au dernier
   * jour complet : un contrat troué aujourd'hui doit le dire, et il le dit en
   * ne publiant pas ; c'est le consolidé, lui, qui a autre chose à publier.
   */
  const toSeries = (
    key: string | null,
    b: Bucket,
    refDay: DayKey | null
  ): ContractSeries => {
    const coveredValueEur = refDay == null ? 0 : (b.values.get(refDay) ?? 0);
    const uncoveredValueEur = b.uncoveredBookValue;
    const uncoveredCurrentValueEur = b.uncoveredCurrentValue;
    // Un encours contre un encours : valeur de marché des supports couverts,
    // valorisation actuelle des autres. Le coût de revient reste publié, il
    // n'entre simplement plus dans ce ratio.
    const base = coveredValueEur + uncoveredCurrentValueEur;
    const coveragePct = base > 0 ? (coveredValueEur / base) * 100 : 0;

    // Aucun jour publiable, ou aucune couverture : il n'y a pas de courbe
    // plate à montrer, il n'y a pas de courbe. Rendre une série à 0 %
    // laisserait croire à un contrat inerte.
    if (refDay == null || coveredValueEur <= 0) {
      return {
        lifeInsuranceId: key,
        points: [],
        performancePct: null,
        ytdPct: null,
        coveragePct: 0,
        coveredValueEur: 0,
        uncoveredValueEur,
        uncoveredCurrentValueEur,
      };
    }

    const points = buildPerformanceSeries(
      days
        // Un jour incomplet n'a pas de valeur publiable : il sort de la série
        // plutôt que d'y entrer amputé. La série s'arrête au jour publié :
        // au-delà, il n'y a que des jours amputés — les prolonger ferait
        // finir la courbe sur une valeur que le total ne reconnaît pas.
        .filter((day) => day <= refDay && !b.incompleteDays.has(day))
        .map((day) => ({
          day,
          valueEur: b.values.get(day) ?? 0,
          netFlowEur: b.netFlows.get(day) ?? 0,
        }))
    );
    const first = points[0];
    const last = points[points.length - 1];

    return {
      lifeInsuranceId: key,
      points,
      performancePct:
        first && last && first.index > 0 && points.length > 1
          ? (last.index / first.index - 1) * 100
          : null,
      ytdPct: performanceYtd(points),
      coveragePct,
      coveredValueEur,
      uncoveredValueEur,
      uncoveredCurrentValueEur,
    };
  };

  return {
    range,
    fromDay,
    toDay,
    total: toSeries(null, total, dernierJourPubliable(total)),
    byContract: [...buckets.entries()]
      .filter(([key]) => key !== null)
      .map(([key, b]) =>
        toSeries(key, b, b.incompleteDays.has(lastDay) ? null : lastDay)
      ),
  };
}

function emptyResult(range: PerfRange, toDay: DayKey): LifeInsurancePerformance {
  return {
    range,
    fromDay: toDay,
    toDay,
    total: {
      lifeInsuranceId: null,
      points: [],
      performancePct: null,
      ytdPct: null,
      coveragePct: 0,
      coveredValueEur: 0,
      uncoveredValueEur: 0,
      uncoveredCurrentValueEur: 0,
    },
    byContract: [],
  };
}
