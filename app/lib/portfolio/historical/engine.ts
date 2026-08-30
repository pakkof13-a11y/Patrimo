/**
 * Moteur de valorisation historique — **la** source de vérité du patrimoine.
 *
 * Ce module répond à une seule question, pour n'importe quelle date :
 *
 * ```
 * grossAssets(D) = securities(D) + crypto(D) + realEstate(D) + lifeInsurance(D)
 *                + cash(D) + alternatives(D) + employeeSavings(D) + otherAssets(D)
 * netWorth(D)    = grossAssets(D) − liabilities(D)
 * ```
 *
 * La courbe, le point du jour et les KPI l'appellent tous les trois. C'est le
 * point du chantier : jusqu'ici la courbe reconstruisait « positions + cash du
 * journal » quand la carte du dashboard affichait « positions + poches de cash
 * + alternatifs + épargne salariale ». Deux périmètres, deux réponses, et une
 * marche entre le dernier point historique et le point live qui n'était le
 * reflet d'aucun mouvement réel — seulement d'un changement de définition.
 *
 * ## Coût de calcul
 *
 * Tout est chargé **une fois** (`loadHistoricalInputs`), puis rejoué en
 * mémoire. Aucune requête n'est émise pendant la boucle des jours : reconstruire
 * cinq ans coûte le même nombre de requêtes qu'une seule journée.
 *
 * ## Cash du journal
 *
 * `ledgerCash` est calculé mais **exclu** de `grossAssets`, parce que la source
 * de vérité du cash dans ce produit est la saisie explicite (onglet Banques,
 * livrets, enveloppes) — cf. `cash/pockets.ts`. Il reste exposé dans le point
 * de contrôle : un écart entre les deux se lit alors, au lieu de se glisser
 * silencieusement dans le total.
 *
 * Conséquence assumée sur les flux : puisque le cash du journal sort du
 * périmètre, un achat de titres fait entrer de la valeur sans qu'un euro n'en
 * sorte. C'est donc bien un **flux externe**, et il est compté comme tel — sans
 * quoi chaque achat se lirait comme une plus-value instantanée.
 */

import { parisDayKey } from "../../dates/paris";
import { toEur } from "../../accounting/fx";
import { applyTransaction, createEmptyLedger } from "../../accounting/ledger";
import type { LedgerState, LedgerTx } from "../../accounting/types";
import { d, zero, type Decimal } from "../../money/decimal";
import { closeAtOrBefore, type DailyCloseIndex } from "../class-history";
import {
  VALUATION_ASSET_CLASSES,
  type ValuationAssetClass,
} from "./types";
import {
  OBSERVED_AT_DAY,
  OBSERVED_AT_INSTANT,
  PRICE_ORIGINS,
  valuePositions,
  weakestOrigin,
  type PriceOrigin,
  type PriceResolver,
} from "./price-resolver";
import {
  buildCashSleeve,
  buildCrowdlendingSleeve,
  buildEmployeeSavingsSleeve,
  buildLiabilitiesSleeve,
  buildMetalsSleeve,
  buildPrivateEquitySleeve,
  buildTangiblesSleeve,
  type CashAccountRow,
  type CashEventRow,
  type CrowdlendingRow,
  type EmployeeSavingsRow,
  type LiabilityRow,
  type MetalRow,
  type PrivateEquityRow,
  type TangibleRow,
} from "./components";
import {
  enumerateDays,
  indexFlowsByDay,
  sumTimelinesAt,
  ValueTimeline,
} from "./timeline";
import type {
  DayKey,
  ExternalFlow,
  HistoricalDataStatus,
  PortfolioValuationPoint,
  ValuationComponent,
} from "./types";

/**
 * Tout ce dont le moteur a besoin, chargé une fois pour toutes.
 *
 * Volontairement composé de types simples : le moteur reste testable sans base
 * de données, et l'adaptateur Prisma (`loadHistoricalInputs`) est la seule
 * pièce à connaître le schéma.
 */
export type HistoricalInputs = {
  transactions: LedgerTx[];
  /** Classe d'actif par `assetId`, pour ventiler la valeur de marché. */
  assetClassById: Map<string, string>;
  /**
   * Classe d'actif brute — sans la surcharge assurance-vie de `assetClassById`.
   * C'est elle qui porte la ventilation par classe, parce qu'elle seule est
   * fixée à la création et ne peut donc pas réécrire le passé.
   */
  rawAssetClassById: Map<string, string>;
  /**
   * Actifs écartés du patrimoine — mêmes règles que le moteur du jour.
   *
   * Une position DeFi/NFT explicitement exclue, ou un NFT emprunté qui devra
   * être restitué. `getPortfolioBundle` les saute déjà ; la courbe les comptait
   * encore, si bien que son dernier point contredisait la tuile de patrimoine
   * qui décrit pourtant le même instant.
   *
   * Leurs transactions restent au journal : le décaissement d'achat a bien eu
   * lieu, seule la contrepartie disparaît des totaux. C'est exactement ce que
   * fait le moteur du jour — l'argent est sorti et ne revient pas.
   */
  excludedAssetIds: Set<string>;
  closes: DailyCloseIndex;
  cashAccounts: CashAccountRow[];
  cashEvents: CashEventRow[];
  metals: MetalRow[];
  privateEquity: PrivateEquityRow[];
  crowdlending: CrowdlendingRow[];
  tangibles: TangibleRow[];
  employeeSavings: EmployeeSavingsRow[];
  liabilities: LiabilityRow[];
};


/**
 * Part des positions valorisées autrement qu'au prix de revient.
 *
 * Un ratio de comptage plutôt que de valeur : à ce niveau, le montant retenu
 * pour une position sans cours **est** son coût, si bien qu'un ratio en euros
 * dirait « valorisé » d'un montant qui ne l'est pas. Compter les positions dit
 * la vérité — « trois lignes sur quarante n'ont pas d'histoire ».
 */
function coverageOf(totalPositions: number, unavailable: number): number {
  if (totalPositions <= 0) return 1;
  const valued = Math.max(0, totalPositions - unavailable);
  return valued / totalPositions;
}

/**
 * Normalise une classe d'actif vers la taxonomie à six valeurs.
 *
 * `Asset.assetClass` est contraint par un `z.enum` à la création, mais la
 * colonne est une chaîne libre : une valeur héritée ou inconnue ne doit pas
 * disparaître de la ventilation. Elle rejoint `AUTRE`, qui est précisément la
 * classe des actifs que la taxonomie ne sait pas nommer.
 */
function assetClassOf(raw: string | undefined): ValuationAssetClass {
  return (VALUATION_ASSET_CLASSES as readonly string[]).includes(raw ?? "")
    ? (raw as ValuationAssetClass)
    : "AUTRE";
}

/**
 * Flux externes d'un point, ventilés par classe d'actif.
 *
 * Un `Record` complet plutôt qu'une `Map` partielle : toutes les classes
 * existent toujours, à zéro par défaut. Une classe absente et une classe sans
 * flux ne doivent pas se distinguer, sinon la somme des classes cesserait
 * d'être comparable au total.
 */
export type FlowsByAssetClass = Record<ValuationAssetClass, Decimal>;

function emptyFlows(): FlowsByAssetClass {
  const out = {} as FlowsByAssetClass;
  for (const c of VALUATION_ASSET_CLASSES) out[c] = zero();
  return out;
}

function addFlow(
  flows: FlowsByAssetClass,
  cls: ValuationAssetClass,
  amount: Decimal
): void {
  flows[cls] = flows[cls].plus(amount);
}

function totalFlows(flows: FlowsByAssetClass): Decimal {
  let total = zero();
  for (const c of VALUATION_ASSET_CLASSES) total = total.plus(flows[c]);
  return total;
}

/**
 * Compartiment d'une poche → classe d'actif.
 *
 * Les poches sans position au journal n'ont pas de `assetClass` : leur flux
 * doit néanmoins rejoindre une classe, sous peine de casser l'identité
 * `Σ flux de classe = flux externes`. La trésorerie est du cash sans
 * ambiguïté ; les alternatifs et l'épargne salariale n'ont pas de classe
 * dédiée dans cette taxonomie à six valeurs et rejoignent `AUTRE` — le même
 * routage que celui déjà appliqué à leurs **valeurs**, pour que flux et valeur
 * ne se retrouvent jamais dans deux classes différentes.
 */
function classOfComponent(comp: ValuationComponent): ValuationAssetClass {
  switch (comp) {
    case "cash":
      return "CASH";
    case "crypto":
      return "CRYPTO";
    case "realEstate":
      return "IMMOBILIER";
    default:
      return "AUTRE";
  }
}

/** Ventilation d'une classe d'actif du journal vers un compartiment. */
function componentOfAssetClass(assetClass: string | undefined): ValuationComponent {
  switch (assetClass) {
    case "ACTIONS":
    case "OBLIGATIONS":
      return "securities";
    case "CRYPTO":
      return "crypto";
    case "IMMOBILIER":
      return "realEstate";
    case "ASSURANCE_VIE":
      return "lifeInsurance";
    default:
      return "otherAssets";
  }
}

type SleeveState = {
  timelines: ValueTimeline[];
  flowsByDay: Map<DayKey, Decimal>;
  undatable: number;
};

const toSleeveState = (b: {
  timelines: ValueTimeline[];
  flows: ExternalFlow[];
  undatable: number;
}): SleeveState => ({
  timelines: b.timelines,
  flowsByDay: indexFlowsByDay(b.flows),
  undatable: b.undatable,
});

/**
 * Moteur prêt à valoriser : chronologies construites, journal trié.
 *
 * Le rejeu du journal est **incrémental** — l'état avance avec le curseur des
 * jours, il n'est jamais rejoué depuis zéro. C'est ce qui rend le coût linéaire
 * en (jours + transactions) plutôt que quadratique.
 */
export class PortfolioValuationEngine {
  private readonly inputs: HistoricalInputs;
  private readonly sortedTxs: LedgerTx[];
  /**
   * Jour civil de chaque transaction, calculé une fois.
   *
   * `parisDayKey` passe par `Intl` : l'appeler dans la boucle des jours coûtait
   * à lui seul plusieurs centaines de millisecondes sur un historique long.
   */
  private readonly txDays: DayKey[];
  private readonly cash: SleeveState;
  private readonly alternatives: SleeveState;
  private readonly employeeSavings: SleeveState;
  private readonly liabilities: SleeveState;

  constructor(inputs: HistoricalInputs) {
    this.inputs = inputs;
    this.sortedTxs = [...inputs.transactions].sort((a, b) => {
      const t = a.occurredAt.getTime() - b.occurredAt.getTime();
      return t !== 0 ? t : a.id.localeCompare(b.id);
    });
    this.txDays = this.sortedTxs.map((t) => parisDayKey(t.occurredAt));

    this.cash = toSleeveState(buildCashSleeve(inputs.cashAccounts, inputs.cashEvents));

    const metals = buildMetalsSleeve(inputs.metals);
    const pe = buildPrivateEquitySleeve(inputs.privateEquity);
    const cl = buildCrowdlendingSleeve(inputs.crowdlending);
    const tg = buildTangiblesSleeve(inputs.tangibles);
    this.alternatives = toSleeveState({
      timelines: [...metals.timelines, ...pe.timelines, ...cl.timelines, ...tg.timelines],
      flows: [...metals.flows, ...pe.flows, ...cl.flows, ...tg.flows],
      undatable: metals.undatable + pe.undatable + cl.undatable + tg.undatable,
    });

    this.employeeSavings = toSleeveState(
      buildEmployeeSavingsSleeve(inputs.employeeSavings)
    );
    this.liabilities = toSleeveState(buildLiabilitiesSleeve(inputs.liabilities));
  }

  /**
   * Premier jour où le patrimoine existe : la plus ancienne date connue, toutes
   * sources confondues. Commencer avant afficherait une ligne plate à zéro.
   */
  earliestDay(): DayKey | null {
    const candidates: DayKey[] = [];
    if (this.sortedTxs.length > 0) {
      candidates.push(this.txDays[0]!);
    }
    for (const sleeve of [
      this.cash,
      this.alternatives,
      this.employeeSavings,
      this.liabilities,
    ]) {
      for (const t of sleeve.timelines) {
        const first = t.firstDay;
        if (first) candidates.push(first);
      }
    }
    if (candidates.length === 0) return null;
    return candidates.reduce((min, c) => (c < min ? c : min));
  }

  /**
   * Valorise le patrimoine sur une fenêtre, jour par jour.
   *
   * Renvoie la série **quotidienne complète**. L'échantillonnage pour
   * l'affichage est une décision d'écran, prise en aval (`downsample`), et il ne
   * modifie aucune valeur.
   */
  buildSeries(from: DayKey, to: DayKey): PortfolioValuationPoint[] {
    const days = enumerateDays(from, to);
    if (days.length === 0) return [];

    const state = createEmptyLedger();
    let cursor = 0;
    // Flux du journal cumulés dans la journée courante — remis à zéro à chaque
    // jour, car un flux appartient au jour où il a eu lieu.
    let ledgerFlowToday = emptyFlows();

    const out: PortfolioValuationPoint[] = [];
    let previousGross: Decimal | null = null;

    for (const day of days) {
      ledgerFlowToday = emptyFlows();
      while (cursor < this.sortedTxs.length) {
        const tx = this.sortedTxs[cursor]!;
        if (this.txDays[cursor]! > day) break;
        this.accumulateLedgerFlow(ledgerFlowToday, tx);
        applyLedgerTx(state, tx);
        cursor += 1;
      }

      const point = this.valuationAt(
        day,
        state,
        ledgerFlowToday,
        previousGross,
        undefined,
        true,
        // La ventilation de la veille — la seule référence qui rende la
        // performance d'une classe mesurable.
        out.length > 0 ? out[out.length - 1]!.byAssetClass : null
      );
      out.push(point);
      previousGross = d(point.grossAssets);
    }

    return out;
  }

  /**
   * Valorisation d'une journée à partir d'un état de journal déjà positionné.
   *
   * Séparée de la boucle pour que `calculatePortfolioValueAt` puisse la
   * réutiliser sans dupliquer une seule ligne d'arithmétique — c'est la
   * garantie mécanique que le point du jour et un point d'historique sont
   * calculés par le même code.
   */
  /**
   * Résolveur du jour — le comportement historique, inchangé.
   *
   * `closeAtOrBefore` reporte déjà la dernière clôture connue et la courbe
   * quotidienne l'annonce `EXACT`. C'est discutable pour un jour de marché
   * fermé, mais c'est la sémantique en place : la modifier ferait bouger la
   * courbe existante, ce qui n'est pas l'objet de ce chantier. Le résolveur
   * quotidien déclare donc `observed: true`, comme avant.
   */
  /**
   * Ajoute le flux d'une transaction à sa classe — ou l'écarte.
   *
   * Deux règles, dans cet ordre :
   *
   * 1. **Un actif exclu du patrimoine n'apporte aucun flux.** Sa valeur est
   *    déjà écartée de la valorisation ; compter son achat comme un apport
   *    faisait plonger la performance du montant exact de l'achat, sans
   *    qu'aucun marché n'ait bougé. C'était le seul endroit du moteur où
   *    valeur et flux ne parlaient pas du même périmètre.
   * 2. **Un flux nul ne cherche pas de classe.** Apports, retraits et
   *    transferts ne touchent que le cash du journal, hors périmètre : ils
   *    rendent zéro, et il n'y a donc rien à attribuer. Leur inventer une
   *    classe serait une décision métier que la donnée ne porte pas.
   */
  private accumulateLedgerFlow(flows: FlowsByAssetClass, tx: LedgerTx): void {
    if (tx.assetId && this.inputs.excludedAssetIds.has(tx.assetId)) return;

    const amount = ledgerExternalFlow(tx);
    if (amount.isZero()) return;

    addFlow(flows, assetClassOf(this.inputs.rawAssetClassById.get(tx.assetId ?? "")), amount);
  }

  private dailyPriceResolver(day: DayKey): PriceResolver {
    return (assetId) => {
      const close = closeAtOrBefore(this.inputs.closes.get(assetId), day);
      return close == null
        ? null
        : { priceEur: close, origin: "DAILY_EXACT" as const };
    };
  }

  /**
   * Valorisation à un instant, à partir d'un état de journal déjà positionné.
   *
   * `priceAt` est la seule chose qui distingue un point horaire d'un point
   * quotidien. Tout le reste — exclusions, poches non cotées, passifs, flux,
   * statut — est partagé, et c'est la garantie mécanique que les deux courbes
   * décrivent le même patrimoine.
   */
  valuationAt(
    day: DayKey,
    state: LedgerState,
    ledgerFlowToday: FlowsByAssetClass,
    previousGross: Decimal | null,
    priceAt?: PriceResolver,
    countSleeveFlows = true,
    /**
     * Ventilation du point précédent, pour la performance par classe.
     *
     * `null` au premier point d'une série : sans veille, une classe n'a pas de
     * variation mesurable — et zéro serait une affirmation, pas une absence.
     */
    previousByClass: Record<ValuationAssetClass, number> | null = null
  ): PortfolioValuationPoint {
    const estimated = new Set<ValuationComponent>();

    // ── Journal : valeur de marché ventilée par classe ───────────────────────
    const byComponent = new Map<ValuationComponent, Decimal>();

    const positionsByComponent = new Map<
      ValuationComponent,
      Array<{ assetId: string; quantity: Decimal; costBasisEur: Decimal }>
    >();
    const positionsByClass = new Map<
      ValuationAssetClass,
      Array<{ assetId: string; quantity: Decimal; costBasisEur: Decimal }>
    >();
    for (const pos of state.positions.values()) {
      if (pos.quantity.isZero()) continue;
      // Écarté du patrimoine : ni valorisé, ni ventilé — comme au jour le jour.
      if (this.inputs.excludedAssetIds.has(pos.assetId)) continue;
      const comp = componentOfAssetClass(this.inputs.assetClassById.get(pos.assetId));
      const list = positionsByComponent.get(comp);
      if (list) list.push(pos);
      else positionsByComponent.set(comp, [pos]);

      /*
        Même position, second regroupement.

        Les deux ventilations lisent exactement les mêmes lignes aux mêmes
        quantités : ce sont deux découpages d'un même total, pas deux calculs.
        Les valoriser deux fois ferait deux arithmétiques à faire diverger — on
        se contente donc de mémoriser à quelle classe chaque ligne appartient,
        et la valeur sera reprise du même appel à `valuePositions`.
      */
      const cls = assetClassOf(this.inputs.rawAssetClassById.get(pos.assetId));
      const byCls = positionsByClass.get(cls);
      if (byCls) byCls.push(pos);
      else positionsByClass.set(cls, [pos]);
    }

    /*
      Ce qui vaut observation dépend de l'échelle du point.

      Une clôture quotidienne est la valeur exacte d'une journée ; sur un point
      de 14 h 37, elle ne décrit pas l'instant demandé. L'origine relevée est la
      même des deux côtés — seule sa lecture change.
    */
    const observedSet = priceAt ? OBSERVED_AT_INSTANT : OBSERVED_AT_DAY;
    const originsSeen = new Set<PriceOrigin>();
    let totalPositions = 0;
    let unavailablePositions = 0;

    for (const [comp, positions] of positionsByComponent) {
      const {
        marketEur,
        unpricedAssets: unpriced,
        carriedAssets: carried,
        provenance,
      } = valuePositions(
        positions,
        priceAt ?? this.dailyPriceResolver(day),
        observedSet
      );
      /*
        Deux unités à ne pas mélanger : les origines sont **distinctes**, les
        compteurs sont des **positions**. Diviser les unes par les autres a
        produit une couverture négative — un point à trois compartiments et cinq
        lignes muettes donnait (3 − 5) / 3.
      */
      for (const [o, n] of provenance.byOrigin) {
        originsSeen.add(o);
        totalPositions += n;
      }
      unavailablePositions += provenance.unavailableAssets;
      byComponent.set(comp, marketEur);
      // Au moins une position sans cours connu ce jour-là : retenue au coût,
      // donc le compartiment n'est pas exact.
      if (unpriced > 0) estimated.add(comp);
      // Cours réel mais antérieur, reporté faute de mieux : la valeur est
      // plausible, elle n'est pas observée à cet instant.
      if (carried > 0) estimated.add(comp);
    }

    /*
      Valorisation par classe — même résolveur, mêmes lignes.

      Le résolveur est construit une seule fois et partagé : deux instances
      pourraient répondre différemment sur un cache partiellement rempli, et
      les deux ventilations cesseraient de décrire le même patrimoine.
    */
    const resolve = priceAt ?? this.dailyPriceResolver(day);
    const byClass = {} as Record<ValuationAssetClass, Decimal>;
    for (const cls of VALUATION_ASSET_CLASSES) byClass[cls] = zero();
    for (const [cls, positions] of positionsByClass) {
      const { marketEur } = valuePositions(positions, resolve, observedSet);
      byClass[cls] = byClass[cls].plus(marketEur);
    }

    // ── Poches de cash, alternatifs, épargne salariale ───────────────────────
    const cash = sumTimelinesAt(this.cash.timelines, day);
    /*
      `unavailable` compte les comptes dont **rien** n'est su ce jour-là :
      ils existent, mais aucun constat ne précède la date demandée.

      Sans ce test, une chronologie sans valeur était sautée en silence et le
      compartiment se présentait comme exact alors qu'il ignorait tout d'une
      partie de la trésorerie — une absence de donnée indiscernable d'une
      absence de compte.
    */
    if (cash.carried > 0 || cash.unavailable > 0 || this.cash.undatable > 0) {
      estimated.add("cash");
    }

    const alternatives = sumTimelinesAt(this.alternatives.timelines, day);
    if (alternatives.carried > 0 || this.alternatives.undatable > 0) {
      estimated.add("alternatives");
    }

    const employeeSavings = sumTimelinesAt(this.employeeSavings.timelines, day);
    if (employeeSavings.carried > 0 || this.employeeSavings.undatable > 0) {
      estimated.add("employeeSavings");
    }

    const liabilities = sumTimelinesAt(this.liabilities.timelines, day);

    const securities = byComponent.get("securities") ?? zero();
    const crypto = byComponent.get("crypto") ?? zero();
    const realEstate = byComponent.get("realEstate") ?? zero();
    const lifeInsurance = byComponent.get("lifeInsurance") ?? zero();
    const otherAssets = byComponent.get("otherAssets") ?? zero();

    /*
      Les poches sans position au journal rejoignent la classe qui les décrit.

      La trésorerie est du cash — sans ambiguïté. Les alternatifs (métaux,
      private equity, crowdlending, tangibles) et l'épargne salariale n'ont pas
      de classe dédiée dans cette taxonomie à six valeurs : `AUTRE` est le seul
      choix honnête. Les diluer dans `ACTIONS` au prétexte que certains fonds y
      ressemblent serait une invention ; les omettre casserait la partition.
    */
    byClass.CASH = byClass.CASH.plus(cash.totalEur);
    byClass.AUTRE = byClass.AUTRE.plus(alternatives.totalEur).plus(
      employeeSavings.totalEur
    );

    const grossAssets = securities
      .plus(crypto)
      .plus(realEstate)
      .plus(lifeInsurance)
      .plus(cash.totalEur)
      .plus(alternatives.totalEur)
      .plus(employeeSavings.totalEur)
      .plus(otherAssets);

    // ── Flux externes du jour ────────────────────────────────────────────────
    /*
      Les flux des poches ne sont datés qu'au jour.

      Un versement sur un livret ou l'achat d'un lingot portent une date, pas
      une heure. Les compter à chaque point d'une série horaire les
      retrancherait vingt-quatre fois de la performance du même jour. Ils sont
      donc rattachés au **premier point de leur journée**, faute d'en connaître
      l'heure — la seule imputation que la donnée autorise.

      Les flux du journal, eux, sont horodatés à la minute : `ledgerFlowToday`
      porte ceux survenus depuis le point précédent, et n'a pas besoin de cette
      précaution.
    */
    /*
      Les flux de poches rejoignent la même ventilation que leurs valeurs.

      La trésorerie va à `CASH`, les alternatifs et l'épargne salariale à
      `AUTRE` : exactement le routage appliqué plus haut à leurs montants. Les
      séparer ferait qu'un versement sur livret apparaîtrait comme un flux
      d'une classe dont la valeur n'a pas bougé — et la performance des deux
      classes concernées serait fausse en sens contraire.
    */
    const flowsByClass = emptyFlows();
    for (const c of VALUATION_ASSET_CLASSES) flowsByClass[c] = ledgerFlowToday[c];
    if (countSleeveFlows) {
      addFlow(flowsByClass, classOfComponent("cash"), this.cash.flowsByDay.get(day) ?? zero());
      addFlow(
        flowsByClass,
        classOfComponent("alternatives"),
        this.alternatives.flowsByDay.get(day) ?? zero()
      );
      addFlow(
        flowsByClass,
        classOfComponent("employeeSavings"),
        this.employeeSavings.flowsByDay.get(day) ?? zero()
      );
    }
    const externalFlows = totalFlows(flowsByClass);

    /*
      Performance = ce que la journée a produit, une fois les mouvements de
      capitaux retirés. C'est la ligne qui empêche un apport de 100 k€ de se
      lire comme un gain de 100 k€, et l'acquisition d'un actif de 2 M€ de
      fabriquer une plus-value du même montant.
    */
    const investmentPerformance =
      previousGross == null ? zero() : grossAssets.minus(previousGross).minus(externalFlows);

    /*
      Performance par classe — la même arithmétique, appliquée classe par
      classe. Ce n'est pas un second calcul : c'est la décomposition du
      premier, terme à terme.

      `null` sans point précédent, pour la même raison que la performance
      globale vaut zéro au premier point : il n'y a rien à comparer, et
      publier 0 % laisserait croire à une classe stable.
    */
    const performanceByClass =
      previousByClass == null
        ? null
        : (Object.fromEntries(
            VALUATION_ASSET_CLASSES.map((c) => [
              c,
              byClass[c].minus(d(previousByClass[c])).minus(flowsByClass[c]).toNumber(),
            ])
          ) as Record<ValuationAssetClass, number>);

    const status: HistoricalDataStatus =
      estimated.size === 0 ? "EXACT" : "ESTIMATED";

    return {
      day,
      securities: securities.toNumber(),
      crypto: crypto.toNumber(),
      realEstate: realEstate.toNumber(),
      lifeInsurance: lifeInsurance.toNumber(),
      cash: cash.totalEur.toNumber(),
      alternatives: alternatives.totalEur.toNumber(),
      employeeSavings: employeeSavings.totalEur.toNumber(),
      otherAssets: otherAssets.toNumber(),
      byAssetClass: Object.fromEntries(
        VALUATION_ASSET_CLASSES.map((c) => [c, byClass[c].toNumber()])
      ) as Record<ValuationAssetClass, number>,

      flowsByAssetClass: Object.fromEntries(
        VALUATION_ASSET_CLASSES.map((c) => [c, flowsByClass[c].toNumber()])
      ) as Record<ValuationAssetClass, number>,

      performanceByAssetClass: performanceByClass,

      grossAssets: grossAssets.toNumber(),
      liabilities: liabilities.totalEur.toNumber(),
      netWorth: grossAssets.minus(liabilities.totalEur).toNumber(),
      externalFlows: externalFlows.toNumber(),
      investmentPerformance: investmentPerformance.toNumber(),
      ledgerCash: totalLedgerCash(state).toNumber(),
      status,
      estimatedComponents: [...estimated].sort(),
      weakestPriceOrigin: weakestOrigin(originsSeen),
      priceOrigins: PRICE_ORIGINS.filter((o) => originsSeen.has(o)),
      priceCoverage: coverageOf(totalPositions, unavailablePositions),
    };
  }

  /**
   * Clôtures quotidiennes chargées, pour un résolveur qui les consulterait.
   *
   * Exposées en lecture seule plutôt que copiées : la série horaire s'en sert
   * comme repli, et charger une seconde fois le même cache serait à la fois
   * coûteux et une occasion de divergence.
   */
  dailyCloses(): DailyCloseIndex {
    return this.inputs.closes;
  }

  /**
   * Série valorisée à des **instants**, et non à des jours.
   *
   * Même rejeu incrémental, même arithmétique, même statut : seule la
   * résolution des cours change, par `resolverAt`. C'est ce qui garantit qu'une
   * courbe horaire et la courbe quotidienne décrivent le même patrimoine — il
   * n'existe pas deux définitions.
   *
   * Le journal est rejoué à l'**horodatage** de la transaction, pas à son jour :
   * un achat de 14 h 37 pèse à partir de 14 h 37, et pas depuis minuit. C'est ce
   * que la minute stockée dans `occurredAt` permet, et ce qu'une clé
   * journalière interdisait.
   *
   * Les instants doivent être fournis triés — c'est l'appelant qui décide du
   * pas, et le rejeu suppose une progression monotone.
   */
  buildInstantSeries(
    instants: Date[],
    resolverAt: (at: Date) => PriceResolver
  ): Array<PortfolioValuationPoint & { at: Date }> {
    if (instants.length === 0) return [];

    const state = createEmptyLedger();
    let cursor = 0;
    const out: Array<PortfolioValuationPoint & { at: Date }> = [];
    let previousGross: Decimal | null = null;
    let previousDay: DayKey | null = null;

    for (const at of instants) {
      const day = parisDayKey(at);
      const ms = at.getTime();

      // Flux du journal survenus depuis le point précédent : la fenêtre est
      // l'intervalle entre deux points, pas la journée entière.
      const ledgerFlowSincePrevious = emptyFlows();
      while (cursor < this.sortedTxs.length) {
        const tx = this.sortedTxs[cursor]!;
        if (tx.occurredAt.getTime() > ms) break;
        this.accumulateLedgerFlow(ledgerFlowSincePrevious, tx);
        applyLedgerTx(state, tx);
        cursor += 1;
      }

      // Les flux des poches ne sont datés qu'au jour : ils sont imputés au
      // premier point de leur journée, jamais répétés aux suivants.
      const firstPointOfDay = day !== previousDay;

      const point = this.valuationAt(
        day,
        state,
        ledgerFlowSincePrevious,
        previousGross,
        resolverAt(at),
        firstPointOfDay,
        // Même référence qu'en quotidien : le point précédent de la série,
        // ici l'intervalle horaire d'avant et non la veille.
        out.length > 0 ? out[out.length - 1]!.byAssetClass : null
      );
      out.push({ ...point, at });
      previousGross = d(point.grossAssets);
      previousDay = day;
    }

    return out;
  }

  /**
   * Valeur du patrimoine à une date isolée.
   *
   * Rejoue le journal jusqu'à `day` puis valorise — même code que la courbe,
   * donc même résultat par construction. C'est ce que consomme le point du
   * jour : il n'existe plus de chemin « live » qui additionnerait autrement.
   */
  calculateAt(day: DayKey): PortfolioValuationPoint {
    const state = createEmptyLedger();
    const flowToday = emptyFlows();
    for (let i = 0; i < this.sortedTxs.length; i++) {
      const tx = this.sortedTxs[i]!;
      const txDay = this.txDays[i]!;
      if (txDay > day) break;
      if (txDay === day) this.accumulateLedgerFlow(flowToday, tx);
      applyLedgerTx(state, tx);
    }
    return this.valuationAt(day, state, flowToday, null);
  }
}

/** Applique une transaction en tolérant les journaux imparfaits. */
function applyLedgerTx(state: LedgerState, tx: LedgerTx): void {
  try {
    applyTransaction(state, tx);
  } catch {
    applyTransaction(state, tx, { allowNegativeCash: true, clampOversell: true });
  }
}

/**
 * Montant de capital extérieur qu'une transaction fait entrer dans le
 * périmètre mesuré.
 *
 * Le cash du journal étant hors périmètre (voir l'en-tête du module), un achat
 * fait apparaître de la valeur en positions sans contrepartie mesurée : c'est
 * un apport. Une vente en fait disparaître : c'est un retrait. Les revenus
 * encaissés (dividendes, coupons, loyers) atterrissent dans ce même cash hors
 * périmètre — ils ne sont donc **pas** des flux, et ne sont pas non plus de la
 * performance mesurable ici : ils sortent simplement du champ.
 */
function ledgerExternalFlow(tx: LedgerTx): Decimal {
  const fees = toEur(tx.fees ?? 0, tx.fxRateToEur);
  switch (tx.type) {
    case "ACHAT": {
      const gross = d(tx.quantity ?? 0).times(toEur(tx.unitPrice ?? 0, tx.fxRateToEur));
      return gross.plus(fees);
    }
    case "TRAVAUX":
      // Dépense capitalisée : elle augmente le coût de revient du bien, donc
      // la valeur retenue tant qu'aucun cours ne le couvre. C'est du capital
      // qui entre, pas une plus-value.
      return toEur(tx.cashAmountOriginal ?? 0, tx.fxRateToEur).plus(fees);
    case "VENTE": {
      const gross = d(tx.quantity ?? 0).times(toEur(tx.unitPrice ?? 0, tx.fxRateToEur));
      return gross.minus(fees).negated();
    }
    default:
      // APPORT / RETRAIT ne touchent que le cash du journal, hors périmètre.
      // TRANSFERT_* déplace de la valeur sans en créer : rien n'entre.
      // REWARD / AIRDROP arrivent gratuitement — c'est un gain, pas un apport.
      return zero();
  }
}

function totalLedgerCash(state: LedgerState): Decimal {
  let total = zero();
  for (const amount of state.cashByPlatform.values()) {
    total = total.plus(amount);
  }
  return total;
}

export { componentOfAssetClass };
