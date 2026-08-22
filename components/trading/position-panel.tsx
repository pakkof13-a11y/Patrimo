"use client";

/**
 * Colonne de détail de la position sélectionnée.
 *
 * Même géométrie que les panneaux des autres modules (`.asset-panel`).
 *
 * Trois sections seulement — Résumé, Risque, Historique — et **Risque
 * disparaît** quand la position ne porte ni stop, ni cible, ni estimation de
 * liquidation. Une section vide affirmerait que le risque a été regardé.
 *
 * Pas de section « Exécution » : le modèle ne porte ni ordres ni fills. Une
 * position est une ligne, pas un ensemble d'exécutions partielles, et
 * fabriquer un fill unique à partir du prix d'entrée donnerait l'illusion d'un
 * carnet qui n'existe pas.
 */

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/app/lib/utils";
import {
  contractTypeLabel,
  exchangeLabel,
  marginTypeLabel,
} from "@/app/lib/crypto/futures-constants";
import { underlyingTypeLabel } from "@/app/lib/trading/constants";
import {
  MARK_FRESHNESS_LABEL,
  type PositionView,
} from "@/app/lib/trading/positions-view";
import { DirectionBadge, StatusDot } from "./position-list";

type Section = "summary" | "risk" | "history";

const num = (v: string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const dateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
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

export function PositionPanel({
  view,
  baseCurrency,
  onClose,
  onEdit,
  onClosePosition,
  onOpenTransactions,
  className,
}: {
  view: PositionView | null;
  baseCurrency: string;
  onClose: () => void;
  onEdit?: (v: PositionView) => void;
  onClosePosition?: (v: PositionView) => void;
  onOpenTransactions?: (v: PositionView) => void;
  className?: string;
}) {
  const [section, setSection] = useState<Section>("summary");

  if (!view) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="position-panel"
        data-open="false"
        aria-label="Détail de la position"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucune position sélectionnée
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une ligne pour voir sa marge, son risque et son historique.
            La table reste en place.
          </p>
        </div>
      </aside>
    );
  }

  const p = view.row;
  const liqEstimated = num(p.derived.liquidationPriceEstimated);
  const liqReported = num(p.liquidationPriceReported);
  const stop = num(p.stopLoss);
  const target = num(p.takeProfit);

  const sections: Array<{ id: Section; label: string }> = [
    { id: "summary", label: "Résumé" },
    ...(view.hasRiskData ? [{ id: "risk" as const, label: "Risque" }] : []),
    { id: "history", label: "Historique" },
  ];
  const active = sections.some((s) => s.id === section) ? section : "summary";

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="position-panel"
      data-open="true"
      aria-label={`Position — ${view.instrument}`}
    >
      <div className="asset-panel-bar">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
            <span className="truncate">{view.instrument}</span>
            <DirectionBadge direction={view.direction} />
          </p>
          <p className="text-meta flex items-center gap-[var(--space-2)] truncate">
            {exchangeLabel(view.exchange)}
            <span className="opacity-40">·</span>
            <StatusDot view={view} />
          </p>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="position-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav
        className="workspace-tabs"
        role="tablist"
        aria-label="Sections de la position"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active === s.id}
            className="workspace-tab"
            data-active={active === s.id ? "true" : "false"}
            data-testid={`position-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        <p
          className={cn(
            "num text-[length:var(--text-2xl)] font-semibold tracking-tight",
            view.pnlEur > 0 && "val-positive",
            view.pnlEur < 0 && "val-negative",
            view.pnlEur === 0 && "text-[var(--foreground)]"
          )}
          data-testid="position-panel-pnl"
        >
          {formatCurrency(String(view.pnlEur), baseCurrency)}
        </p>
        <p className="text-meta">
          {view.isOpen ? "P&L latent" : "Résultat net"}
          {view.pnlPct != null ? (
            <>
              <span className="mx-1 opacity-40">·</span>
              <span
                className={cn(
                  view.pnlPct > 0 && "val-positive",
                  view.pnlPct < 0 && "val-negative"
                )}
              >
                {view.pnlPct > 0 ? "+" : ""}
                {view.pnlPct.toLocaleString("fr-FR", {
                  maximumFractionDigits: 2,
                })}{" "}
                %
              </span>
              <span className="opacity-60"> de la marge</span>
            </>
          ) : null}
        </p>

        {/*
          Avertissement de fraîcheur. Un P&L latent adossé à un prix jamais
          actualisé n'est pas un P&L latent — et Aurea ne rafraîchit pas le
          prix de marque depuis un flux de marché.
        */}
        {view.isOpen && view.markFreshness !== "MARKED" ? (
          <p
            className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)] text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]"
            data-testid="position-mark-warning"
          >
            {view.markFreshness === "MISSING"
              ? "Aucun prix de marque n'est enregistré : le P&L latent ne peut pas être calculé."
              : "Le prix de marque est resté au prix d'entrée. Aurea ne le rafraîchit pas depuis le marché — mettez-le à jour pour obtenir un P&L latent significatif."}
          </p>
        ) : null}

        {active === "summary" ? (
          <>
            <SectionTitle>Position</SectionTitle>
            <Block>
              <Fact label="Sens" value={view.direction} />
              <Fact
                label="Taille"
                value={`${view.size.toLocaleString("fr-FR", { maximumFractionDigits: 8 })} ${p.baseCurrency}`}
              />
              <Fact
                label="Prix d'entrée"
                value={formatCurrency(String(view.entryPrice), baseCurrency)}
              />
              <Fact
                label="Prix de marque"
                value={
                  view.markPrice != null
                    ? formatCurrency(String(view.markPrice), baseCurrency)
                    : MARK_FRESHNESS_LABEL[view.markFreshness]
                }
                tone={view.markFreshness === "MARKED" ? undefined : "muted"}
              />
              <Fact label="Levier" value={`×${view.leverage}`} />
            </Block>

            {/*
              Trois notions distinctes, jamais confondues : ce que la position
              représente sur le marché, ce qu'elle immobilise réellement, et
              ce qu'elle rapporte. Les additionner n'aurait aucun sens.
            */}
            <SectionTitle>Exposition et capital</SectionTitle>
            <Block>
              <Fact
                label="Notionnel"
                value={formatCurrency(String(view.notionalEur), baseCurrency)}
              />
              <Fact
                label="Marge engagée"
                value={formatCurrency(String(view.marginEur), baseCurrency)}
              />
              <Fact
                label={view.isOpen ? "P&L latent" : "P&L réalisé brut"}
                value={formatCurrency(
                  String(
                    view.isOpen ? view.pnlEur : Number(p.realizedPnl ?? 0)
                  ),
                  baseCurrency
                )}
                tone={view.pnlEur >= 0 ? "positive" : "negative"}
              />
            </Block>

            <SectionTitle>Contrat</SectionTitle>
            <Block>
              <Fact
                label="Sous-jacent"
                value={underlyingTypeLabel(view.underlyingType)}
              />
              <Fact
                label="Type"
                value={contractTypeLabel(view.contractType)}
              />
              <Fact label="Plateforme" value={exchangeLabel(view.exchange)} />
              {p.subAccountLabel ? (
                <Fact label="Sous-compte" value={p.subAccountLabel} />
              ) : null}
              {p.marginType ? (
                <Fact label="Marge" value={marginTypeLabel(p.marginType)} />
              ) : null}
              <Fact
                label="Devises"
                value={`${p.baseCurrency} / ${p.quoteCurrency}`}
              />
              {p.expiryDate ? (
                <Fact label="Échéance" value={dateTime(p.expiryDate)} />
              ) : null}
            </Block>

            {p.notes ? (
              <>
                <SectionTitle>Notes</SectionTitle>
                <p className="border-y border-[var(--border)] py-[var(--space-2)] text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]">
                  {p.notes}
                </p>
              </>
            ) : null}
          </>
        ) : null}

        {active === "risk" ? (
          <>
            {view.liquidationAlert ? (
              <div
                className="mb-[var(--space-3)] flex gap-[var(--space-2)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
                data-testid="position-liquidation-alert"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                  aria-hidden
                />
                <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]">
                  Le prix actuel est proche de l&apos;estimation de
                  liquidation.
                </p>
              </div>
            ) : null}

            <SectionTitle>Seuils</SectionTitle>
            <Block>
              <Fact
                label="Stop loss"
                value={
                  stop != null
                    ? formatCurrency(String(stop), baseCurrency)
                    : "Non défini"
                }
                tone={stop != null ? undefined : "muted"}
              />
              <Fact
                label="Take profit"
                value={
                  target != null
                    ? formatCurrency(String(target), baseCurrency)
                    : "Non défini"
                }
                tone={target != null ? undefined : "muted"}
              />
            </Block>

            <SectionTitle>Liquidation</SectionTitle>
            <Block>
              <Fact
                label="Estimation Aurea"
                value={
                  liqEstimated != null
                    ? formatCurrency(String(liqEstimated), baseCurrency)
                    : "—"
                }
              />
              {liqReported != null ? (
                <Fact
                  label="Communiqué par la plateforme"
                  value={formatCurrency(String(liqReported), baseCurrency)}
                />
              ) : null}
              <Fact
                label="Distance"
                value={
                  p.derived.distanceToLiquidationPct != null
                    ? `${p.derived.distanceToLiquidationPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                    : "—"
                }
                tone={view.liquidationAlert ? "negative" : undefined}
              />
            </Block>

            {/*
              L'estimation applique un taux de maintenance forfaitaire : chaque
              plateforme a son propre barème par palier, auquel Aurea n'a pas
              accès. C'est un ordre de grandeur, pas une valeur contractuelle.
            */}
            <p className="text-meta mt-[var(--space-3)] leading-relaxed">
              L&apos;estimation applique un taux de maintenance forfaitaire de
              0,5 %. Chaque plateforme a son propre barème par palier de
              notionnel : traitez ce prix comme un ordre de grandeur, jamais
              comme un seuil contractuel.
            </p>
          </>
        ) : null}

        {active === "history" ? (
          <>
            <SectionTitle>Cycle de vie</SectionTitle>
            <Block>
              <Fact label="Ouverte le" value={dateTime(p.openedAt)} />
              <Fact
                label="Clôturée le"
                value={p.closedAt ? dateTime(p.closedAt) : "Encore ouverte"}
                tone={p.closedAt ? undefined : "muted"}
              />
              {p.exchangeTradeId ? (
                <Fact
                  label="Référence plateforme"
                  value={
                    <span className="font-mono text-[length:var(--text-2xs)]">
                      {p.exchangeTradeId}
                    </span>
                  }
                />
              ) : null}
            </Block>

            <SectionTitle>Coûts de portage</SectionTitle>
            <Block>
              <Fact
                label="Funding cumulé"
                value={
                  p.fundingPaid != null
                    ? formatCurrency(p.fundingPaid, baseCurrency)
                    : "Non renseigné"
                }
                tone={p.fundingPaid != null ? "negative" : "muted"}
              />
              <Fact
                label="Commissions"
                value={
                  p.commissionPaid != null
                    ? formatCurrency(p.commissionPaid, baseCurrency)
                    : "Non renseigné"
                }
                tone={p.commissionPaid != null ? "negative" : "muted"}
              />
            </Block>

            {/*
              Pas de liste d'exécutions : ce modèle ne porte ni ordres ni
              fills. Une position y est une ligne, pas un carnet.
            */}
            <p className="text-meta mt-[var(--space-3)] leading-relaxed">
              Aurea enregistre la position, pas ses exécutions partielles :
              renforcements et réductions ne sont pas détaillés.
            </p>
          </>
        ) : null}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid gap-[var(--space-2)]">
          <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
            {onEdit ? (
              <Button
                variant="outline"
                onClick={() => onEdit(view)}
                data-testid="position-panel-edit"
              >
                Modifier
              </Button>
            ) : null}
            {onOpenTransactions ? (
              <Button
                variant="ghost"
                onClick={() => onOpenTransactions(view)}
                data-testid="position-panel-transactions"
              >
                Voir le journal
              </Button>
            ) : null}
          </div>
          {/*
            « Clôturer » enregistre une sortie dans Aurea. Aucun ordre n'est
            transmis à la plateforme : Aurea suit, il n'exécute pas.
          */}
          {view.isOpen && onClosePosition ? (
            <>
              <Button
                variant="outline"
                onClick={() => onClosePosition(view)}
                data-testid="position-panel-close-position"
              >
                Enregistrer la clôture
              </Button>
              <p className="text-meta">
                Enregistre la sortie dans votre suivi. Aucun ordre n&apos;est
                transmis à la plateforme.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
