import { z } from "zod";
import { TX_TYPES } from "./accounting/types";

export const assetClasses = [
  "ACTIONS",
  "CRYPTO",
  "IMMOBILIER",
  "OBLIGATIONS",
  "CASH",
  "AUTRE",
] as const;

export const accountTypes = ["CTO", "PEA", "AV", "CRYPTO", "IMMOBILIER", "CFD"] as const;

/** Sous-catégorie UI (Asset.category) — n’impacte pas les calculs. */
export const assetCategories = [
  "EQUITY",
  "ETF",
  "BOND",
  "MONEY_MARKET",
  "FUND",
  "REIT",
  "CRYPTO",
  "CASH_EQUIVALENT",
  "SCPI",
  "REAL_ESTATE_DIRECT",
  "PRIVATE_EQUITY",
  "COMMODITY",
  "DERIVATIVE",
  "OTHER",
  "UNCLASSIFIED",
] as const;

export const updateAssetCategorySchema = z.object({
  category: z.enum(assetCategories),
});

export const platformTypes = [
  "COURTIER",
  "ASSURANCE_VIE",
  "EXCHANGE_CRYPTO",
  "BANQUE",
  "BLOCKCHAIN",
  "PORTEFEUILLE_HARDWARE",
  "NOTAIRE_IMMOBILIER",
  "BROKER_CFD",
  "AUTRE",
] as const;

export const priceProviders = ["FINNHUB", "YAHOO", "COINGECKO", "MANUAL"] as const;

export const transactionTypes = TX_TYPES;

const decimalString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => v === "" || !Number.isNaN(Number(v)), "Nombre invalide");

export const addAssetSchema = z.object({
  name: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
  ticker: z.string().optional().or(z.literal("")),
  assetClass: z.enum(assetClasses),
  platformId: z.string().min(1, "Veuillez sélectionner une plateforme"),
  currency: z.string().min(3).max(3).default("EUR"),
  /** ISO pays émetteur (US, DE, FR…) pour WHT dividendes */
  countryCode: z
    .string()
    .optional()
    .nullable()
    .transform((v) => {
      if (!v || !String(v).trim()) return null;
      return String(v).trim().toUpperCase().slice(0, 2);
    }),
  /** Override taux source 0–1 ou 0–100 */
  withholdingTaxRate: decimalString.optional().nullable(),
  accountType: z.enum(accountTypes).default("CTO"),
  priceProvider: z.enum(priceProviders).default("FINNHUB"),
  providerSymbol: z.string().optional().or(z.literal("")),
  acquisitionDate: z.string().optional(),
  manualPrice: z.preprocess(
    (val) => (val === "" || val == null ? undefined : String(val).replace(",", ".")),
    z.string().optional()
  ),
  notes: z.string().optional(),
});

export type AddAssetForm = z.infer<typeof addAssetSchema>;

export const createTransactionSchema = z
  .object({
    type: z.enum(transactionTypes),
    platformId: z.string().min(1, "Plateforme requise"),
    toPlatformId: z.string().optional().nullable(),
    assetId: z.string().optional().nullable(),
    /** Optional ticker correction applied to the asset on save (not stored on the tx itself). */
    ticker: z.string().optional().nullable(),
    quantity: decimalString.optional(),
    unitPrice: decimalString.optional(),
    cashAmount: decimalString.optional(),
    fees: decimalString.optional().default("0"),
    currency: z.string().min(3).max(3).default("EUR"),
    fxRateToEur: decimalString.optional().default("1"),
    /** Taux WHT 0–1 (dividendes) — sinon dérivé de l'actif / pays */
    withholdingTaxRate: decimalString.optional().nullable(),
    /** Date de détachement (optionnel) */
    exDate: z.string().optional().nullable(),
    /** Date de paiement cash (optionnel, défaut = occurredAt) */
    paymentDate: z.string().optional().nullable(),
    occurredAt: z.string().min(1, "Date requise"),
    notes: z.string().optional(),
    autoFundCash: z.boolean().optional(),
    allowNegativeCash: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const needsAsset = [
      "ACHAT",
      "VENTE",
      "REWARD",
      "TRANSFERT_TITRE",
      "DIVIDENDE",
      "COUPON",
      "LOYER",
      "SPLIT",
    ].includes(data.type);
    if (needsAsset && !data.assetId) {
      ctx.addIssue({ code: "custom", message: "Actif requis", path: ["assetId"] });
    }
    if (["ACHAT", "VENTE", "REWARD", "TRANSFERT_TITRE", "SPLIT"].includes(data.type)) {
      if (!data.quantity || Number(data.quantity) <= 0) {
        ctx.addIssue({
          code: "custom",
          message:
            data.type === "SPLIT"
              ? "Ratio de split strictement positif (ex. 2)"
              : "Quantité positive requise",
          path: ["quantity"],
        });
      }
    }
    if (["ACHAT", "VENTE"].includes(data.type)) {
      if (!data.unitPrice || Number(data.unitPrice) < 0) {
        ctx.addIssue({ code: "custom", message: "Prix unitaire requis", path: ["unitPrice"] });
      }
    }
    // REWARD : prix unitaire optionnel (FMV d’affichage) — si fourni, ≥ 0
    if (data.type === "REWARD" && data.unitPrice != null && data.unitPrice !== "") {
      if (Number(data.unitPrice) < 0) {
        ctx.addIssue({
          code: "custom",
          message: "Prix unitaire (valeur marché) ne peut pas être négatif",
          path: ["unitPrice"],
        });
      }
    }
    if (["TRANSFERT_CASH", "TRANSFERT_TITRE"].includes(data.type) && !data.toPlatformId) {
      ctx.addIssue({
        code: "custom",
        message: "Les transferts ne sont pas disponibles dans ce formulaire",
        path: ["type"],
      });
    }
    if (
      ["APPORT", "RETRAIT", "FRAIS", "TRANSFERT_CASH", "DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(
        data.type
      )
    ) {
      if (!data.cashAmount || Number(data.cashAmount) <= 0) {
        if (!["DIVIDENDE", "COUPON", "LOYER"].includes(data.type) || !data.cashAmount) {
          if (!data.cashAmount || Number(data.cashAmount) <= 0) {
            ctx.addIssue({
              code: "custom",
              message: "Montant positif requis",
              path: ["cashAmount"],
            });
          }
        }
      }
    }
  });

export type CreateTransactionForm = z.infer<typeof createTransactionSchema>;

export const platformSchema = z.object({
  name: z.string().min(2, "Nom trop court"),
  type: z.enum(platformTypes),
  /** e.g. "Layer 1" | "Layer 2 / EVM" for blockchains */
  subtype: z.string().optional().nullable(),
  logoKey: z.string().optional().nullable(),
  logoUrl: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v && v.length > 0 ? v : null))
    .refine((v) => v == null || /^https?:\/\//i.test(v), "URL logo invalide"),
  walletAddress: z.string().optional().nullable(),
  notes: z.string().optional(),
});

export type PlatformForm = z.infer<typeof platformSchema>;

export const liabilitySchema = z.object({
  name: z.string().min(2, "Nom requis"),
  initialAmount: decimalString,
  remainingAmount: decimalString,
  currency: z.string().min(3).max(3).default("EUR"),
  interestRate: decimalString.optional(),
  monthlyPayment: decimalString.optional(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  /** Day of month 1–31 for automatic monthly debit */
  paymentDay: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === "" || v == null) return null;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n)) return null;
      return Math.max(1, Math.min(31, n));
    }),
  bankName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type LiabilityForm = z.infer<typeof liabilitySchema>;

export const bankAccountSchema = z.object({
  bankName: z.string().min(1, "Banque requise"),
  balance: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export type BankAccountForm = z.infer<typeof bankAccountSchema>;

export const savingsAccountSchema = z.object({
  name: z.string().min(1, "Nom du livret requis"),
  balance: decimalString.default("0"),
  /** Taux annuel en % (APR ou APY selon rateType) */
  apyPercent: decimalString.default("0"),
  rateType: z.enum(["APR", "APY"]).default("APY"),
  payoutFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).default("DAILY"),
  /** ISO 1=Lundi … 7=Dimanche */
  payoutDayOfWeek: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(1).max(7).nullable().optional()
  ),
  payoutDayOfMonth: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(1).max(31).nullable().optional()
  ),
  payoutMonth: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number().int().min(1).max(12).nullable().optional()
  ),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export type SavingsAccountForm = z.infer<typeof savingsAccountSchema>;

export const lifeInsuranceSchema = z.object({
  insurer: z.string().min(1, "Assureur requis"),
  openDate: z.string().optional().nullable(),
  cashEuro: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export const employeeSavingsPlanTypes = ["PEE", "PER", "PERCO"] as const;
export const employeeSavingsSources = [
  "VOLUNTARY",
  "INTERESTEMENT",
  "PARTICIPATION",
  "ABONDEMENT",
] as const;
export const employeeSavingsUnlockModes = ["DATE", "RETIREMENT"] as const;

export const employeeSavingsLineSchema = z.object({
  planType: z.enum(employeeSavingsPlanTypes),
  manager: z.string().min(1, "Gestionnaire requis"),
  fundName: z.string().min(1, "Nom du fonds requis"),
  isin: z.string().optional().nullable(),
  units: decimalString.default("0"),
  nav: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  sourceType: z.enum(employeeSavingsSources).default("VOLUNTARY"),
  contributionDate: z.string().optional().nullable(),
  unlockDate: z.string().optional().nullable(),
  unlockMode: z.enum(employeeSavingsUnlockModes).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type EmployeeSavingsLineForm = z.infer<typeof employeeSavingsLineSchema>;

export const preciousMetalSchema = z.object({
  assetKind: z.enum(["METAL", "OTHER"]).default("METAL"),
  format: z.enum(["PHYSICAL", "PAPER"]).default("PHYSICAL"),
  denomination: z.string().min(1, "Dénomination requise"),
  quantity: decimalString.default("0"),
  unitWeight: decimalString.default("0"),
  weightUnit: z.enum(["GRAM", "OZ"]).default("GRAM"),
  purchasePriceUnit: decimalString.default("0"),
  currentValue: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  storageLocation: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type PreciousMetalForm = z.infer<typeof preciousMetalSchema>;

export const privateEquitySchema = z.object({
  companyName: z.string().min(1, "Nom de la société requis"),
  sector: z.string().optional().nullable(),
  peType: z.enum(["CROWDEQUITY", "CLUB_DEAL", "DIRECT", "HOLDING"]).default("DIRECT"),
  shares: decimalString.default("0"),
  acquisitionPricePerShare: decimalString.default("0"),
  investmentDate: z.string().optional().nullable(),
  currentNav: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export type PrivateEquityForm = z.infer<typeof privateEquitySchema>;

export const crowdlendingSchema = z.object({
  projectName: z.string().min(1, "Nom du projet requis"),
  platform: z.string().optional().nullable(),
  capitalInvested: decimalString.default("0"),
  annualYieldPercent: decimalString.default("0"),
  durationMonths: z.preprocess(
    (v) => (v === "" || v == null ? 12 : Number(v)),
    z.number().int().min(0).max(600).default(12)
  ),
  repaymentType: z.enum(["IN_FINE", "AMORTIZING"]).default("IN_FINE"),
  startDate: z.string().optional().nullable(),
  maturityDate: z.string().optional().nullable(),
  status: z.enum(["ACTIVE", "LATE", "REPAID", "DEFAULT"]).default("ACTIVE"),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export type CrowdlendingForm = z.infer<typeof crowdlendingSchema>;

export const tangibleAssetSchema = z.object({
  category: z.enum(["WATCHES", "WINE", "ART", "AUTO", "OTHER"]).default("OTHER"),
  brandOrArtist: z.string().min(1, "Marque / artiste requis"),
  modelName: z.string().min(1, "Modèle / nom requis"),
  yearOrVintage: z.string().optional().nullable(),
  purchasePrice: decimalString.default("0"),
  estimatedValue: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  hasCertificate: z.boolean().default(false),
  notes: z.string().optional().nullable(),
});

export type TangibleAssetForm = z.infer<typeof tangibleAssetSchema>;

export type LifeInsuranceForm = z.infer<typeof lifeInsuranceSchema>;

export const lifeProductSchema = z.object({
  lifeInsuranceId: z.string().min(1),
  name: z.string().min(1),
  currentValue: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
  notes: z.string().optional().nullable(),
});

export const envelopeCashSchema = z.object({
  envelope: z.enum(["CTO", "PEA", "AV"]),
  balance: decimalString.default("0"),
  currency: z.string().min(3).max(3).default("EUR"),
});

export const loginSchema = z.object({
  username: z
    .string()
    .min(2, "Identifiant trop court")
    .max(64)
    .transform((v) => v.trim()),
  password: z.string().min(4, "Mot de passe trop court"),
});

export type LoginForm = z.infer<typeof loginSchema>;

export const createUserSchema = z.object({
  username: z
    .string()
    .min(2, "Identifiant trop court")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Caractères autorisés : lettres, chiffres, . _ -")
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
  role: z.enum(["ADMIN", "USER"]).default("USER"),
  name: z.string().optional().nullable(),
});

export type CreateUserForm = z.infer<typeof createUserSchema>;

export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(6, "Mot de passe : 6 caractères minimum"),
});

/** Changement de son propre mot de passe (session active). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Mot de passe actuel requis"),
    newPassword: z.string().min(6, "Nouveau mot de passe : 6 caractères minimum"),
    confirmPassword: z.string().min(1, "Confirmation requise"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "La confirmation ne correspond pas au nouveau mot de passe",
    path: ["confirmPassword"],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: "Le nouveau mot de passe doit être différent de l'actuel",
    path: ["newPassword"],
  });

export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

// ─── Partial update schemas (no .default() — avoids silent overwrites) ───────

/** Decimal that may be cleared on update (null / "" → null). */
const clearableDecimal = z
  .union([z.string(), z.number(), z.null(), z.literal("")])
  .transform((v) => {
    if (v === null || v === "") return null;
    return String(v).trim().replace(",", ".");
  })
  .refine((v) => v === null || !Number.isNaN(Number(v)), "Nombre invalide");

const currencyCode = z
  .string()
  .min(3, "Devise invalide")
  .max(3, "Devise invalide")
  .transform((v) => v.trim().toUpperCase());

const optionalDateString = z
  .union([z.string(), z.null(), z.literal("")])
  .transform((v) => (v === null || v === "" ? null : String(v)));

const optionalClearableInt = (min: number, max: number) =>
  z
    .union([z.string(), z.number(), z.null(), z.literal("")])
    .transform((v) => {
      if (v === null || v === "") return null;
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n)) return null;
      return Math.max(min, Math.min(max, n));
    });

/** PUT /api/liabilities — partial, clearable money/dates. */
export const liabilityUpdateSchema = z.object({
  name: z.string().min(2, "Nom requis").optional(),
  initialAmount: decimalString.optional(),
  remainingAmount: decimalString.optional(),
  currency: currencyCode.optional(),
  interestRate: clearableDecimal.optional(),
  monthlyPayment: clearableDecimal.optional(),
  startDate: optionalDateString.optional(),
  endDate: optionalDateString.optional(),
  paymentDay: optionalClearableInt(1, 31).optional(),
  bankName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type LiabilityUpdateForm = z.infer<typeof liabilityUpdateSchema>;

/** PUT /api/banks */
export const bankAccountUpdateSchema = z.object({
  bankName: z.string().min(1, "Banque requise").optional(),
  balance: decimalString.optional(),
  currency: currencyCode.optional(),
  notes: z.string().optional().nullable(),
});

export type BankAccountUpdateForm = z.infer<typeof bankAccountUpdateSchema>;

/** PUT /api/savings */
export const savingsAccountUpdateSchema = z.object({
  name: z.string().min(1, "Nom du livret requis").optional(),
  balance: decimalString.optional(),
  apyPercent: decimalString.optional(),
  rateType: z.enum(["APR", "APY"]).optional(),
  payoutFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  payoutDayOfWeek: optionalClearableInt(1, 7).optional(),
  payoutDayOfMonth: optionalClearableInt(1, 31).optional(),
  payoutMonth: optionalClearableInt(1, 12).optional(),
  currency: currencyCode.optional(),
  notes: z.string().optional().nullable(),
});

export type SavingsAccountUpdateForm = z.infer<typeof savingsAccountUpdateSchema>;

/** PUT /api/life-insurance (contrat) */
export const lifeInsuranceUpdateSchema = z.object({
  insurer: z.string().min(1, "Assureur requis").optional(),
  openDate: optionalDateString.optional(),
  cashEuro: decimalString.optional(),
  currency: currencyCode.optional(),
  notes: z.string().optional().nullable(),
});

export type LifeInsuranceUpdateForm = z.infer<typeof lifeInsuranceUpdateSchema>;

/** PUT /api/life-insurance kind=product */
export const lifeProductUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  currentValue: decimalString.optional(),
  currency: currencyCode.optional(),
  notes: z.string().optional().nullable(),
});

export type LifeProductUpdateForm = z.infer<typeof lifeProductUpdateSchema>;

/** PUT /api/envelopes */
export const envelopeCashUpdateSchema = z.object({
  envelope: z.enum(["CTO", "PEA", "AV"]),
  balance: decimalString.optional(),
  currency: currencyCode.optional(),
});

export type EnvelopeCashUpdateForm = z.infer<typeof envelopeCashUpdateSchema>;

/** PATCH /api/portfolio — devise de reporting */
export const portfolioBaseCurrencySchema = z.object({
  baseCurrency: currencyCode.default("EUR"),
});

export type PortfolioBaseCurrencyForm = z.infer<typeof portfolioBaseCurrencySchema>;

/** PATCH /api/assets/:id — metadata */
export const updateAssetMetadataSchema = z.object({
  ticker: z
    .union([z.string(), z.null(), z.literal("")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const t = String(v).trim().toUpperCase();
      return t.length ? t : null;
    })
    .refine((v) => v === undefined || v === null || v.length <= 32, "Ticker trop long"),
  name: z
    .string()
    .trim()
    .min(1, "Nom requis")
    .optional(),
  countryCode: z
    .union([z.string(), z.null(), z.literal("")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      const c = String(v).trim().toUpperCase().slice(0, 2);
      return c || null;
    }),
  withholdingTaxRate: z
    .union([z.string(), z.number(), z.null(), z.literal("")])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      if (v === null || v === "") return null;
      let r = Number(String(v).replace(",", "."));
      if (!Number.isFinite(r)) return Number.NaN;
      if (r > 1 && r <= 100) r = r / 100;
      return Math.min(1, Math.max(0, r));
    })
    .refine((v) => v === undefined || v === null || Number.isFinite(v), "Taux WHT invalide"),
});

export type UpdateAssetMetadataForm = z.infer<typeof updateAssetMetadataSchema>;

/** Optional price level: undefined = omit, null/""/0 = clear, number = set. */
const triggerLevel = z
  .union([z.string(), z.number(), z.null(), z.literal("")])
  .transform((v) => {
    if (v === null || v === "") return null;
    const s = String(v).trim().replace(",", ".");
    if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return Number.NaN;
    if (n === 0) return null;
    return s;
  })
  .refine((v) => v === null || !Number.isNaN(Number(v)), "Niveau invalide (nombre ≥ 0 attendu)");

/** PATCH /api/assets/:id/triggers */
export const updateAssetTriggersSchema = z.object({
  stopLoss: triggerLevel.optional(),
  tp1: triggerLevel.optional(),
  tp2: triggerLevel.optional(),
  tp3: triggerLevel.optional(),
  tp4: triggerLevel.optional(),
});

export type UpdateAssetTriggersForm = z.infer<typeof updateAssetTriggersSchema>;

/** PATCH|PUT /api/assets/:id/account-type */
export const updateAccountTypeSchema = z.object({
  accountType: z.enum(accountTypes),
});

export type UpdateAccountTypeForm = z.infer<typeof updateAccountTypeSchema>;
