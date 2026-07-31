/**
 * Agrégats de la vue d'ensemble « Assurance-vie ».
 *
 * Fonctions pures, sans Prisma ni React : elles prennent ce que rendent
 * `/api/life-insurance` et `/api/life-insurance/supports`, et produisent
 * exactement ce que l'écran affiche.
 *
 * Deux principes, qui expliquent la plupart des choix ci-dessous :
 *
 * 1. **Rien n'est inventé.** Ce que la source ne donne pas ressort à `null`,
 *    et c'est à l'écran de le dire. Un contrat sans date d'ouverture n'a pas
 *    d'antériorité « 0 an » : il n'en a pas, point.
 * 2. **Les versements ne sont pas la valeur.** L'encours vient du journal
 *    (supports valorisés au marché), les primes de la déclaration fiscale du
 *    contrat. Mélanger les deux fausserait à la fois le gain et l'assiette
 *    d'imposition.
 */

import { isStructured } from "./constants";

/* ── Entrées ──────────────────────────────────────────────────────── */

/** Contrat, tel que rendu par `/api/life-insurance`. */
export type OverviewPolicy = {
  id: string;
  insurer: string;
  openDate: string | null;
  premiumsBefore2017Eur?: string | null;
  premiumsAfter2017Eur?: string | null;
  premiumsTotalEur?: string | null;
  outstandingEur?: string | null;
};

/** Support, tel que rendu par `/api/life-insurance/supports`. */
export type OverviewSupport = {
  assetId: string;
  lifeInsuranceId: string | null;
  name: string;
  kind: string;
  currentValueEur: string | null;
  costBasisEur?: string | null;
  unrealizedPnlEur?: string | null;
  entryFeePct?: string | null;
  managementFeePct?: string | null;
  maturityDate?: string | null;
  nextObservationDate?: string | null;
  couponRatePct?: string | null;
  nominalEur?: string | null;
};

export function num(v: string | number | null | undefined): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/* ── Poches d'épargne ─────────────────────────────────────────────── */

/**
 * Les trois poches d'un contrat.
 *
 * Le structuré est distingué de l'UC : capital conditionnellement protégé,
 * échéance connue, coupon contractuel — le ranger avec les UC ferait passer
 * pour du risque de marché ordinaire un risque de crédit à barrière.
 */
export type SavingsBucket = "FONDS_EURO" | "UC" | "STRUCTURED";

export const BUCKET_LABEL: Record<SavingsBucket, string> = {
  FONDS_EURO: "Fonds en euros",
  UC: "Unités de compte",
  STRUCTURED: "Produits structurés",
};

export function bucketOf(kind: string): SavingsBucket {
  if (kind === "FONDS_EURO") return "FONDS_EURO";
  if (isStructured(kind)) return "STRUCTURED";
  return "UC";
}

export type AllocationSlice = {
  bucket: SavingsBucket;
  label: string;
  valueEur: number;
  /** Part de l'épargne, `null` quand il n'y a rien à répartir. */
  sharePct: number | null;
  supportCount: number;
};

/**
 * Répartition de l'épargne. L'ordre est fixe — fonds euro, UC, structurés —
 * et non trié par poids : la lecture d'un contrat à l'autre doit être la même,
 * et la couleur de chaque poche doit rester celle qu'on a apprise.
 */
export function computeAllocation(
  supports: OverviewSupport[]
): AllocationSlice[] {
  const order: SavingsBucket[] = ["FONDS_EURO", "UC", "STRUCTURED"];
  const byBucket = new Map<SavingsBucket, { value: number; count: number }>();
  let total = 0;

  for (const s of supports) {
    const b = bucketOf(s.kind);
    const value = num(s.currentValueEur);
    const acc = byBucket.get(b) ?? { value: 0, count: 0 };
    acc.value += value;
    acc.count += 1;
    byBucket.set(b, acc);
    total += value;
  }

  return order
    .filter((b) => byBucket.has(b))
    .map((b) => {
      const acc = byBucket.get(b)!;
      return {
        bucket: b,
        label: BUCKET_LABEL[b],
        valueEur: acc.value,
        sharePct: total > 0 ? (acc.value / total) * 100 : null,
        supportCount: acc.count,
      };
    });
}

/* ── Totaux de la page ────────────────────────────────────────────── */

export type OverviewTotals = {
  /** Encours au marché, somme des supports du journal. */
  totalValueEur: number;
  /** Primes versées déclarées sur les contrats. */
  totalPremiumsEur: number;
  /**
   * Plus-value latente des supports — le seul gain que le journal établisse.
   * Rendu séparément du gain « encours − primes », qui n'a de sens que si les
   * primes sont renseignées.
   */
  unrealizedGainEur: number;
  /**
   * Gain depuis l'origine : encours − primes versées. `null` tant qu'aucune
   * prime n'est déclarée — sans elles, ce serait l'encours tout entier
   * présenté comme un gain.
   */
  gainSincePremiumsEur: number | null;
  /** Rapporté aux primes, `null` pour la même raison. */
  gainSincePremiumsPct: number | null;
  contractCount: number;
  supportCount: number;
  /** Supports du journal non rattachés à un contrat. */
  unattachedSupportCount: number;
  unattachedValueEur: number;
};

export function computeTotals(
  policies: OverviewPolicy[],
  supports: OverviewSupport[]
): OverviewTotals {
  let totalValueEur = 0;
  let unrealizedGainEur = 0;
  let unattachedSupportCount = 0;
  let unattachedValueEur = 0;

  for (const s of supports) {
    const value = num(s.currentValueEur);
    totalValueEur += value;
    unrealizedGainEur += num(s.unrealizedPnlEur);
    if (!s.lifeInsuranceId) {
      unattachedSupportCount += 1;
      unattachedValueEur += value;
    }
  }

  const totalPremiumsEur = policies.reduce(
    (sum, p) => sum + policyPremiumsEur(p),
    0
  );

  const gainSincePremiumsEur =
    totalPremiumsEur > 0 ? totalValueEur - totalPremiumsEur : null;

  return {
    totalValueEur,
    totalPremiumsEur,
    unrealizedGainEur,
    gainSincePremiumsEur,
    gainSincePremiumsPct:
      gainSincePremiumsEur != null && totalPremiumsEur > 0
        ? (gainSincePremiumsEur / totalPremiumsEur) * 100
        : null,
    contractCount: policies.length,
    supportCount: supports.length,
    unattachedSupportCount,
    unattachedValueEur,
  };
}

/**
 * Primes versées d'un contrat.
 *
 * Le total déclaré prime sur la somme avant/après 2017 quand il existe : c'est
 * le champ que l'utilisateur voit et corrige. Les deux tranches ne servent
 * qu'au taux d'imposition.
 */
export function policyPremiumsEur(p: OverviewPolicy): number {
  const declared = num(p.premiumsTotalEur);
  if (declared > 0) return declared;
  return num(p.premiumsBefore2017Eur) + num(p.premiumsAfter2017Eur);
}

/* ── Vue d'un contrat ─────────────────────────────────────────────── */

export type ContractView = {
  policy: OverviewPolicy;
  /**
   * Titre de la carte : le nom du contrat s'il en porte un, l'assureur sinon.
   * Le modèle actuel ne stocke que l'assureur — la carte l'affiche donc en
   * titre, avec le type en sous-titre, plutôt que d'inventer un nom.
   */
  title: string;
  subtitle: string;
  /** « Multi-supports » ou « Mono-support (fonds euro) », déduit des supports. */
  contractType: string;
  valueEur: number;
  premiumsEur: number;
  costBasisEur: number;
  unrealizedGainEur: number;
  /** Plus-value rapportée au prix de revient, `null` si rien n'est investi. */
  unrealizedGainPct: number | null;
  allocation: AllocationSlice[];
  /** Part du fonds euro, `null` s'il n'y a rien à répartir. */
  euroSharePct: number | null;
  supports: OverviewSupport[];
  /** Ancienneté fiscale en années pleines, `null` sans date d'ouverture. */
  ageYears: number | null;
  /** Le contrat a-t-il passé le cap des huit ans ? `null` si on l'ignore. */
  isMature: boolean | null;
  /** Part du contrat dans l'encours total, `null` si l'encours est nul. */
  sharePct: number | null;
};

const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

export function contractAgeYears(
  openDate: string | null | undefined,
  now = new Date()
): number | null {
  if (!openDate) return null;
  const t = Date.parse(openDate);
  if (!Number.isFinite(t)) return null;
  const years = (now.getTime() - t) / MS_PER_YEAR;
  return years < 0 ? 0 : years;
}

/**
 * Type de contrat, déduit de ce qu'il détient.
 *
 * Un contrat sans support ne dit rien de sa nature : « — » plutôt que
 * « mono-support », qui serait une affirmation sur un contrat vide.
 */
export function contractTypeLabel(supports: OverviewSupport[]): string {
  if (supports.length === 0) return "—";
  const buckets = new Set(supports.map((s) => bucketOf(s.kind)));
  if (buckets.size > 1) return "Multi-supports";
  const only = [...buckets][0]!;
  if (only === "FONDS_EURO") return "Mono-support (fonds euro)";
  if (only === "STRUCTURED") return "Produits structurés";
  return "Unités de compte";
}

export function buildContractView(
  policy: OverviewPolicy,
  allSupports: OverviewSupport[],
  totalValueEur: number,
  now = new Date()
): ContractView {
  const supports = allSupports.filter((s) => s.lifeInsuranceId === policy.id);

  let valueEur = 0;
  let costBasisEur = 0;
  let unrealizedGainEur = 0;
  for (const s of supports) {
    valueEur += num(s.currentValueEur);
    costBasisEur += num(s.costBasisEur);
    unrealizedGainEur += num(s.unrealizedPnlEur);
  }

  const allocation = computeAllocation(supports);
  const euro = allocation.find((a) => a.bucket === "FONDS_EURO");
  const ageYears = contractAgeYears(policy.openDate, now);

  return {
    policy,
    title: policy.insurer || "Contrat",
    subtitle: policy.insurer,
    contractType: contractTypeLabel(supports),
    valueEur,
    premiumsEur: policyPremiumsEur(policy),
    costBasisEur,
    unrealizedGainEur,
    unrealizedGainPct:
      costBasisEur > 0 ? (unrealizedGainEur / costBasisEur) * 100 : null,
    allocation,
    euroSharePct: euro?.sharePct ?? (valueEur > 0 ? 0 : null),
    supports,
    ageYears,
    isMature: ageYears == null ? null : ageYears >= 8,
    sharePct: totalValueEur > 0 ? (valueEur / totalValueEur) * 100 : null,
  };
}

/**
 * Contrats du plus gros au plus petit encours. À encours égal — deux contrats
 * vides, le cas d'un compte qu'on vient d'ouvrir — le plus ancien passe devant.
 */
export function buildContractViews(
  policies: OverviewPolicy[],
  supports: OverviewSupport[],
  now = new Date()
): ContractView[] {
  const totalValueEur = supports.reduce(
    (sum, s) => sum + num(s.currentValueEur),
    0
  );
  return policies
    .map((p) => buildContractView(p, supports, totalValueEur, now))
    .sort((a, b) => {
      if (b.valueEur !== a.valueEur) return b.valueEur - a.valueEur;
      const da = a.policy.openDate ? Date.parse(a.policy.openDate) : Infinity;
      const db = b.policy.openDate ? Date.parse(b.policy.openDate) : Infinity;
      return da - db;
    });
}

/* ── Frais et échéances ───────────────────────────────────────────── */

/**
 * Frais de gestion annuels moyens du contrat, pondérés par l'encours.
 *
 * Pondérés, et non moyennés simplement : un support à 0,50 % portant 90 % de
 * l'encours ne coûte pas la même chose qu'un support à 0,50 % en portant 2 %.
 * Rend `null` si aucun support ne renseigne son taux — une moyenne sur rien
 * afficherait « 0,00 % de frais », ce qui n'existe pas.
 */
export function weightedManagementFeePct(
  supports: OverviewSupport[]
): number | null {
  let weighted = 0;
  let base = 0;
  for (const s of supports) {
    if (s.managementFeePct == null || String(s.managementFeePct).trim() === "") {
      continue;
    }
    const value = num(s.currentValueEur);
    if (value <= 0) continue;
    weighted += num(s.managementFeePct) * value;
    base += value;
  }
  return base > 0 ? weighted / base : null;
}

export type ContractMilestone = {
  supportName: string;
  /** `OBSERVATION` — constatation d'un structuré ; `MATURITY` — échéance. */
  kind: "OBSERVATION" | "MATURITY";
  label: string;
  dateIso: string;
  daysAway: number;
};

/**
 * Prochaines échéances connues d'un contrat.
 *
 * Seules les dates réellement portées par un support structuré apparaissent —
 * constatation et échéance. Les versements programmés et arbitrages
 * automatiques n'existent pas encore côté serveur : l'écran le dit, il ne les
 * simule pas.
 */
export function upcomingMilestones(
  supports: OverviewSupport[],
  now = new Date(),
  limit = 3
): ContractMilestone[] {
  const out: ContractMilestone[] = [];
  const today = now.getTime();

  for (const s of supports) {
    const entries: Array<[ContractMilestone["kind"], string | null | undefined, string]> = [
      ["OBSERVATION", s.nextObservationDate, "Constatation"],
      ["MATURITY", s.maturityDate, "Échéance"],
    ];
    for (const [kind, raw, label] of entries) {
      if (!raw) continue;
      const t = Date.parse(raw);
      if (!Number.isFinite(t) || t < today) continue;
      out.push({
        supportName: s.name,
        kind,
        label,
        dateIso: new Date(t).toISOString(),
        daysAway: Math.round((t - today) / (24 * 3600 * 1000)),
      });
    }
  }

  return out.sort((a, b) => a.daysAway - b.daysAway).slice(0, limit);
}
