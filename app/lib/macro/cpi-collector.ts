/**
 * Alimentation de `CpiObservation`.
 *
 * ## La source retenue : l'IPC national de l'INSEE
 *
 * Le produit avait déjà tranché, avant ce chantier : l'écran annonce « Pouvoir
 * d'achat — indice des prix INSEE (IPC France) », et la légende « Inflation
 * (IPC France) ». C'est donc l'indice **national** de l'INSEE, et non l'IPCH
 * harmonisé d'Eurostat.
 *
 * Les deux ne sont pas interchangeables : l'IPCH sert aux comparaisons entre
 * pays de la zone euro, avec un champ et des pondérations différents — le
 * traitement du logement occupé par son propriétaire et celui de la santé, en
 * particulier. Leurs glissements annuels diffèrent régulièrement de quelques
 * dixièmes de point. Afficher l'un sous le nom de l'autre serait une erreur
 * silencieuse, et les mélanger dans une même série créerait des ruptures que
 * rien n'expliquerait.
 *
 * ## Ce que le collecteur écrit
 *
 * Un enregistrement par mois et par source, contenant la variation mensuelle
 * et — quand la source le publie — le glissement annuel. Les deux sont
 * conservés tels qu'ils sont publiés : recalculer l'un depuis l'autre ferait
 * diverger le chiffre affiché de celui que l'INSEE annonce.
 *
 * ## Idempotence
 *
 * La clé `(source, period)` est unique. Une seconde collecte du même mois met
 * la ligne à jour au lieu d'en créer une seconde qui la contredirait. C'est
 * aussi le comportement voulu pour une **révision** : l'INSEE révise ses
 * indices, et la valeur la plus récente doit gagner — `fetchedAt` garde la
 * trace du moment où elle a été reprise.
 */

import { prisma } from "../prisma";
import { CPI_SOURCE } from "./cpi-repository";

/** Une observation telle qu'un fournisseur la rend. */
export type CpiFetchedObservation = {
  /** Mois décrit, `YYYY-MM`. */
  period: string;
  /** Variation mensuelle en fraction : 0.002 = +0,2 %. */
  monthlyRate: number;
  /** Glissement annuel publié pour ce mois, si la source le fournit. */
  yearlyRate?: number | null;
  /** Diffusion par la source — distincte du mois décrit. */
  publishedAt?: Date | null;
};

/**
 * Ce qu'un fournisseur d'IPC doit savoir faire.
 *
 * Volontairement minimal : une fonction qui rend des observations. Le reste —
 * déduplication, écriture, rattrapage — appartient au collecteur, et changer
 * de fournisseur ne doit rien en déplacer.
 */
export type CpiProvider = {
  id: string;
  /** Observations disponibles, du plus ancien au plus récent. */
  fetch(opts: { sinceMonths: number }): Promise<CpiFetchedObservation[]>;
};

export type CpiCollectionReport = {
  source: string;
  /** Observations rendues par le fournisseur. */
  fetched: number;
  /** Mois nouvellement enregistrés. */
  created: number;
  /** Mois déjà présents dont une valeur a changé — une révision. */
  revised: number;
  /** Mois déjà présents et identiques : la preuve de l'idempotence. */
  unchanged: number;
  errors: string[];
};

/** Deux nombres décrivent-ils la même valeur publiée ? */
function sameRate(a: number | null | undefined, b: number | null | undefined) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  // Les taux sont stockés en Decimal(12,8) : au-delà, la comparaison porterait
  // sur du bruit de représentation.
  return Math.abs(a - b) < 1e-9;
}

/**
 * Récupère et enregistre les observations manquantes.
 *
 * Rattrape plusieurs mois d'un coup : `sinceMonths` borne la profondeur
 * demandée au fournisseur, et l'écriture ne dépend pas de ce qui manquait —
 * une exécution après six mois d'interruption comble les six.
 *
 * Aucune donnée n'est fabriquée : ce que le fournisseur ne rend pas reste
 * absent, et la courbe le dira.
 */
export async function collectCpiObservations(opts: {
  provider: CpiProvider;
  sinceMonths?: number;
  source?: string;
}): Promise<CpiCollectionReport> {
  const source = opts.source ?? CPI_SOURCE;
  const report: CpiCollectionReport = {
    source,
    fetched: 0,
    created: 0,
    revised: 0,
    unchanged: 0,
    errors: [],
  };

  let observations: CpiFetchedObservation[];
  try {
    observations = await opts.provider.fetch({
      sinceMonths: opts.sinceMonths ?? 72,
    });
  } catch (e) {
    /*
      Source injoignable : rien n'est écrit, et l'échec est nommé. Remplacer
      une publication manquante par une estimation ferait exactement ce que ce
      chantier a supprimé.
    */
    report.errors.push(e instanceof Error ? e.message : "source indisponible");
    return report;
  }

  const valides = observations.filter(
    (o) => /^\d{4}-\d{2}$/.test(o.period) && Number.isFinite(o.monthlyRate)
  );
  report.fetched = valides.length;
  if (valides.length === 0) return report;

  const existantes = await prisma.cpiObservation.findMany({
    where: { source, period: { in: valides.map((o) => o.period) } },
    select: { period: true, monthlyRate: true, yearlyRate: true },
  });
  const connues = new Map(
    existantes.map((e) => [
      e.period,
      {
        monthlyRate: Number(e.monthlyRate.toString()),
        yearlyRate: e.yearlyRate == null ? null : Number(e.yearlyRate.toString()),
      },
    ])
  );

  for (const o of valides) {
    const connue = connues.get(o.period);
    const identique =
      connue != null &&
      sameRate(connue.monthlyRate, o.monthlyRate) &&
      sameRate(connue.yearlyRate, o.yearlyRate ?? null);

    if (identique) {
      report.unchanged++;
      continue;
    }

    try {
      await prisma.cpiObservation.upsert({
        where: { source_period: { source, period: o.period } },
        create: {
          source,
          period: o.period,
          monthlyRate: o.monthlyRate,
          yearlyRate: o.yearlyRate ?? null,
          publishedAt: o.publishedAt ?? null,
        },
        update: {
          monthlyRate: o.monthlyRate,
          yearlyRate: o.yearlyRate ?? null,
          publishedAt: o.publishedAt ?? null,
          fetchedAt: new Date(),
        },
      });
      if (connue) report.revised++;
      else report.created++;
    } catch (e) {
      report.errors.push(
        `${o.period} : ${e instanceof Error ? e.message : "écriture impossible"}`
      );
    }
  }

  return report;
}
