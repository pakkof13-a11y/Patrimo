"use client";

/**
 * Colonne de détail de la ligne fiscale sélectionnée.
 *
 * Même géométrie que les panneaux des autres modules (`.asset-panel`) : la
 * table reste en place, aucune modale.
 *
 * Le contenu s'adapte à la **nature** de la ligne, parce que les quatre
 * régimes n'ont rien de comparable : une enveloppe titres a des ventes et des
 * dividendes, l'IFI a une assiette et des dettes déductibles, un régime
 * locatif s'arbitre entre plusieurs options, un dispositif de réduction a une
 * durée. Afficher partout les mêmes lignes en laissant les trois quarts vides
 * ferait de la fiche un formulaire à trous.
 *
 * Rien n'y est recalculé : chaque montant vient du moteur qui l'a produit.
 */

import { X } from "lucide-react";
import { formatCurrency, cn } from "@/app/lib/utils";
import { REGIME_LABELS, type FiscalLine } from "@/app/lib/tax/overview";
import {
  DEFAULT_MARGINAL_RATE_PCT,
  marginalRateNotice,
  type MarginalRateSource,
} from "@/app/lib/tax/marginal-rate";
import type {
  FiscalEnvelopeBucket,
  FiscalYearReport,
} from "@/app/lib/tax/fiscal-year";
import type { RealEstateTaxBundlePayload } from "@/app/lib/real-estate/tax/payload";
import { StatusTag } from "./fiscal-line-list";

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function Fact({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "negative" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]">
      <dt className="text-label">{label}</dt>
      <dd
        className={cn(
          "num shrink-0 text-right text-[length:var(--text-xs)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          tone === "muted" && "text-[var(--foreground-faint)]",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-label mb-[var(--space-1)] mt-[var(--space-4)] first:mt-0">
      {children}
    </h3>
  );
}

function Block({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
      {children}
    </dl>
  );
}

function EnvelopeDetail({
  bucket,
  currency,
}: {
  bucket: FiscalEnvelopeBucket;
  currency: string;
}) {
  return (
    <>
      <SectionTitle>Opérations de l&apos;année</SectionTitle>
      <Block>
        <Fact
          label="Plus-value réalisée"
          value={formatCurrency(String(bucket.realizedPnlEur), currency)}
          tone={bucket.realizedPnlEur >= 0 ? "positive" : "negative"}
        />
        <Fact label="Ventes" value={bucket.sellCount || "—"} />
        <Fact
          label="Dividendes bruts"
          value={formatCurrency(String(bucket.dividendsGrossEur), currency)}
        />
        <Fact
          label="Dividendes nets"
          value={formatCurrency(String(bucket.dividendsNetEur), currency)}
          tone="positive"
        />
        <Fact
          label="Retenue à la source"
          value={formatCurrency(String(bucket.withholdingTaxEur), currency)}
          tone={bucket.withholdingTaxEur > 0 ? "negative" : "muted"}
        />
        <Fact label="Revenus encaissés" value={bucket.incomeCount || "—"} />
      </Block>
      {bucket.withholdingTaxEur > 0 ? (
        <p className="text-meta mt-[var(--space-3)]">
          La retenue étrangère est déjà prélevée. Un crédit d&apos;impôt
          éventuel dépend de la convention applicable et n&apos;est pas calculé
          ici.
        </p>
      ) : null}
    </>
  );
}

function IfiDetail({
  ifi,
  currency,
}: {
  ifi: RealEstateTaxBundlePayload["ifi"];
  currency: string;
}) {
  return (
    <>
      <SectionTitle>Assiette</SectionTitle>
      <Block>
        <Fact
          label="Valeur taxable brute"
          value={formatCurrency(ifi.grossTaxableEur, currency)}
        />
        <Fact
          label="Dettes déductibles"
          value={formatCurrency(`-${ifi.totalDeductibleDebtEur}`, currency)}
          tone="positive"
        />
        <Fact
          label="Assiette nette"
          value={formatCurrency(ifi.netTaxableEur, currency)}
        />
      </Block>

      <SectionTitle>Imposition</SectionTitle>
      <Block>
        <Fact
          label="Impôt au barème"
          value={formatCurrency(ifi.grossTaxEur, currency)}
        />
        <Fact
          label="Décote"
          value={
            num(ifi.discountEur) > 0
              ? formatCurrency(`-${ifi.discountEur}`, currency)
              : "—"
          }
          tone={num(ifi.discountEur) > 0 ? "positive" : "muted"}
        />
        <Fact
          label="Impôt dû"
          value={ifi.liable ? formatCurrency(ifi.taxEur, currency) : "Aucun"}
          tone={ifi.liable ? "negative" : "muted"}
        />
        <Fact
          label="Taux moyen"
          value={
            ifi.liable
              ? `${Number(ifi.effectiveRatePct).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`
              : "—"
          }
          tone={ifi.liable ? undefined : "muted"}
        />
      </Block>

      <SectionTitle>Biens retenus</SectionTitle>
      <Block>
        {ifi.lines.map((l) => (
          <Fact
            key={l.id}
            label={l.excluded ? `${l.label} (exclu)` : l.label}
            value={formatCurrency(l.netValueEur, currency)}
            tone={l.excluded ? "muted" : undefined}
          />
        ))}
      </Block>
    </>
  );
}

function RentalDetail({
  section,
  marginalTaxRatePct,
  marginalTaxRateSource,
  currency,
}: {
  section: RealEstateTaxBundlePayload["rental"]["bare"];
  marginalTaxRatePct: number;
  marginalTaxRateSource: MarginalRateSource;
  currency: string;
}) {
  return (
    <>
      <SectionTitle>Revenus</SectionTitle>
      <Block>
        <Fact
          label="Loyers bruts"
          value={formatCurrency(section.grossRentEur, currency)}
        />
        <Fact
          label="Charges déductibles"
          value={formatCurrency(section.deductibleChargesEur, currency)}
        />
      </Block>

      {/*
        L'arbitrage est la vraie information : deux régimes, deux impôts, et
        l'écart entre les deux. Le montrer sous forme de comparaison plutôt
        que d'annoncer un seul chiffre laisse la décision à l'utilisateur.
      */}
      <SectionTitle>Comparaison des régimes</SectionTitle>
      <Block>
        {section.outcomes.map((o) => (
          <Fact
            key={o.regime}
            label={`${REGIME_LABELS[o.regime] ?? o.regime}${
              o.regime === section.bestRegime ? " · retenu" : ""
            }${o.eligible ? "" : " · inéligible"}`}
            value={
              o.eligible ? formatCurrency(o.totalTaxEur, currency) : "—"
            }
            tone={
              !o.eligible
                ? "muted"
                : o.regime === section.bestRegime
                  ? "positive"
                  : undefined
            }
          />
        ))}
      </Block>

      {section.outcomes.some((o) => !o.eligible) ? (
        <p className="text-meta mt-[var(--space-2)]">
          {section.outcomes
            .filter((o) => !o.eligible && o.ineligibilityReason)
            .map((o) => o.ineligibilityReason)
            .join(" · ")}
        </p>
      ) : null}

      {/*
        Le texte change selon la source : un taux déclaré engage l'utilisateur,
        un défaut n'engage personne. Les présenter identiquement donnerait au
        second la crédibilité du premier.
      */}
      <p className="text-meta mt-[var(--space-3)]" data-testid="fiscal-tmi-notice">
        {marginalRateNotice({
          pct: marginalTaxRatePct,
          source: marginalTaxRateSource,
        })}{" "}
        Aurea ne la déduit pas de vos revenus : elle supposerait de connaître
        vos salaires et votre foyer fiscal.
      </p>
    </>
  );
}

function SchemeDetail({
  row,
  currency,
}: {
  row: RealEstateTaxBundlePayload["schemes"]["rows"][number];
  currency: string;
}) {
  return (
    <>
      <SectionTitle>Dispositif</SectionTitle>
      <Block>
        <Fact
          label="Base éligible"
          value={formatCurrency(row.eligibleBaseEur, currency)}
        />
        <Fact
          label="Réduction totale"
          value={formatCurrency(row.totalReductionEur, currency)}
          tone="positive"
        />
        <Fact
          label="Réduction annuelle"
          value={
            row.finished ? "Terminée" : formatCurrency(row.annualReductionEur, currency)
          }
          tone={row.finished ? "muted" : "positive"}
        />
        <Fact label="Années écoulées" value={row.yearsElapsed} />
        <Fact
          label="Années restantes"
          value={row.finished ? "—" : row.yearsRemaining}
          tone={row.finished ? "muted" : undefined}
        />
        <Fact
          label="Plafonnement global"
          value={row.subjectToGlobalCap ? "Soumis" : "Hors plafond"}
        />
      </Block>
      {row.note ? (
        <p className="text-meta mt-[var(--space-3)]">{row.note}</p>
      ) : null}
    </>
  );
}

export function FiscalPanel({
  line,
  report,
  realEstate,
  currency,
  onClose,
  className,
}: {
  line: FiscalLine | null;
  report: FiscalYearReport | null;
  realEstate: RealEstateTaxBundlePayload | null;
  currency: string;
  onClose: () => void;
  className?: string;
}) {
  if (!line) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="fiscal-panel"
        data-open="false"
        aria-label="Détail de la ligne fiscale"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucune ligne sélectionnée
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une source d&apos;imposition pour voir d&apos;où elle vient
            et comment elle se calcule. La table reste en place.
          </p>
        </div>
      </aside>
    );
  }

  const bucket =
    line.kind === "ENVELOPE"
      ? (report?.byEnvelope.find(
          (b) => `envelope:${b.accountType}` === line.id
        ) ?? null)
      : null;

  const rentalSection =
    line.kind === "RENTAL" && realEstate
      ? line.id === "rental:bare"
        ? realEstate.rental.bare
        : realEstate.rental.furnished
      : null;

  const schemeRow =
    line.kind === "SCHEME" && realEstate
      ? (realEstate.schemes.rows.find(
          (r) => `scheme:${r.assetId}:${r.scheme}` === line.id
        ) ?? null)
      : null;

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="fiscal-panel"
      data-open="true"
      aria-label={`Ligne fiscale — ${line.label}`}
    >
      <div className="asset-panel-bar">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {line.label}
          </p>
          <p className="text-meta flex min-w-0 items-center truncate">
            {line.regimeLabel}
            <StatusTag status={line.status} />
          </p>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="fiscal-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="asset-panel-body">
        {/*
          Le montant en tête est l'impôt quand il existe. Quand il n'existe
          pas, on écrit pourquoi plutôt qu'un zéro : c'est la différence entre
          « rien à payer » et « nous ne savons pas ».
        */}
        {line.taxEur != null ? (
          <>
            <p
              className={cn(
                "num text-[length:var(--text-2xl)] font-semibold tracking-tight",
                line.taxEur < 0 ? "val-positive" : "text-[var(--foreground)]"
              )}
              data-testid="fiscal-panel-amount"
            >
              {formatCurrency(String(line.taxEur), currency)}
            </p>
            <p className="text-meta">
              {line.taxEur < 0 ? "Réduction d'impôt annuelle" : "Impôt estimé"}
              {line.baseEur != null ? (
                <>
                  <span className="mx-1 opacity-40">·</span>
                  assiette {formatCurrency(String(line.baseEur), currency)}
                </>
              ) : null}
            </p>
          </>
        ) : (
          <p
            className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]"
            data-testid="fiscal-panel-amount"
          >
            {line.status === "NOT_APPLICABLE"
              ? "Aucun impôt estimé pour ce régime"
              : "Montant non disponible"}
          </p>
        )}

        {line.caveat ? (
          <p
            className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]"
            data-testid="fiscal-panel-caveat"
          >
            {line.caveat}
          </p>
        ) : null}

        {bucket ? <EnvelopeDetail bucket={bucket} currency={currency} /> : null}
        {line.kind === "IFI" && realEstate ? (
          <IfiDetail ifi={realEstate.ifi} currency={currency} />
        ) : null}
        {rentalSection ? (
          <RentalDetail
            section={rentalSection}
            marginalTaxRatePct={realEstate?.marginalTaxRatePct ?? DEFAULT_MARGINAL_RATE_PCT}
            marginalTaxRateSource={realEstate?.marginalTaxRateSource ?? "DEFAULT"}
            currency={currency}
          />
        ) : null}
        {schemeRow ? <SchemeDetail row={schemeRow} currency={currency} /> : null}
      </div>
    </aside>
  );
}
