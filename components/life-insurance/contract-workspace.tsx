"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { PendingBackend, PendingControl } from "@/components/ui/pending-backend";
import { Sparkline } from "@/components/ui/sparkline";
import {
  CONTRACT_SECTIONS,
  type ContractSectionId,
} from "@/app/lib/life-insurance/contract-workspace-sections";
import {
  BUCKET_LABEL,
  bucketOf,
  num,
  upcomingMilestones,
  weightedManagementFeePct,
  type ContractView,
} from "@/app/lib/life-insurance/overview";
import type { ContractSeries } from "@/app/lib/life-insurance/performance-service";
import {
  annualAllowanceEur,
  contractAgeLabel,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  PREMIUMS_PFU_CUTOFF_ISO,
  SOCIAL_CHARGES_RATE,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";
import { supportKindLabel } from "@/app/lib/life-insurance/constants";
import { cn, formatCurrency, formatDate } from "@/app/lib/utils";
import type { TxRow } from "@/app/lib/types/ui";

/**
 * Espace de travail d'un contrat.
 *
 * Même parti pris que pour un actif du portefeuille : un panneau latéral, pas
 * une page. On garde sous les yeux la liste des contrats pendant qu'on examine
 * l'un d'eux, et passer au suivant ne demande pas de revenir en arrière.
 *
 * Les sections sans back-end (bénéficiaires, arbitrages, documents) sont
 * présentes mais annoncées comme telles : le terrain est prêt, rien n'est
 * simulé.
 */

function formatPct(v: number, digits = 2): string {
  return `${v.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function formatSignedCurrency(v: number): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), "EUR")}`;
}

function Row({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-4)] border-b border-[var(--border-subtle)] py-[var(--space-2)] last:border-0">
      <div className="min-w-0">
        <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
          {label}
        </p>
        {hint && <p className="text-meta">{hint}</p>}
      </div>
      <p
        className={cn(
          "num shrink-0 text-[length:var(--text-sm)] font-medium",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-label mb-[var(--space-2)] mt-[var(--space-5)] first:mt-0">
      {children}
    </h3>
  );
}

/* ── Sections ─────────────────────────────────────────────────────── */

function OverviewSection({
  view,
  series,
}: {
  view: ContractView;
  series?: ContractSeries;
}) {
  const fee = weightedManagementFeePct(view.supports);
  const milestones = upcomingMilestones(view.supports);
  const gain = view.unrealizedGainEur;

  return (
    <div data-testid="av-section-overview">
      <SectionTitle>Encours</SectionTitle>
      <Row label="Valeur du contrat" value={formatCurrency(view.valueEur, "EUR")} />
      <Row
        label="Prix de revient"
        value={formatCurrency(view.costBasisEur, "EUR")}
        hint="Somme investie sur les supports, frais d'entrée inclus"
      />
      <Row
        label="Plus-value latente"
        value={formatSignedCurrency(gain)}
        tone={gain >= 0 ? "positive" : "negative"}
      />
      {view.premiumsEur > 0 && (
        <Row
          label="Versements déclarés"
          value={formatCurrency(view.premiumsEur, "EUR")}
          hint="Base de la fiscalité du rachat, distincte du prix de revient"
        />
      )}
      <Row
        label="Part de l'enveloppe"
        value={view.sharePct != null ? formatPct(view.sharePct, 1) : "—"}
      />

      <SectionTitle>Répartition</SectionTitle>
      {view.allocation.length === 0 ? (
        <p className="text-meta">Aucun support saisi sur ce contrat.</p>
      ) : (
        view.allocation.map((a) => (
          <Row
            key={a.bucket}
            label={a.label}
            value={`${formatCurrency(a.valueEur, "EUR")}${
              a.sharePct != null ? ` · ${formatPct(a.sharePct, 0)}` : ""
            }`}
            hint={`${a.supportCount} support${a.supportCount > 1 ? "s" : ""}`}
          />
        ))
      )}

      <SectionTitle>Performance</SectionTitle>
      {series && series.points.length >= 2 ? (
        <>
          <div className="h-[3rem] w-full">
            <Sparkline
              values={series.points.map((p) => p.index)}
              stroke={
                (series.performancePct ?? 0) >= 0
                  ? "var(--chart-positive)"
                  : "var(--chart-negative)"
              }
              fill
              width={480}
              height={48}
              className="h-full w-full"
            />
          </div>
          <Row
            label="Sur la période affichée"
            value={
              series.performancePct != null
                ? `${series.performancePct >= 0 ? "+" : "−"}${formatPct(Math.abs(series.performancePct))}`
                : "—"
            }
            tone={(series.performancePct ?? 0) >= 0 ? "positive" : "negative"}
            hint="Pondérée par le temps : les versements n'y comptent pas"
          />
        </>
      ) : (
        <p className="text-meta">
          Aucun support de ce contrat n&apos;a d&apos;historique de cours ; sa
          performance ne peut pas être mesurée.
        </p>
      )}

      <SectionTitle>Repères</SectionTitle>
      <Row
        label="Frais de gestion moyens"
        value={fee != null ? formatPct(fee) : "—"}
        hint={
          fee == null
            ? "Aucun support ne renseigne son taux"
            : "Pondérés par l'encours de chaque support"
        }
      />
      <Row
        label="Ouverture"
        value={
          view.policy.openDate ? formatDate(view.policy.openDate) : "—"
        }
        hint={
          view.policy.openDate ? contractAgeLabel(view.policy.openDate) : undefined
        }
      />
      {milestones.length > 0 && (
        <>
          <SectionTitle>Prochaines échéances</SectionTitle>
          {milestones.map((m) => (
            <Row
              key={`${m.supportName}-${m.kind}-${m.dateIso}`}
              label={`${m.label} — ${m.supportName}`}
              value={formatDate(m.dateIso)}
              hint={`dans ${m.daysAway} jour${m.daysAway > 1 ? "s" : ""}`}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SupportsSection({ view }: { view: ContractView }) {
  if (view.supports.length === 0) {
    return (
      <p className="text-meta" data-testid="av-section-supports">
        Aucun support rattaché. Un support entre par le journal, comme toute
        position — il porte alors un prix de revient et une plus-value.
      </p>
    );
  }
  return (
    <div data-testid="av-section-supports">
      <table className="w-full text-[length:var(--text-sm)]">
        <thead>
          <tr className="text-label border-b border-[var(--border)]">
            <th className="py-[var(--space-2)] text-left font-medium">Support</th>
            <th className="py-[var(--space-2)] text-right font-medium">Valeur</th>
            <th className="py-[var(--space-2)] text-right font-medium">+/− value</th>
          </tr>
        </thead>
        <tbody>
          {view.supports.map((s) => {
            const pnl = num(s.unrealizedPnlEur);
            return (
              <tr
                key={s.assetId}
                className="border-b border-[var(--border-subtle)] last:border-0"
                data-testid="av-support-line"
              >
                <td className="min-w-0 py-[var(--space-2)]">
                  <div className="truncate text-[var(--foreground)]" title={s.name}>
                    {s.name}
                  </div>
                  <div className="text-meta">
                    {supportKindLabel(s.kind)} ·{" "}
                    {BUCKET_LABEL[bucketOf(s.kind)]}
                  </div>
                </td>
                <td className="num py-[var(--space-2)] text-right">
                  {formatCurrency(num(s.currentValueEur), "EUR")}
                </td>
                <td
                  className={cn(
                    "num py-[var(--space-2)] text-right",
                    pnl >= 0 ? "val-positive" : "val-negative"
                  )}
                >
                  {formatSignedCurrency(pnl)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistorySection({
  transactions,
  loading,
}: {
  transactions: TxRow[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <p className="text-meta" data-testid="av-section-history">
        Chargement du journal…
      </p>
    );
  }
  if (transactions.length === 0) {
    return (
      <p className="text-meta" data-testid="av-section-history">
        Aucune opération enregistrée sur les supports de ce contrat.
      </p>
    );
  }
  return (
    <ul className="min-w-0" data-testid="av-section-history">
      {transactions.map((t) => (
        <li
          key={t.id}
          className="flex items-baseline justify-between gap-[var(--space-3)] border-b border-[var(--border-subtle)] py-[var(--space-2)] last:border-0"
        >
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] text-[var(--foreground)]">
              {t.type} — {t.asset?.name ?? "—"}
            </p>
            <p className="text-meta num">{formatDate(t.occurredAt)}</p>
          </div>
          <p className="num shrink-0 text-[length:var(--text-sm)]">
            {formatCurrency(Number(t.grossAmountEur ?? 0), "EUR")}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FeesSection({ view }: { view: ContractView }) {
  const weighted = weightedManagementFeePct(view.supports);
  const documented = view.supports.filter(
    (s) => s.managementFeePct != null || s.entryFeePct != null
  );

  return (
    <div data-testid="av-section-fees">
      <Row
        label="Frais de gestion moyens"
        value={weighted != null ? formatPct(weighted) : "—"}
        hint="Moyenne pondérée par l'encours — un taux sur 2 % de l'épargne ne pèse pas comme un taux sur 90 %"
      />
      {weighted != null && view.valueEur > 0 && (
        <Row
          label="Coût annuel correspondant"
          value={formatCurrency((view.valueEur * weighted) / 100, "EUR")}
          hint="À encours constant, sur douze mois"
        />
      )}

      <SectionTitle>Par support</SectionTitle>
      {documented.length === 0 ? (
        <p className="text-meta">
          Aucun support ne renseigne ses frais. Ils se saisissent à la création
          d&apos;un support, ou plus tard sur sa fiche.
        </p>
      ) : (
        documented.map((s) => (
          <Row
            key={s.assetId}
            label={s.name}
            value={[
              s.entryFeePct != null
                ? `entrée ${formatPct(num(s.entryFeePct))}`
                : null,
              s.managementFeePct != null
                ? `gestion ${formatPct(num(s.managementFeePct))}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))
      )}
    </div>
  );
}

function TaxSection({
  view,
  taxHousehold,
  totalPremiumsEur,
}: {
  view: ContractView;
  taxHousehold: TaxHousehold;
  /** Primes tous contrats — c'est sur elles que porte le seuil de 150 000 €. */
  totalPremiumsEur: number;
}) {
  const allowance = annualAllowanceEur(taxHousehold);
  const overThreshold = totalPremiumsEur > PFU_OUTSTANDING_THRESHOLD_EUR;

  return (
    <div data-testid="av-section-tax">
      <Row
        label="Antériorité fiscale"
        value={
          view.isMature == null
            ? "—"
            : view.isMature
              ? "Acquise (plus de 8 ans)"
              : "Non acquise"
        }
        hint={
          view.policy.openDate
            ? contractAgeLabel(view.policy.openDate)
            : "Date d'ouverture non renseignée : l'antériorité ne peut pas être établie"
        }
      />
      <Row
        label="Abattement annuel sur les gains"
        value={
          view.isMature === true ? formatCurrency(allowance, "EUR") : "—"
        }
        hint={
          view.isMature === true
            ? taxHousehold === "COUPLE"
              ? "Couple soumis à imposition commune"
              : "Personne seule"
            : "Ouvert au-delà de huit ans de détention"
        }
      />
      <Row
        label="Prélèvements sociaux"
        value={formatPct(SOCIAL_CHARGES_RATE * 100, 1)}
        hint="Dus sur les gains quelle que soit l'antériorité — un contrat mûr n'est jamais « exonéré »"
      />
      <Row
        label="Seuil des versements"
        value={formatCurrency(PFU_OUTSTANDING_THRESHOLD_EUR, "EUR")}
        hint={
          overThreshold
            ? "Dépassé, tous contrats confondus : le taux réduit ne s'applique plus au-delà"
            : "Apprécié sur les versements de tous vos contrats, jamais sur l'encours"
        }
      />
      <Row
        label="Versements avant le 27/09/2017"
        value={formatCurrency(num(view.policy.premiumsBefore2017Eur), "EUR")}
        hint={`Régime antérieur à la réforme du ${PREMIUMS_PFU_CUTOFF_ISO.split("-").reverse().join("/")}`}
      />
      <Row
        label="Versements depuis le 27/09/2017"
        value={formatCurrency(num(view.policy.premiumsAfter2017Eur), "EUR")}
        hint="Régime du prélèvement forfaitaire unique"
      />

      <p className="text-meta mt-[var(--space-4)]">
        Le montant réellement dû en cas de rachat dépend de la quote-part de
        gains retirée : il se calcule dans le simulateur de rachat, sous la
        gestion des contrats.
      </p>
    </div>
  );
}

/* ── Panneau ──────────────────────────────────────────────────────── */

export function ContractWorkspace({
  view,
  series,
  transactions,
  transactionsLoading,
  taxHousehold,
  totalPremiumsEur,
  onClose,
}: {
  view: ContractView | null;
  series?: ContractSeries;
  transactions: TxRow[];
  transactionsLoading: boolean;
  taxHousehold: TaxHousehold;
  totalPremiumsEur: number;
  onClose: () => void;
}) {
  const [section, setSection] = useState<ContractSectionId>("overview");
  const panelRef = useRef<HTMLDivElement>(null);

  // Changer de contrat remet la vue d'ensemble : rester sur « Documents »
  // parce que c'est là qu'on avait laissé le précédent n'aide personne.
  const contractId = view?.policy.id ?? "";
  const [seenContract, setSeenContract] = useState(contractId);
  if (contractId !== seenContract) {
    setSeenContract(contractId);
    setSection("overview");
  }

  useEffect(() => {
    if (!view) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, onClose]);

  useEffect(() => {
    if (view) panelRef.current?.focus();
  }, [view]);

  if (!view) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-testid="av-contract-workspace"
    >
      <button
        type="button"
        aria-label="Fermer le panneau du contrat"
        className="absolute inset-0 bg-[var(--overlay)]"
        onClick={onClose}
        data-testid="av-workspace-scrim"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Contrat — ${view.title}`}
        className="workspace-panel"
        data-testid="av-workspace-panel"
      >
        <header className="workspace-head">
          <div className="flex min-w-0 items-start gap-[var(--space-3)]">
            <PlatformLogo name={view.title} size={40} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[length:var(--text-lg)] font-semibold text-[var(--foreground)]">
                {view.title}
              </h2>
              <p className="text-meta truncate">
                {view.contractType}
                {view.policy.openDate
                  ? ` · ouvert le ${formatDate(view.policy.openDate)}`
                  : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              onClick={onClose}
              aria-label="Fermer"
              data-testid="av-workspace-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-[var(--space-3)] flex flex-wrap items-baseline gap-x-[var(--space-5)] gap-y-[var(--space-1)]">
            <div>
              <div className="text-label">Valeur</div>
              <div className="num text-[length:var(--text-2xl)] font-semibold text-[var(--foreground)]">
                {formatCurrency(view.valueEur, "EUR")}
              </div>
            </div>
            <div>
              <div className="text-label">Plus-value latente</div>
              <div
                className={cn(
                  "num text-[length:var(--text-lg)] font-medium",
                  view.unrealizedGainEur >= 0 ? "val-positive" : "val-negative"
                )}
              >
                {formatSignedCurrency(view.unrealizedGainEur)}
              </div>
            </div>
          </div>
        </header>

        <nav
          className="workspace-tabs"
          role="tablist"
          aria-label="Sections du contrat"
          data-testid="av-workspace-tabs"
        >
          {CONTRACT_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={section === s.id}
              className="workspace-tab"
              data-active={section === s.id ? "true" : "false"}
              data-backing={s.backing}
              title={s.hint}
              data-testid={`av-workspace-tab-${s.id}`}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="workspace-body">
          {section === "overview" && (
            <OverviewSection view={view} series={series} />
          )}
          {section === "supports" && <SupportsSection view={view} />}
          {section === "history" && (
            <HistorySection
              transactions={transactions}
              loading={transactionsLoading}
            />
          )}
          {section === "fees" && <FeesSection view={view} />}
          {section === "tax" && (
            <TaxSection
              view={view}
              taxHousehold={taxHousehold}
              totalPremiumsEur={totalPremiumsEur}
            />
          )}

          {section === "beneficiaries" && (
            <PendingBackend
              testId="av-section-beneficiaries"
              title="Clause bénéficiaire"
              what="Nommer les bénéficiaires, répartir les capitaux entre eux, et voir à quel abattement chacun ouvre droit selon son lien de parenté et l'âge des versements."
              missing="Aucun modèle de bénéficiaire n'existe encore côté serveur : ni personne, ni quote-part, ni rang de dévolution. Inventer une clause serait dangereux — c'est le document qui décide de qui touche quoi."
            >
              <div className="space-y-[var(--space-2)]">
                <PendingControl
                  label="Ajouter un bénéficiaire"
                  hint="Nom, lien de parenté, quote-part"
                />
                <PendingControl
                  label="Clause type ou clause libre"
                  hint="« Mon conjoint, à défaut mes enfants, à défaut mes héritiers »"
                />
              </div>
            </PendingBackend>
          )}

          {section === "arbitrages" && (
            <PendingBackend
              testId="av-section-arbitrages"
              title="Arbitrages"
              what="Réallouer l'épargne d'un support vers un autre, ponctuellement ou par un plan récurrent, et suivre l'écart entre l'allocation cible et l'allocation réelle."
              missing="Un arbitrage se traduirait aujourd'hui par deux transactions au journal, sans lien entre elles : le modèle n'a ni opération d'arbitrage, ni allocation cible, ni programmation."
            >
              <div className="space-y-[var(--space-2)]">
                <PendingControl
                  label="Arbitrer maintenant"
                  hint="Du support A vers le support B, en montant ou en pourcentage"
                />
                <PendingControl
                  label="Programmer un versement"
                  hint="Montant, périodicité, répartition entre supports"
                />
              </div>
            </PendingBackend>
          )}

          {section === "documents" && (
            <PendingBackend
              testId="av-section-documents"
              title="Documents"
              what="Conserver les conditions générales, les relevés annuels et les avenants du contrat, et les retrouver depuis la fiche plutôt que dans une boîte mail."
              missing="Il n'y a ni stockage de fichiers ni modèle de document dans l'application. Afficher une liste vide de « documents disponibles » laisserait croire qu'il en manque, alors qu'aucun n'a jamais pu être déposé."
            >
              <PendingControl
                label="Déposer un document"
                hint="PDF du relevé annuel, conditions générales, avenant"
              />
            </PendingBackend>
          )}
        </div>
      </div>
    </div>
  );
}
