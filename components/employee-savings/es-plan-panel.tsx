"use client";

/**
 * Colonne de détail du plan sélectionné.
 *
 * Même géométrie que le panneau d'actif du Portefeuille, des Banques, de
 * l'Assurance-vie et de l'Immobilier (`.asset-panel`) : ancrée en grand écran,
 * superposée en tablette, plein écran en mobile.
 *
 * Ce qu'il porte vient de `PlanView`, déjà calculé côté métier. Le panneau ne
 * refait aucun total — il choisit ce qu'il montre, et dans quel ordre.
 */

import { useState } from "react";
import { X } from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCurrency, cn } from "@/app/lib/utils";
import { num, type PlanView } from "@/app/lib/employee-savings/overview";
import { FUND_CATEGORY_TONE } from "@/components/employee-savings/es-allocation-card";

const SECTIONS = [
  { id: "summary", label: "Résumé" },
  { id: "allocation", label: "Allocation" },
  { id: "supports", label: "Supports" },
  { id: "contributions", label: "Versements" },
  { id: "liquidity", label: "Disponibilité" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const pctLabel = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("fr-FR", {
        maximumFractionDigits: digits,
      })} %`;

const dateFr = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

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

/**
 * Barre disponible / bloqué.
 *
 * Une seule barre segmentée, jamais deux jauges indépendantes : ce sont les
 * deux parts d'un même encours, et les montrer séparément laisse croire à deux
 * grandeurs sans rapport.
 */
export function LiquidityBar({
  availableValue,
  blockedValue,
  className,
}: {
  availableValue: number;
  blockedValue: number;
  className?: string;
}) {
  const total = availableValue + blockedValue;
  const availablePct = total > 0 ? (availableValue / total) * 100 : 0;

  return (
    <div className={className} data-testid="es-liquidity-bar">
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
        role="img"
        aria-label={`Disponible ${Math.round(availablePct)} %, bloqué ${Math.round(100 - availablePct)} %`}
      >
        <span
          style={{ width: `${availablePct}%`, background: "var(--success)" }}
        />
        <span
          style={{
            width: `${100 - availablePct}%`,
            background: "var(--foreground-faint)",
          }}
        />
      </div>
      <div className="mt-[var(--space-2)] grid gap-[var(--space-1)] sm:grid-cols-2">
        <p className="flex items-baseline justify-between gap-[var(--space-2)] text-[length:var(--text-xs)]">
          <span className="text-[var(--foreground-secondary)]">Disponible</span>
          <span className="num val-positive font-medium">
            {formatCurrency(String(availableValue), "EUR")}
          </span>
        </p>
        <p className="flex items-baseline justify-between gap-[var(--space-2)] text-[length:var(--text-xs)]">
          <span className="text-[var(--foreground-secondary)]">Bloqué</span>
          <span className="num font-medium text-[var(--foreground)]">
            {formatCurrency(String(blockedValue), "EUR")}
          </span>
        </p>
      </div>
    </div>
  );
}

export function EsPlanPanel({
  plan,
  onClose,
  onManage,
  className,
}: {
  plan: PlanView | null;
  onClose: () => void;
  /** Ouvre l'espace de gestion — saisie, import CSV, dates de déblocage. */
  onManage: (target?: string) => void;
  className?: string;
}) {
  const [section, setSection] = useState<SectionId>("summary");

  // Changer de plan ramène au résumé : rester sur « Versements » parce que
  // c'est là qu'on avait laissé le précédent n'aide personne.
  const planKey = plan?.key ?? null;
  const [seenKey, setSeenKey] = useState(planKey);
  if (planKey !== seenKey) {
    setSeenKey(planKey);
    setSection("summary");
  }

  if (!plan) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="es-plan-panel"
        data-open="false"
        aria-label="Détail du plan"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucun plan sélectionné
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez un plan pour afficher son détail ici. La liste reste en
            place.
          </p>
        </div>
      </aside>
    );
  }

  const totalUnits = plan.lines.reduce((s, l) => s + num(l.marketValue), 0);

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="es-plan-panel"
      data-open="true"
      aria-label={`Plan — ${plan.title}`}
    >
      <div className="asset-panel-bar">
        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
          <PlatformLogo name={plan.manager} size={22} />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
              {plan.title}
            </p>
            <p className="text-meta truncate">
              {plan.shortLabel} · {plan.manager}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="es-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav className="workspace-tabs" role="tablist" aria-label="Sections du plan">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="workspace-tab"
            data-active={section === s.id ? "true" : "false"}
            data-testid={`es-panel-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        <p
          className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]"
          data-testid="es-panel-value"
        >
          {formatCurrency(String(plan.value), "EUR")}
        </p>
        <p
          className={cn(
            "num text-[length:var(--text-xs)] font-medium",
            plan.gainPct != null && plan.gainPct >= 0 && "val-positive",
            plan.gainPct != null && plan.gainPct < 0 && "val-negative",
            plan.gainPct == null && "text-[var(--foreground-faint)]"
          )}
        >
          {plan.gain != null
            ? `${plan.gain >= 0 ? "+" : "−"}${formatCurrency(String(Math.abs(plan.gain)), "EUR")} · ${pctLabel(plan.gainPct)}`
            : "Gain inconnu — versements non renseignés"}
        </p>

        <LiquidityBar
          availableValue={plan.availableValue}
          blockedValue={plan.blockedValue}
          className="mt-[var(--space-3)]"
        />

        {section === "summary" && (
          <>
            <SectionTitle>Valeur</SectionTitle>
            <Block>
              <Fact
                label="Valeur du plan"
                value={formatCurrency(String(plan.value), "EUR")}
              />
              <Fact
                label="Disponible"
                value={formatCurrency(String(plan.availableValue), "EUR")}
                tone={plan.availableValue > 0 ? "positive" : "muted"}
              />
              <Fact
                label="Bloqué"
                value={formatCurrency(String(plan.blockedValue), "EUR")}
              />
              <Fact
                label="Versements déclarés"
                value={
                  plan.contributed != null
                    ? formatCurrency(String(plan.contributed), "EUR")
                    : "—"
                }
                tone={plan.contributed == null ? "muted" : undefined}
              />
              <Fact
                label="Gain"
                value={
                  plan.gain != null
                    ? formatCurrency(String(plan.gain), "EUR")
                    : "—"
                }
                tone={
                  plan.gain == null
                    ? "muted"
                    : plan.gain >= 0
                      ? "positive"
                      : "negative"
                }
              />
            </Block>

            <SectionTitle>Repères</SectionTitle>
            <Block>
              <Fact label="Type de plan" value={plan.shortLabel} />
              <Fact label="Tenue de compte" value={plan.manager} />
              <Fact label="Supports" value={plan.lines.length} />
              <Fact
                label="Versements de l'année"
                value={
                  plan.contributedThisYear != null
                    ? formatCurrency(String(plan.contributedThisYear), "EUR")
                    : "—"
                }
              />
              <Fact
                label="Blocage retraite"
                value={plan.hasRetirementLock ? "Oui" : "Non"}
                tone={plan.hasRetirementLock ? undefined : "muted"}
              />
            </Block>
          </>
        )}

        {section === "allocation" && (
          <>
            <SectionTitle>Répartition par famille</SectionTitle>
            {plan.allocation.length === 0 ? (
              <p className="text-meta py-[var(--space-2)]">
                Aucun support valorisé sur ce plan.
              </p>
            ) : (
              <>
                <div
                  className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
                  role="img"
                  aria-label={plan.allocation
                    .map((a) => `${a.label} ${Math.round(a.sharePct ?? 0)} %`)
                    .join(", ")}
                >
                  {plan.allocation.map((a) => (
                    <span
                      key={a.category}
                      style={{
                        width: `${a.sharePct ?? 0}%`,
                        background: FUND_CATEGORY_TONE[a.category],
                      }}
                    />
                  ))}
                </div>
                <ul className="mt-[var(--space-3)]" data-testid="es-panel-allocation">
                  {plan.allocation.map((a) => (
                    <li
                      key={a.category}
                      className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-1)]"
                    >
                      <span className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: FUND_CATEGORY_TONE[a.category] }}
                          aria-hidden
                        />
                        {a.label}
                      </span>
                      <span className="num shrink-0 text-[length:var(--text-xs)]">
                        {a.sharePct != null
                          ? `${a.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                          : "—"}
                        <span className="text-meta ml-[var(--space-2)]">
                          {formatCurrency(String(a.value), "EUR")}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {section === "supports" && (
          <>
            <SectionTitle>Supports du plan</SectionTitle>
            <ul
              className="divide-y divide-[var(--border)] border-y border-[var(--border)]"
              data-testid="es-panel-supports"
            >
              {plan.lines.map((l) => {
                const value = num(l.marketValue);
                const weight = totalUnits > 0 ? (value / totalUnits) * 100 : null;
                return (
                  <li
                    key={l.id}
                    className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                        {l.fundName}
                      </span>
                      <span className="text-meta block">{l.unlockLabel}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block text-[length:var(--text-xs)] font-medium">
                        {formatCurrency(String(value), "EUR")}
                      </span>
                      <span className="text-meta num block">
                        {weight != null
                          ? `${weight.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                          : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {section === "contributions" && (
          <>
            <SectionTitle>Versements</SectionTitle>
            {/*
              Le modèle n'a pas de journal d'opérations : chaque lot **est** un
              versement daté. Un lot sans date n'apparaît pas — le placer en
              tête ou en queue serait une invention dans les deux cas.
            */}
            <ul
              className="divide-y divide-[var(--border)] border-y border-[var(--border)]"
              data-testid="es-panel-contributions"
            >
              {plan.lines
                .filter((l) => l.contributionDate)
                .sort(
                  (a, b) =>
                    Date.parse(b.contributionDate!) -
                    Date.parse(a.contributionDate!)
                )
                .map((l) => (
                  <li
                    key={l.id}
                    className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                        {l.fundName}
                      </span>
                      <span className="text-meta block">
                        {dateFr(l.contributionDate)}
                      </span>
                    </span>
                    <span className="num shrink-0 text-[length:var(--text-xs)] font-medium">
                      {l.contributedAmount
                        ? formatCurrency(l.contributedAmount, "EUR")
                        : "—"}
                    </span>
                  </li>
                ))}
            </ul>
            {plan.lines.every((l) => !l.contributionDate) && (
              <p className="text-meta py-[var(--space-2)]">
                Aucune date de versement renseignée sur ce plan.
              </p>
            )}
          </>
        )}

        {section === "liquidity" && (
          <>
            <SectionTitle>Disponibilité</SectionTitle>
            <Block>
              <Fact
                label="Disponible"
                value={formatCurrency(String(plan.availableValue), "EUR")}
                tone={plan.availableValue > 0 ? "positive" : "muted"}
              />
              <Fact
                label="Bloqué"
                value={formatCurrency(String(plan.blockedValue), "EUR")}
              />
              <Fact
                label="Prochain déblocage"
                value={dateFr(plan.nextUnlockDate)}
              />
              <Fact
                label="Blocage retraite"
                value={plan.hasRetirementLock ? "Oui" : "Non"}
                tone={plan.hasRetirementLock ? undefined : "muted"}
              />
            </Block>

            <SectionTitle>Échéances par lot</SectionTitle>
            <ul
              className="divide-y divide-[var(--border)] border-y border-[var(--border)]"
              data-testid="es-panel-unlocks"
            >
              {plan.lines.map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[length:var(--text-xs)] text-[var(--foreground)]">
                      {l.fundName}
                    </span>
                    <span className="text-meta block">{l.unlockLabel}</span>
                  </span>
                  <span
                    className={cn(
                      "num shrink-0 text-[length:var(--text-xs)] font-medium",
                      l.liquidityStatus === "AVAILABLE" && "val-positive"
                    )}
                  >
                    {formatCurrency(l.marketValue, "EUR")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
          <button
            type="button"
            className="btn btn-ghost text-[11px]"
            onClick={() => onManage("es-line-form")}
            data-testid="es-panel-add-line"
          >
            Ajouter un support
          </button>
          <button
            type="button"
            className="btn btn-ghost text-[11px]"
            onClick={() => onManage()}
            data-testid="es-panel-manage"
          >
            Gérer les supports
          </button>
        </div>
      </div>
    </aside>
  );
}
