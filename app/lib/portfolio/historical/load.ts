/**
 * Adaptateur Prisma du moteur historique.
 *
 * Seule pièce du moteur à connaître le schéma. Elle charge **en une passe**
 * tout ce que la reconstruction consommera ensuite en mémoire : c'est la
 * contrainte de performance du chantier — reconstruire cinq ans ne doit pas
 * coûter plus de requêtes qu'une seule journée.
 *
 * Chaque conversion vers EUR est faite ici, au chargement, pour que le moteur
 * n'ait plus à connaître ni les devises ni les taux.
 */

import { prisma } from "../../prisma";
import { d, zero, type Decimal } from "../../money/decimal";
import { convertToEurSync, getEurRates } from "../../market/fx";
import { readDailyCloses } from "../../market/daily-closes";
import { parisDayKey } from "../../dates/paris";
import { remainingAmountAt } from "../../liabilities/amortization";
import { isNonOwnedStatus } from "../../crypto/nft-taxonomy";
import {
  savingsDisplayBalance,
  type PayoutFrequency,
  type RateType,
} from "../../money/savings";
import { mapDbTx } from "../tx-mapper";
import type { DailyCloseIndex } from "../class-history";
import type { HistoricalInputs } from "./engine";

type Rates = Record<string, number>;

const eur = (
  value: { toString(): string } | null | undefined,
  currency: string | null | undefined,
  rates: Rates
): Decimal =>
  value == null
    ? zero()
    : d(convertToEurSync(value.toString(), currency || "EUR", rates));

/**
 * Charge l'intégralité des sources historiques d'un utilisateur.
 *
 * `closes` est lu **sans** déclencher d'appel fournisseur : afficher un tableau
 * de bord ne doit pas provoquer le téléchargement de cinq ans de cours. Le
 * cache se remplit par ailleurs, et la courbe se précise à mesure ; là où il est
 * muet, la position est retenue à son coût et la journée se déclare estimée.
 */
export async function loadHistoricalInputs(
  userId: string
): Promise<HistoricalInputs> {
  const rates = await getEurRates();

  const [
    txRows,
    assets,
    banks,
    bankEvents,
    savings,
    savingsEvents,
    envelopes,
    metals,
    peRows,
    clRows,
    tangibles,
    employeeSavings,
    liabilities,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    prisma.asset.findMany({
      where: { userId },
      select: {
        id: true,
        assetClass: true,
        accountType: true,
        currency: true,
        manualPrice: true,
        priceQuote: { select: { priceEur: true } },
        // Mêmes relations que `getPortfolioBundle` : sans elles, la courbe
        // valoriserait des positions que le patrimoine du jour écarte.
        defiPosition: { select: { isIgnoredInPortfolio: true } },
        nftItem: { select: { isIgnoredInPortfolio: true, status: true } },
      },
    }),
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.bankAccountEvent.findMany({
      where: { bankAccount: { userId } },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.savingsAccount.findMany({ where: { userId } }),
    prisma.savingsAccountEvent.findMany({
      where: { savingsAccount: { userId } },
      orderBy: { occurredAt: "asc" },
    }),
    prisma.envelopeCash.findMany({ where: { userId } }),
    prisma.preciousMetalPosition.findMany({ where: { userId } }),
    prisma.privateEquityPosition.findMany({
      where: { userId },
      include: { valuations: { orderBy: { valuedAt: "asc" } } },
    }),
    prisma.crowdlendingPosition.findMany({ where: { userId } }),
    prisma.tangibleAsset.findMany({
      where: { userId },
      include: { valuations: { orderBy: { valuedAt: "asc" } } },
    }),
    prisma.employeeSavingsLine.findMany({ where: { userId } }),
    prisma.liability.findMany({
      where: { userId },
      include: { events: { orderBy: { eventDate: "asc" } } },
    }),
  ]);

  const transactions = txRows.map(mapDbTx);

  /*
    Les trois exclusions du moteur du jour, reprises à l'identique.

    Les dupliquer serait un risque ; c'est pourquoi elles tiennent en un seul
    prédicat, et que `e2e/coherence-totaux` vérifie que la fin de courbe et la
    tuile de patrimoine portent le même chiffre — l'assertion qui a révélé
    l'écart de 42 € d'un NFT exclu que la courbe comptait encore.

    Ce que la courbe fait *avant* la décision d'exclusion reste une question
    ouverte : marche à la date de la décision, ou rétroactivité complète. La
    rétroactivité est retenue ici parce qu'elle est ce que fait déjà le moteur
    du jour, et parce qu'un dernier point faux était le défaut à corriger.
  */
  const excludedAssetIds = new Set(
    assets
      .filter(
        (a) =>
          a.defiPosition?.isIgnoredInPortfolio ||
          a.nftItem?.isIgnoredInPortfolio ||
          (a.nftItem != null && isNonOwnedStatus(a.nftItem.status))
      )
      .map((a) => a.id)
  );

  const assetClassById = new Map<string, string>();
  /**
   * Classe d'actif **brute**, sans la surcharge assurance-vie.
   *
   * `assetClassById` mélange délibérément deux informations : la classe de
   * l'actif, et le fait qu'il soit détenu dans un contrat d'assurance-vie.
   * C'est ce qu'il faut pour la ventilation par compartiment, où l'AV forme
   * une poche à part.
   *
   * Pour une ventilation par **classe d'actif**, c'est faux : une UC actions
   * logée dans un contrat reste une action. Et surtout, la surcharge repose
   * sur `accountType`, un champ **mutable sans journal** — un support qui
   * change d'enveloppe verrait tout son passé changer de poche. La classe
   * brute, elle, n'a aucun chemin de mise à jour : elle est fixée à la
   * création et le reste.
   *
   * Les deux cartes coexistent donc, chacune pour la ventilation qu'elle sait
   * décrire honnêtement.
   */
  const rawAssetClassById = new Map<string, string>();
  for (const a of assets) {
    // Un contrat d'assurance-vie est porté par `accountType`, pas par la classe
    // de l'actif : ses supports restent des actions ou des obligations.
    assetClassById.set(a.id, a.accountType === "AV" ? "ASSURANCE_VIE" : a.assetClass);
    rawAssetClassById.set(a.id, a.assetClass);
  }

  const closes = await loadCloses(transactions, assets.map((a) => a.id));

  /*
    Le cours du jour complète le cache de clôtures.

    `AssetDailyClose` n'est alimenté que par les écrans qui le remplissent au
    fil de l'eau : il peut être vide, et l'était sur une base fraîchement
    initialisée. Sans ce complément, la journée d'aujourd'hui retombait sur le
    prix de revient — le dernier point de la courbe s'écartait alors de la carte
    du dashboard, qui lit bien le cours courant, et l'écart se lisait comme une
    perte.

    Le cours n'est inscrit **que** sur le jour courant : il ne descend jamais
    dans le passé, où seules les clôtures réellement observées font foi.
  */
  const today = parisDayKey(new Date());
  for (const a of assets) {
    const priceEur = a.priceQuote
      ? d(a.priceQuote.priceEur.toString())
      : a.manualPrice
        ? d(convertToEurSync(a.manualPrice.toString(), a.currency || "EUR", rates))
        : null;
    if (!priceEur || priceEur.lte(0)) continue;
    const byDay = closes.get(a.id) ?? new Map<string, number>();
    byDay.set(today, priceEur.toNumber());
    closes.set(a.id, byDay);
  }

  // ── Cash : comptes, livrets, enveloppes ────────────────────────────────────
  const cashAccounts = [
    ...banks.map((b) => ({
      id: b.id,
      balanceEur: eur(b.balance, b.currency, rates),
      createdAt: b.createdAt,
      // Le solde est connu depuis sa dernière écriture, pas depuis l'ouverture
      // du compte : c'est cette date qui borne son application au passé.
      knownAt: b.updatedAt,
    })),
    ...savings.map((s) => ({
      id: s.id,
      balanceEur: eur(s.balance, s.currency, rates),
      createdAt: s.createdAt,
      knownAt: s.updatedAt,
      // Le solde affiché inclut les intérêts courus non encore versés : c'est
      // ce que la carte du dashboard additionne, donc ce que la courbe doit
      // rejoindre aujourd'hui.
      currentEur: eur(displayBalanceOf(s), s.currency, rates),
    })),
    ...envelopes.map((e) => ({
      id: e.id,
      balanceEur: eur(e.balance, e.currency, rates),
      createdAt: e.createdAt,
      knownAt: e.updatedAt,
    })),
  ];

  const bankCurrencyById = new Map(banks.map((b) => [b.id, b.currency]));
  const savingsCurrencyById = new Map(savings.map((s) => [s.id, s.currency]));

  const cashEvents = [
    ...bankEvents.map((e) => ({
      accountId: e.bankAccountId,
      occurredAt: e.occurredAt,
      amountEur: eur(e.amount, bankCurrencyById.get(e.bankAccountId), rates),
      balanceAfterEur: eur(
        e.balanceAfter,
        bankCurrencyById.get(e.bankAccountId),
        rates
      ),
      type: e.type,
    })),
    ...savingsEvents.map((e) => ({
      accountId: e.savingsAccountId,
      occurredAt: e.occurredAt,
      amountEur: eur(e.amount, savingsCurrencyById.get(e.savingsAccountId), rates),
      balanceAfterEur: eur(
        e.balanceAfter,
        savingsCurrencyById.get(e.savingsAccountId),
        rates
      ),
      type: e.type,
    })),
  ];

  /*
    Intérêts courus non encore versés.

    Le solde d'un livret porte des intérêts que la base n'inscrit qu'à la date
    de versement. Entre deux versements, la carte du dashboard affiche pourtant
    le solde **augmenté** de ces intérêts : c'est ce que le livret vaut
    aujourd'hui. Sans cette écriture, la courbe s'arrêtait au dernier solde
    inscrit et le dernier point manquait de quelques centaines d'euros.

    L'écriture est de type `INTEREST` : elle est donc comptée en performance et
    non en apport — personne n'a versé cet argent.
  */
  const nowDate = new Date();
  for (const sv of savings) {
    const booked = eur(sv.balance, sv.currency, rates);
    const display = eur(displayBalanceOf(sv), sv.currency, rates);
    const accrued = display.minus(booked);
    if (accrued.abs().lte(d("0.005"))) continue;
    const lastBooked = savingsEvents
      .filter((e) => e.savingsAccountId === sv.id)
      .reduce<Decimal | null>(
        (_, e) => eur(e.balanceAfter, sv.currency, rates),
        null
      );
    // Sans événement, le compte est déjà porté par son solde d'affichage.
    if (lastBooked == null) continue;
    cashEvents.push({
      accountId: sv.id,
      occurredAt: nowDate,
      amountEur: accrued,
      balanceAfterEur: lastBooked.plus(accrued),
      type: "INTEREST",
    });
  }

  return {
    transactions,
    assetClassById,
    rawAssetClassById,
    excludedAssetIds,
    closes,
    cashAccounts,
    cashEvents,

    metals: metals.map((m) => ({
      id: m.id,
      acquiredAt: m.acquiredAt,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      // Prix de revient du lot : quantité × PRU, frais d'acquisition compris.
      costEur: eur(
        d(m.quantity.toString()).times(d(m.purchasePriceUnit.toString())).toString(),
        m.currency,
        rates
      ).plus(eur(m.acquisitionFees, m.currency, rates)),
      currentValueEur: eur(m.currentValue, m.currency, rates),
    })),

    privateEquity: peRows.map((p) => ({
      id: p.id,
      investmentDate: p.investmentDate,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      // Le capital appelé n'est pas toujours saisi sur les lignes anciennes :
      // à défaut, `parts × prix d'acquisition` est le prix réellement payé.
      calledCapitalEur: d(p.calledCapital.toString()).gt(0)
        ? eur(p.calledCapital, p.currency, rates)
        : eur(
            d(p.shares.toString())
              .times(d(p.acquisitionPricePerShare.toString()))
              .toString(),
            p.currency,
            rates
          ),
      currentNavEur: eur(p.currentNav, p.currency, rates),
      valuations: p.valuations.map((v) => ({
        valuedAt: v.valuedAt,
        navEur: eur(v.nav, p.currency, rates),
      })),
    })),

    crowdlending: clRows.map((c) => ({
      id: c.id,
      startDate: c.startDate,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      capitalInvestedEur: eur(c.capitalInvested, c.currency, rates),
      remainingCapitalEur: eur(c.remainingCapital, c.currency, rates),
      status: c.status,
    })),

    tangibles: tangibles.map((t) => ({
      id: t.id,
      purchaseDate: t.purchaseDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      costEur: eur(t.purchasePrice, t.currency, rates).plus(
        eur(t.acquisitionFees, t.currency, rates)
      ),
      estimatedValueEur: eur(t.estimatedValue, t.currency, rates),
      valuations: t.valuations.map((v) => ({
        valuedAt: v.valuedAt,
        // `TangibleValuation.valueEur` est déjà en euro par construction.
        valueEur: d(v.valueEur.toString()),
      })),
    })),

    employeeSavings: employeeSavings.map((l) => ({
      id: l.id,
      contributionDate: l.contributionDate,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      contributedEur:
        l.contributedAmount == null
          ? null
          : eur(l.contributedAmount, l.currency, rates),
      currentEur: eur(
        d(l.units.toString()).times(d(l.nav.toString())).toString(),
        l.currency,
        rates
      ),
    })),

    liabilities: liabilities.map((l) => ({
      id: l.id,
      startDate: l.startDate,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
      initialAmountEur: eur(l.initialAmount, l.currency, rates),
      /*
        Le solde qui ferme la chronologie est projeté à aujourd'hui, comme
        celui du tableau de bord. Rendre ici le solde stocké ferait terminer la
        courbe sur une dette que le patrimoine net ne reconnaît plus — les deux
        moteurs doivent s'accorder à la date du jour.
      */
      remainingAmountEur: eur(remainingAmountAt(l), l.currency, rates),
      events: l.events.map((e) => ({
        eventDate: e.eventDate,
        remainingAfterEur:
          e.remainingAfter == null ? null : eur(e.remainingAfter, l.currency, rates),
      })),
    })),
  };
}

/** Solde d'affichage d'un livret, intérêts courus compris. */
function displayBalanceOf(s: {
  balance: { toString(): string };
  apyPercent: { toString(): string };
  rateType: string;
  payoutFrequency: string | null;
  lastPayoutAt: Date | null;
  lastAccruedAt: Date;
}): string {
  const rateType = (s.rateType === "APR" ? "APR" : "APY") as RateType;
  const freq = (
    ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(s.payoutFrequency || "")
      ? s.payoutFrequency
      : "DAILY"
  ) as PayoutFrequency;
  const { displayBalance } = savingsDisplayBalance(
    s.balance.toString(),
    s.apyPercent.toString(),
    s.lastPayoutAt || s.lastAccruedAt,
    new Date(),
    rateType,
    freq
  );
  return displayBalance;
}

async function loadCloses(
  transactions: Array<{ occurredAt: Date }>,
  assetIds: string[]
): Promise<DailyCloseIndex> {
  if (assetIds.length === 0) return new Map();
  const today = parisDayKey(new Date());
  const first =
    transactions.length > 0
      ? parisDayKey(
          transactions.reduce(
            (min, t) => (t.occurredAt < min ? t.occurredAt : min),
            transactions[0]!.occurredAt
          )
        )
      : today;
  try {
    return await readDailyCloses(assetIds, first, today);
  } catch (e) {
    // Une courbe au coût vaut mieux qu'une page en erreur.
    console.error("[portfolio-history] clôtures illisibles", e);
    return new Map();
  }
}
