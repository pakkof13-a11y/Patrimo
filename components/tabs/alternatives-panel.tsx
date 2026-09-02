"use client";

/**
 * Colonne de détail d'un investissement alternatif.
 *
 * Un seul panneau, quatre contenus. Le cadre — géométrie `.asset-panel`,
 * en-tête, onglets, fermeture, défilement, responsive — est partagé avec le
 * Portefeuille, les Banques, l'Assurance-vie, l'Immobilier et l'Épargne
 * salariale. Ce qu'il contient, en revanche, est propre à chaque métier :
 * un lingot n'a ni TVPI ni échéance, un prêt n'a ni pureté ni prime.
 *
 * C'est le compromis que la poche alternative impose. Uniformiser les
 * indicateurs les viderait de sens ; dupliquer quatre panneaux les ferait
 * diverger. On partage donc la coquille et on spécialise le corps.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  CATEGORY_LABEL,
  type AlternativeInvestment,
} from "@/app/lib/alternatives/consolidated";

/** Onglets par famille — seuls ceux qui ont un contenu réel sont proposés. */
const SECTIONS_BY_CATEGORY: Record<
  AlternativeInvestment["category"],
  Array<{ id: string; label: string }>
> = {
  METAL: [
    { id: "summary", label: "Résumé" },
    { id: "details", label: "Détails" },
  ],
  PRIVATE_EQUITY: [
    { id: "summary", label: "Résumé" },
    { id: "capital", label: "Capital" },
  ],
  CROWDLENDING: [
    { id: "summary", label: "Résumé" },
    { id: "flows", label: "Flux" },
  ],
  TANGIBLE: [
    { id: "summary", label: "Résumé" },
    { id: "details", label: "Détails" },
  ],
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

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        maximumFractionDigits: digits,
      })} %`;

/**
 * Ce que la ligne consolidée ne porte pas — les champs propres au métier — est
 * passé tel quel par l'écran, qui dispose de la DTO complète. Le panneau ne
 * refait aucun calcul : il choisit ce qu'il montre.
 */
export type AlternativeExtra = Record<string, React.ReactNode>;

export function AlternativeDetailPanel({
  investment,
  extra,
  onClose,
  className,
}: {
  investment: AlternativeInvestment | null;
  /**
   * Champs métier supplémentaires, par section. L'écran les fournit depuis la
   * DTO d'origine : pureté et stockage pour un métal, TVPI et distributions
   * pour du PE, échéance et taux pour un prêt.
   */
  extra?: Record<string, AlternativeExtra>;
  onClose: () => void;
  className?: string;
}) {
  const [section, setSection] = useState("summary");

  // Changer d'investissement ramène au résumé : la section ouverte peut ne pas
  // exister sur le suivant, les onglets différant d'une famille à l'autre.
  const id = investment ? `${investment.category}:${investment.id}` : null;
  const [seenId, setSeenId] = useState(id);
  if (id !== seenId) {
    setSeenId(id);
    setSection("summary");
  }

  if (!investment) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="alt-detail-panel"
        data-open="false"
        aria-label="Détail de l'investissement"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun investissement sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une ligne pour afficher son détail ici. La liste reste en
            place.
          </p>
        </div>
      </aside>
    );
  }

  const sections = SECTIONS_BY_CATEGORY[investment.category];
  const extraForSection = extra?.[section];

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="alt-detail-panel"
      data-open="true"
      aria-label={`Investissement — ${investment.name}`}
    >
      <div className="asset-panel-bar">
        <div className="min-w-0">
          <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            {investment.name}
          </p>
          <p className="text-meta truncate">
            {CATEGORY_LABEL[investment.category]}
            {investment.platform ? ` · ${investment.platform}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="alt-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav
        className="workspace-tabs"
        role="tablist"
        aria-label="Sections de l'investissement"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="workspace-tab"
            data-active={section === s.id ? "true" : "false"}
            data-testid={`alt-panel-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        <p
          className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]"
          data-testid="alt-panel-value"
        >
          {formatCurrency(String(investment.valueEur), investment.currency)}
        </p>
        <p
          className={cn(
            "num text-[length:var(--text-xs)] font-medium",
            investment.pnlEur != null && investment.pnlEur >= 0 && "val-positive",
            investment.pnlEur != null && investment.pnlEur < 0 && "val-negative",
            investment.pnlEur == null && "text-[var(--foreground-faint)]"
          )}
        >
          {investment.pnlEur != null
            ? `${investment.pnlEur >= 0 ? "+" : "−"}${formatCurrency(
                String(Math.abs(investment.pnlEur)),
                investment.currency
              )} · ${pctLabel(investment.pnlPct)}`
            : "Résultat non mesurable"}
        </p>

        {section === "summary" && (
          <>
            <SectionTitle>Résumé</SectionTitle>
            <Block>
              <Fact
                label="Valeur actuelle"
                value={formatCurrency(
                  String(investment.valueEur),
                  investment.currency
                )}
              />
              <Fact
                label={
                  investment.category === "CROWDLENDING"
                    ? "Capital prêté"
                    : investment.category === "PRIVATE_EQUITY"
                      ? "Capital appelé"
                      : "Prix de revient"
                }
                value={formatCurrency(
                  String(investment.investedEur),
                  investment.currency
                )}
              />
              <Fact
                label="Résultat"
                value={
                  investment.pnlEur != null
                    ? formatCurrency(
                        String(investment.pnlEur),
                        investment.currency
                      )
                    : "—"
                }
                tone={
                  investment.pnlEur == null
                    ? "muted"
                    : investment.pnlEur >= 0
                      ? "positive"
                      : "negative"
                }
              />
              <Fact label="Catégorie" value={CATEGORY_LABEL[investment.category]} />
              <Fact
                label="Statut"
                value={investment.status}
                tone={investment.statusIsAlert ? "negative" : undefined}
              />
              <Fact label="Devise" value={investment.currency} />
            </Block>
          </>
        )}

        {/*
          Champs propres au métier. Ils viennent de l'écran, qui dispose de la
          DTO complète — le panneau ne connaît que la ligne consolidée, et ne
          doit surtout pas re-deviner ce qu'il ne sait pas.
        */}
        {extraForSection && Object.keys(extraForSection).length > 0 ? (
          <>
            <SectionTitle>
              {section === "summary" ? "Détail" : sections.find((s) => s.id === section)?.label}
            </SectionTitle>
            <Block>
              {Object.entries(extraForSection).map(([label, value]) => (
                <Fact key={label} label={label} value={value} />
              ))}
            </Block>
          </>
        ) : section !== "summary" ? (
          <p className="text-meta mt-[var(--space-4)]">
            Aucune donnée complémentaire enregistrée sur cette ligne.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
