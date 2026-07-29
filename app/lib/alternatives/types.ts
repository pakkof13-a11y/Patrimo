/**
 * Le vocabulaire des métaux précieux vit dans `precious-metals/constants.ts` —
 * fichier sans dépendance à Prisma, donc importable par les formulaires. On le
 * réexporte ici pour ne pas casser les imports existants.
 */
export {
  FORMAT_LABELS,
  GRAMS_PER_TROY_OZ,
  METAL_LABELS,
  PRECIOUS_FORMATS,
  PRECIOUS_METALS,
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABELS,
  WEIGHT_UNITS,
  WEIGHT_UNIT_LABELS,
  type PreciousFormat,
  type PreciousMetal,
  type PreciousProductType,
  type WeightUnit,
} from "@/app/lib/precious-metals/constants";

import type {
  PreciousFormat,
  PreciousMetal,
  PreciousProductType,
  WeightUnit,
} from "@/app/lib/precious-metals/constants";

export type PreciousMetalDto = {
  id: string;
  metal: PreciousMetal;
  format: PreciousFormat;
  productType: PreciousProductType;
  denomination: string;
  /** Titre en millièmes — 900 pour un Napoléon, 999,9 pour un lingot. */
  fineness: string;
  quantity: string;
  unitWeightG: string;
  weightUnit: WeightUnit;
  /** Poids unitaire affiché dans l’unité saisie */
  unitWeightDisplay: string;
  purchasePriceUnit: string;
  acquisitionFees: string;
  /** ISO — sans elle, pas d'abattement pour durée de détention. */
  acquiredAt: string | null;
  /** Facture nominative datée : condition de l'option 2092-SD. */
  hasInvoice: boolean;
  currentValue: string;
  currency: string;
  storageLocation: string | null;
  notes: string | null;
  /** quantity × PRU + frais d'acquisition */
  costBasis: string;
  /** currentValue − costBasis */
  unrealizedPnl: string;
  /** % vs cost basis */
  unrealizedPnlPct: string;
  /** quantity × unitWeightG — poids brut */
  totalWeightG: string;
  /** Poids brut × titre : le seul comparable d'un métal à l'autre. */
  fineWeightG: string;
  unitValueEur: string;
};

export type PreciousMetalsSummary = {
  totalCost: string;
  totalValue: string;
  totalPnl: string;
  totalPnlPct: number;
  totalWeightG: string;
  totalFineWeightG: string;
  lineCount: number;
  /** Lots sans date d'acquisition — option fiscale fermée. */
  undatedCount: number;
  /** Lots physiques sans justificatif — option fiscale fermée. */
  noInvoiceCount: number;
  byFormat: { name: string; value: number }[];
  byMetal: {
    metal: string;
    name: string;
    value: number;
    fineWeightG: string;
  }[];
};

export type AlternativesSubTab =
  | "dashboard"
  | "metals"
  | "private-equity"
  | "crowdlending"
  | "tangibles";

// ─── Actifs tangibles / collection ────────────────────────────────────────────

/**
 * Le vocabulaire des tangibles vit dans `tangibles/constants.ts` — fichier
 * sans dépendance à Prisma, donc importable par les formulaires.
 */
export {
  TANGIBLE_CATEGORIES,
  TANGIBLE_CATEGORY_ICONS,
  TANGIBLE_CATEGORY_LABELS,
  fiscalNature,
  type TangibleCategory,
} from "@/app/lib/tangibles/constants";

import type { TangibleCategory } from "@/app/lib/tangibles/constants";
import type { MovableTaxRegime } from "@/app/lib/tax/movable-assets";

export type TangibleAssetDto = {
  id: string;
  category: TangibleCategory;
  brandOrArtist: string;
  modelName: string;
  yearOrVintage: string | null;
  purchasePrice: string;
  estimatedValue: string;
  currency: string;
  hasCertificate: boolean;
  notes: string | null;
  unrealizedPnl: string;
  unrealizedPnlPct: string;

  // Acquisition
  purchaseDate: string | null;
  purchaseSource: string | null;
  certificateRef: string | null;
  certificateIssuer: string | null;
  /** Facture ou bordereau d'adjudication — seule preuve ouvrant l'option. */
  hasPurchaseProof: boolean;
  /** Commissaire-priseur, expertise, transport — entrent dans le revient. */
  acquisitionFees: string | null;

  // Valorisation & conservation
  appraisalValue: string | null;
  appraisalDate: string | null;
  appraisalProvider: string | null;
  insuranceValue: string | null;
  storageLocation: string | null;
  isCollectible: boolean;

  // Détails par catégorie — tous nullables, seuls les pertinents sont saisis
  gemType: string | null;
  caratWeight: string | null;
  gemClarity: string | null;
  gemColor: string | null;
  gemCut: string | null;
  gemTreatment: string | null;
  gemOrigin: string | null;
  jewelryType: string | null;
  metalBase: string | null;
  metalWeightG: string | null;
  hasPunchmarks: boolean | null;
  watchMovement: string | null;
  watchDiameterMm: string | null;
  watchReference: string | null;
  watchBoxPapers: boolean | null;
  wineAppellation: string | null;
  wineBottleCount: number | null;
  wineBottleFormat: string | null;
  wineStorageType: string | null;
  autoMileageKm: number | null;
  autoRegistration: string | null;
  autoInspectionOk: boolean | null;
  autoPreviousOwners: number | null;

  // Assurance & garde
  insurancePremiumAnnual: string | null;
  insuranceProvider: string | null;
  insurancePolicyRef: string | null;
  insuranceExpiryDate: string | null;
  insuranceType: string | null;
  storageType: string | null;
  storageCostAnnual: string | null;
  storageProvider: string | null;
  storageContractRef: string | null;
  storageRenewalDate: string | null;

  // Transmission — marqueur seul, aucun droit de succession n'est calculé
  includeInEstate: boolean;
  estateNote: string | null;

  /** Fiscalité simulée sur une cession à la valeur estimée. */
  tax: TangibleTaxPreview;
  /** Coût de détention — informatif, jamais déductible de l'impôt. */
  ownership: TangibleOwnership;
};

/**
 * Coût de possession d'une ligne.
 *
 * Distinct de `tax` à dessein : les frais de garde et les primes ne sont pas
 * déductibles de la plus-value imposable de l'article 150 VI. Les deux blocs
 * ne doivent jamais être additionnés.
 */
export type TangibleOwnership = {
  /** Prime + garde, pour une année. */
  annualCostEur: string;
  /** Cumul depuis l'acquisition — `null` sans date d'achat. */
  totalCarryCostEur: string | null;
  /** Plus-value diminuée du portage — `null` si le cumul est inconnu. */
  netPnlEur: string | null;
  netPnlPct: string | null;
  /** Part du gain brut absorbée par les frais, en %. */
  carryDragPct: string | null;
  /** Capital assuré ÷ valeur estimée — `null` sans assurance déclarée. */
  coverageRatio: number | null;
  /** NONE | EXPIRED | EXPIRING | UNDER | OVER | OK */
  insuranceStatus: string;
  /** Alertes triées par gravité décroissante. */
  alerts: { code: string; message: string }[];
};

/**
 * Aperçu fiscal d'une ligne, calculé sur une revente **à la valeur estimée**.
 *
 * C'est une projection, pas une dette : rien n'est dû tant que le bien n'est
 * pas vendu. Elle répond à la seule question utile avant de vendre — combien
 * il resterait, et sous quel régime.
 */
export type TangibleTaxPreview = {
  /** Années révolues depuis l'achat, `null` sans date d'acquisition. */
  holdingYears: number | null;
  /** Prix d'achat majoré des frais d'acquisition. */
  costBasisEur: string;
  /**
   * Année de détention où le régime réel devient moins cher que le forfait.
   * `null` quand la bascule n'arrive jamais — cession exonérée ou à perte.
   */
  breakEvenYear: number | null;
  /** Aucun impôt dû sur cette cession simulée. */
  exempt: boolean;
  /** NATURE | SMALL_SALE | HOLDING_PERIOD, ou `null` si un impôt reste dû. */
  exemptionReason: string | null;
  flatTaxEur: string;
  capitalGainTaxEur: string;
  /** Régime le moins coûteux parmi ceux ouverts. */
  recommendedRegime: MovableTaxRegime;
  /** Impôt effectivement retenu — celui du régime recommandé. */
  taxDueEur: string;
  /** Produit net de la cession simulée. */
  netProceedsEur: string;
  optionAvailable: boolean;
  rationale: string;
};

export type TangibleAssetsSummary = {
  totalCost: string;
  totalValue: string;
  totalPnl: string;
  totalPnlPct: number;
  lineCount: number;
  byCategory: { name: string; value: number }[];
  /** Somme des capitaux assurés déclarés, à comparer à la valeur estimée. */
  totalInsuredValue: string;
  /** Somme des impôts simulés — projection, jamais une dette exigible. */
  estimatedTaxBurden: string;
  /** Lignes exonérées : sous le seuil de 5 000 €, ou exonérées par nature. */
  exemptCount: number;
  withCertificateCount: number;
  withAppraisalCount: number;
  /** Lignes sans date d'achat : option fiscale fermée à la revente. */
  undatedCount: number;
  /** Lignes dont le justificatif d'achat est conservé. */
  withPurchaseProofCount: number;
  /** Lignes exonérées par la seule durée de détention (22 ans). */
  fullyExemptCount: number;
  /** Objets couverts à moins de 80 % de leur valeur. */
  underInsuredCount: number;
  /** Objets de plus de 5 000 € sans aucune assurance. */
  uninsuredHighValueCount: number;
  /** Polices échues ou expirant sous 30 jours. */
  expiringPolicyCount: number;
  /** Somme des frais de garde annuels déclarés. */
  totalAnnualCustodyCost: string;
  /** Coût de possession annuel : primes d'assurance + garde. */
  totalAnnualOwnershipCost: string;
  /** Lignes dont la garde dépasse 1 % de la valeur par an. */
  highCustodyCostCount: number;
  /** Nombre total d'alertes de possession, tous objets confondus. */
  ownershipAlertCount: number;
  /** Valeur des objets exclus de l'assiette successorale. */
  excludedFromEstateEur: string;
};

/** Agrégat des 4 poches alternatives (valeurs en EUR) */
export type AlternativesPortfolioSlice = {
  metalsEur: number;
  privateEquityEur: number;
  crowdlendingEur: number;
  tangiblesEur: number;
  totalEur: number;
  slices: { id: string; name: string; value: number }[];
};

/**
 * Payload unique pour le dashboard Alternatifs (1 HTTP au lieu d’un fan-out 5).
 * Les sous-modules continuent d’utiliser leurs endpoints list pour le détail.
 */
export type AlternativesDashboardPayload = {
  summary: AlternativesPortfolioSlice;
  metals: PreciousMetalsSummary;
  privateEquity: PrivateEquitySummary;
  crowdlending: CrowdlendingSummary;
  tangibles: TangibleAssetsSummary;
};

// ─── Private equity ───────────────────────────────────────────────────────────

export const PE_TYPES = ["CROWDEQUITY", "CLUB_DEAL", "DIRECT", "HOLDING"] as const;
export type PeType = (typeof PE_TYPES)[number];

export const PE_TYPE_LABELS: Record<PeType, string> = {
  CROWDEQUITY: "Crowdequity",
  CLUB_DEAL: "Club Deal",
  DIRECT: "Direct",
  HOLDING: "Holding",
};

export type PrivateEquityDto = {
  id: string;
  companyName: string;
  sector: string | null;
  peType: PeType;
  shares: string;
  acquisitionPricePerShare: string;
  investmentDate: string | null;
  currentNav: string;
  currency: string;
  notes: string | null;
  /** shares × PRU */
  investedTotal: string;
  /** Alias historique de `tvpi` (même valeur, même formule). Le champ
   * `moic` désignait auparavant currentNav / investedTotal (avant
   * l'existence de `distributionsReceived`) ; il porte maintenant le vrai
   * multiple total pour rester la métrique de référence affichée par les
   * consommateurs existants (UI, dashboard), sans les forcer à migrer vers
   * `tvpi`. Contrairement à `tvpi`, reste toujours une string non nulle —
   * `"0.00"` quand calledCapital (après repli) est nul — afin de ne pas
   * introduire de `null` sur un champ qui n'en portait pas jusqu'ici. */
  moic: string;
  unrealizedPnl: string;
  unrealizedPnlPct: string;
  /** Capital total engagé (commitment), distinct du capital effectivement
   * appelé. Valeur brute, aucun repli. */
  committedCapital: string;
  /** Capital appelé — valeur brute stockée, sans repli appliqué (voir
   * `calledCapitalIsDerived`). */
  calledCapital: string;
  /** `true` quand aucun appel de capital n'a été saisi : les calculs qui en
   * dépendent (TVPI, DPI, RVPI) utilisent alors shares × PRU comme valeur
   * de repli, pas un montant réellement saisi. */
  calledCapitalIsDerived: boolean;
  /** Cumul des distributions perçues (dividendes, cessions partielles,
   * retour de capital) */
  distributionsReceived: string;
  /** DPI (Distributions to Paid-In) = distributionsReceived /
   * calledCapital(après repli) — `null` si aucun capital appelé, faute de
   * base pour un ratio. */
  dpi: string | null;
  /** RVPI (Residual Value to Paid-In) = currentNav / calledCapital(après
   * repli) — `null` si aucun capital appelé. */
  rvpi: string | null;
  /** TVPI (Total Value to Paid-In) = (currentNav + distributionsReceived) /
   * calledCapital(après repli) — `null` si aucun capital appelé. Valeur de
   * référence ; `moic` en est l'alias rétrocompatible (voir plus haut). */
  tvpi: string | null;
  /** Quote-part détenue, en % — saisie optionnelle, `null` si non
   * renseignée. */
  ownershipPercent: string | null;
  expectedExitDate: string | null;
  vehicleName: string | null;
  round: string | null;
};

export type PrivateEquitySummary = {
  totalInvested: string;
  totalNav: string;
  totalPnl: string;
  avgMoic: number;
  lineCount: number;
  /** Somme du capital appelé, repli appliqué ligne à ligne (voir
   * `calledCapitalIsDerived`). */
  totalCalledCapital: string;
  /** Somme des distributions perçues sur l'ensemble des lignes. */
  totalDistributions: string;
  /** DPI du portefeuille = totalDistributions / totalCalledCapital —
   * `null` si aucun capital appelé sur l'ensemble des lignes. */
  avgDpi: number | null;
  /** RVPI du portefeuille = totalNav / totalCalledCapital — `null` si
   * aucun capital appelé. */
  avgRvpi: number | null;
  /** TVPI du portefeuille = (totalNav + totalDistributions) /
   * totalCalledCapital — `null` si aucun capital appelé. */
  avgTvpi: number | null;
};

// ─── Crowdlending ─────────────────────────────────────────────────────────────

export const CL_REPAYMENT_TYPES = ["IN_FINE", "AMORTIZING"] as const;
export type ClRepaymentType = (typeof CL_REPAYMENT_TYPES)[number];

export const CL_REPAYMENT_LABELS: Record<ClRepaymentType, string> = {
  IN_FINE: "In fine",
  AMORTIZING: "Amortissable",
};

/** Fréquence de versement des intérêts — distincte de repaymentType, qui porte sur le capital. */
export const CL_PAYMENT_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
  "IN_FINE",
] as const;
export type ClPaymentFrequency = (typeof CL_PAYMENT_FREQUENCIES)[number];

export const CL_PAYMENT_FREQUENCY_LABELS: Record<ClPaymentFrequency, string> = {
  MONTHLY: "Mensuelle",
  QUARTERLY: "Trimestrielle",
  ANNUAL: "Annuelle",
  IN_FINE: "In fine (paiement unique à l'échéance)",
};

export const CL_STATUSES = ["ACTIVE", "LATE", "REPAID", "DEFAULT"] as const;
export type ClStatus = (typeof CL_STATUSES)[number];

export const CL_STATUS_LABELS: Record<ClStatus, string> = {
  ACTIVE: "En cours",
  LATE: "En retard",
  REPAID: "Remboursé",
  DEFAULT: "Défaut",
};

export type CrowdlendingDto = {
  id: string;
  projectName: string;
  platform: string | null;
  capitalInvested: string;
  annualYieldPercent: string;
  durationMonths: number;
  repaymentType: ClRepaymentType;
  startDate: string | null;
  maturityDate: string | null;
  status: ClStatus;
  currency: string;
  notes: string | null;
  /** Mois restants jusqu'à échéance (négatif si dépassé) */
  monthsRemaining: number | null;
  /** 0–100 progression du prêt (temps) */
  progressPct: number | null;
  /** Capital restant dû — valeur brute stockée, sans repli appliqué.
   * Destinée au formulaire d'édition : la ressaisir telle quelle ne
   * persiste jamais un chiffre déduit. Pour l'affichage et les calculs,
   * utiliser `effectiveRemainingCapital`. */
  remainingCapital: string;
  /** Capital restant dû après repli — capital initial tant qu'aucun
   * remboursement partiel n'a été saisi, 0 sur un prêt soldé. C'est la
   * valeur qui alimente les agrégats et l'affichage. */
  effectiveRemainingCapital: string;
  /** `true` quand `effectiveRemainingCapital` a été déduit du capital
   * initial faute de saisie, et non renseigné par l'utilisateur. Permet à
   * l'UI de distinguer les deux sans dupliquer la règle de repli. */
  remainingCapitalIsDerived: boolean;
  /** Cumul des intérêts déjà perçus sur cette ligne */
  interestReceivedToDate: string;
  paymentFrequency: ClPaymentFrequency;
  nextPaymentDate: string | null;
  /** Notation de risque plateforme — "A" | "B" | "C" ou libre */
  riskGrade: string | null;
  /** Estimation simple des intérêts totaux sur la durée du prêt (in fine :
   * capital plein sur toute la durée ; amortissable : approximation par
   * amortissement linéaire, capital moyen = moitié du capital initial). */
  expectedTotalInterest: string;
};

export type CrowdlendingSummary = {
  totalCapital: string;
  activeCapital: string;
  lineCount: number;
  byStatus: { status: string; label: string; count: number; capital: number }[];
  /** Rendement moyen pondéré par le capital actif restant dû, en % —
   * `null` si aucun capital actif (rien à pondérer). */
  weightedAverageYield: number | null;
  /** Revenu annuel projeté sur le capital actif, au taux nominal de chaque ligne */
  projectedAnnualIncome: string;
  /** Somme du capital restant dû (repli appliqué) sur l'ensemble des lignes */
  remainingCapitalTotal: string;
  /** Somme des intérêts déjà perçus sur l'ensemble des lignes */
  interestReceivedTotal: string;
};
