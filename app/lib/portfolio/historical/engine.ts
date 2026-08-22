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
import { marketValueOfPositions, type DailyCloseIndex } from "../class-history";
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
    let ledgerFlowToday = zero();

    const out: PortfolioValuationPoint[] = [];
    let previousGross: Decimal | null = null;

    for (const day of days) {
      ledgerFlowToday = zero();
      while (cursor < this.sortedTxs.length) {
        const tx = this.sortedTxs[cursor]!;
        if (this.txDays[cursor]! > day) break;
        ledgerFlowToday = ledgerFlowToday.plus(ledgerExternalFlow(tx));
        applyLedgerTx(state, tx);
        cursor += 1;
      }

      const point = this.valuationAt(day, state, ledgerFlowToday, previousGross);
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
  private valuationAt(
    day: DayKey,
    state: LedgerState,
    ledgerFlowToday: Decimal,
    previousGross: Decimal | null
  ): PortfolioValuationPoint {
    const estimated = new Set<ValuationComponent>();

    // ── Journal : valeur de marché ventilée par classe ───────────────────────
    const byComponent = new Map<ValuationComponent, Decimal>();

    const positionsByComponent = new Map<
      ValuationComponent,
      Array<{ assetId: string; quantity: Decimal; costBasisEur: Decimal }>
    >();
    for (const pos of state.positions.values()) {
      if (pos.quantity.isZero()) continue;
      const comp = componentOfAssetClass(this.inputs.assetClassById.get(pos.assetId));
      const list = positionsByComponent.get(comp);
      if (list) list.push(pos);
      else positionsByComponent.set(comp, [pos]);
    }

    for (const [comp, positions] of positionsByComponent) {
      const { marketEur, unpricedAssets: unpriced } = marketValueOfPositions(
        positions,
        this.inputs.closes,
        day
      );
      byComponent.set(comp, marketEur);
      // Au moins une position sans cours connu ce jour-là : retenue au coût,
      // donc le compartiment n'est pas exact.
      if (unpriced > 0) estimated.add(comp);
    }

    // ── Poches de cash, alternatifs, épargne salariale ───────────────────────
    const cash = sumTimelinesAt(this.cash.timelines, day);
    if (cash.carried > 0 || this.cash.undatable > 0) estimated.add("cash");

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

    const grossAssets = securities
      .plus(crypto)
      .plus(realEstate)
      .plus(lifeInsurance)
      .plus(cash.totalEur)
      .plus(alternatives.totalEur)
      .plus(employeeSavings.totalEur)
      .plus(otherAssets);

    // ── Flux externes du jour ────────────────────────────────────────────────
    const externalFlows = ledgerFlowToday
      .plus(this.cash.flowsByDay.get(day) ?? zero())
      .plus(this.alternatives.flowsByDay.get(day) ?? zero())
      .plus(this.employeeSavings.flowsByDay.get(day) ?? zero());

    /*
      Performance = ce que la journée a produit, une fois les mouvements de
      capitaux retirés. C'est la ligne qui empêche un apport de 100 k€ de se
      lire comme un gain de 100 k€, et l'acquisition d'un actif de 2 M€ de
      fabriquer une plus-value du même montant.
    */
    const investmentPerformance =
      previousGross == null ? zero() : grossAssets.minus(previousGross).minus(externalFlows);

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
      grossAssets: grossAssets.toNumber(),
      liabilities: liabilities.totalEur.toNumber(),
      netWorth: grossAssets.minus(liabilities.totalEur).toNumber(),
      externalFlows: externalFlows.toNumber(),
      investmentPerformance: investmentPerformance.toNumber(),
      ledgerCash: totalLedgerCash(state).toNumber(),
      status,
      estimatedComponents: [...estimated].sort(),
    };
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
    let flowToday = zero();
    for (let i = 0; i < this.sortedTxs.length; i++) {
      const tx = this.sortedTxs[i]!;
      const txDay = this.txDays[i]!;
      if (txDay > day) break;
      if (txDay === day) flowToday = flowToday.plus(ledgerExternalFlow(tx));
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
