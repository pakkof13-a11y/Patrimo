/**
 * Famille d'un support d'épargne salariale.
 *
 * Un FCPE n'annonce pas sa nature dans une colonne : elle est dans son nom,
 * parce que c'est ainsi que les gestionnaires les baptisent — « Amundi Label
 * Actions Euro », « Natixis Monétaire », « Horizon 2040 ». On lit donc le nom
 * pour proposer une famille, et l'utilisateur la corrige d'un clic.
 *
 * La distinction compte : elle ne décrit pas un montant mais un **risque**.
 * Ranger un fonds monétaire parmi les actions ferait passer pour exposé un
 * capital qui ne l'est pas, et l'inverse est pire encore.
 *
 * Module pur : ni Prisma, ni React.
 */

export const FUND_CATEGORIES = [
  "EQUITY",
  "DIVERSIFIED",
  "BOND",
  "MONETARY",
  "OTHER",
] as const;

export type FundCategory = (typeof FUND_CATEGORIES)[number];

export const FUND_CATEGORY_LABELS: Record<FundCategory, string> = {
  EQUITY: "Fonds actions",
  DIVERSIFIED: "Fonds diversifiés",
  BOND: "Fonds obligataires",
  MONETARY: "Fonds monétaires",
  OTHER: "Autres",
};

/**
 * Ordre d'affichage, du plus exposé au moins exposé.
 *
 * Fixe, et non trié par poids : la place d'une famille — donc sa couleur —
 * ne doit pas changer d'un plan à l'autre.
 */
export const FUND_CATEGORY_ORDER: FundCategory[] = [
  "EQUITY",
  "DIVERSIFIED",
  "BOND",
  "MONETARY",
  "OTHER",
];

export function isFundCategory(value: unknown): value is FundCategory {
  return (
    typeof value === "string" &&
    (FUND_CATEGORIES as readonly string[]).includes(value)
  );
}

export function fundCategoryLabel(value: string | null | undefined): string {
  return isFundCategory(value) ? FUND_CATEGORY_LABELS[value] : "Autres";
}

/**
 * Motifs de reconnaissance, testés dans l'ordre.
 *
 * Le monétaire passe avant tout : « Amundi Monétaire Actions » n'existe pas,
 * mais « Sécurité Monétaire » oui, et un fonds de trésorerie mal classé en
 * actions est la seule erreur qui coûte cher à l'utilisateur.
 */
const PATTERNS: Array<{ category: FundCategory; test: RegExp }> = [
  {
    category: "MONETARY",
    test: /\b(monetaire|tresorerie|securite|money\s*market|liquidites?)\b/,
  },
  { category: "EQUITY", test: /\b(actions?|equity|equities|small\s*cap|mid\s*cap)\b/ },
  { category: "BOND", test: /\b(obligataire|obligations?|bond|credit|taux)\b/ },
  {
    category: "DIVERSIFIED",
    test: /\b(diversifiee?s?|equilibree?|mixte|multi[-\s]?actifs?|allocation|patrimoine|prudent|dynamique|horizon|balanced)\b/,
  },
  // Un fonds daté (« Horizon 2040 », « Retraite 2035 ») est diversifié par
  // construction : son allocation glisse des actions vers l'obligataire à
  // mesure que l'échéance approche.
  { category: "DIVERSIFIED", test: /\b20\d{2}\b/ },
];

/**
 * Forme comparable d'un nom de fonds : minuscules, sans accents.
 *
 * Les motifs sont écrits en ASCII pour une raison précise : `\b` ne reconnaît
 * pas « é » comme une lettre, si bien que `\béquilibré\b` ne trouve jamais
 * « Équilibré ». Normaliser d'abord évite ce piège, et fait au passage
 * reconnaître « diversifie » saisi sans accent.
 */
function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Famille déduite du nom d'un fonds, ou `null` si rien ne s'en dégage.
 *
 * `null` et non « Autres » : ne pas savoir n'est pas une catégorie, et
 * l'écran doit pouvoir distinguer les deux — l'un se corrige d'un clic,
 * l'autre est un choix assumé.
 */
export function inferFundCategory(fundName: string): FundCategory | null {
  const name = normalize((fundName || "").trim());
  if (!name) return null;
  for (const { category, test } of PATTERNS) {
    if (test.test(name)) return category;
  }
  return null;
}

export type ResolvedFundCategory = {
  category: FundCategory;
  /** `declared` — choisie par l'utilisateur ; `inferred` — lue dans le nom. */
  source: "declared" | "inferred" | "unknown";
};

/**
 * Famille retenue pour l'affichage : la déclaration prime toujours sur la
 * déduction, et l'origine est rendue avec elle pour que l'écran puisse le dire.
 */
export function resolveFundCategory(input: {
  fundCategory?: string | null;
  fundName?: string | null;
}): ResolvedFundCategory {
  if (isFundCategory(input.fundCategory)) {
    return { category: input.fundCategory, source: "declared" };
  }
  const inferred = inferFundCategory(input.fundName ?? "");
  if (inferred) return { category: inferred, source: "inferred" };
  return { category: "OTHER", source: "unknown" };
}
