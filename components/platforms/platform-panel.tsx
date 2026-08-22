"use client";

/**
 * Colonne de détail de la plateforme sélectionnée.
 *
 * Même géométrie que les panneaux des autres modules (`.asset-panel`) : la
 * table reste en place, aucune modale, aucune navigation.
 *
 * Trois sections, parce que ce sont les trois seules questions que la donnée
 * permet de traiter honnêtement :
 *
 *   Résumé     ce que la plateforme porte, ventilé par enveloppe ;
 *   Connexion  d'où viennent les données et si ça fonctionne ;
 *   Activité   ce qu'elle a produit dans le journal, et les liens vers
 *              Transactions et Portefeuille filtrés dessus.
 *
 * Volontairement absents : protocole, fréquence, prochaine synchronisation et
 * identifiant de connexion. Patrimo n'a pas de planificateur ni d'identité de
 * connexion — les afficher reviendrait à inventer une donnée.
 *
 * Et jamais, sous aucune forme : clé API, secret ou jeton. Le serveur n'en
 * envoie que la **présence** (`hasWalletApiKey`), utilisée ici pour un simple
 * indice.
 */

import { useState } from "react";
import {
  ArrowUpRight,
  GitMerge,
  KeyRound,
  Pencil,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatPercent, getChangeColor, cn } from "@/app/lib/utils";
import { envelopeLabel, type PlatformView } from "@/app/lib/platforms/connection";
import { StatusPill } from "./platform-list";

type Section = "summary" | "connection" | "activity";

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: "summary", label: "Résumé" },
  { id: "connection", label: "Connexion" },
  { id: "activity", label: "Activité" },
];

/** Adresse publique raccourcie — 6 caractères de tête sur EVM, « 0x » étant fixe. */
function shortAddress(addr: string): string {
  const isEvm = addr.startsWith("0x") || addr.startsWith("0X");
  const head = isEvm ? 6 : 4;
  if (addr.length <= head + 4) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-4)}`;
}

const dateLabel = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "numeric",
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
          "num min-w-0 shrink-0 text-right text-[length:var(--text-xs)] font-medium",
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

export function PlatformPanel({
  view,
  baseCurrency,
  syncing,
  onClose,
  onEdit,
  onSync,
  onMerge,
  onDelete,
  onNewTransaction,
  onViewPositions,
  onViewTransactions,
  onImport,
  className,
}: {
  view: PlatformView | null;
  baseCurrency: string;
  syncing: boolean;
  onClose: () => void;
  onEdit: (v: PlatformView) => void;
  onSync: (v: PlatformView) => void;
  onMerge: (v: PlatformView) => void;
  onDelete: (v: PlatformView) => void;
  onNewTransaction?: (v: PlatformView) => void;
  onViewPositions?: (v: PlatformView) => void;
  onViewTransactions?: (v: PlatformView) => void;
  onImport?: (v: PlatformView) => void;
  className?: string;
}) {
  const [section, setSection] = useState<Section>("summary");

  if (!view) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="platform-panel"
        data-open="false"
        aria-label="Détail de la plateforme"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucune plateforme sélectionnée
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une ligne pour voir ce qu&apos;elle porte et comment Aurea la
            récupère. La table reste en place.
          </p>
        </div>
      </aside>
    );
  }

  const p = view.row;
  const envelopes = p.envelopes ?? [];
  const pnl = Number(p.unrealizedPnlBase || p.unrealizedPnlEur || 0);
  const pnlPct = p.unrealizedPnlPct ? Number(p.unrealizedPnlPct) : null;
  const address = (p.walletAddress || "").trim();

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="platform-panel"
      data-open="true"
      aria-label={`Plateforme — ${view.name}`}
    >
      <div className="asset-panel-bar">
        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
          <PlatformLogo src={p.logoUrl} name={view.name} size={24} />
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
              {view.name}
            </p>
            <p className="text-meta truncate">
              {view.typeLabel}
              {p.subtype ? ` · ${p.subtype}` : ""}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="platform-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <nav
        className="workspace-tabs"
        role="tablist"
        aria-label="Sections de la plateforme"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            className="workspace-tab"
            data-active={section === s.id ? "true" : "false"}
            data-testid={`platform-tab-${s.id}`}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="asset-panel-body">
        {section === "summary" ? (
          <>
            <p
              className="num text-[length:var(--text-2xl)] font-semibold tracking-tight text-[var(--foreground)]"
              data-testid="platform-panel-value"
            >
              {formatCurrency(String(view.value), baseCurrency)}
            </p>
            <p className="text-meta flex items-center gap-[var(--space-2)]">
              <StatusPill view={view} />
            </p>

            {/*
              Pas de sparkline ici : aucune série historique n'existe par
              plateforme. La courbe du patrimoine se lit au Tableau de bord,
              où le moteur historique la reconstruit réellement.
            */}

            <SectionTitle>Ce que porte la plateforme</SectionTitle>
            <Block>
              <Fact
                label="Espèces"
                value={formatCurrency(String(view.cash), baseCurrency)}
              />
              <Fact
                label="Titres"
                value={formatCurrency(String(view.positionsValue), baseCurrency)}
              />
              <Fact
                label="Positions ouvertes"
                value={view.positionCount || "—"}
                tone={view.positionCount ? undefined : "muted"}
              />
              {view.positionCount > 0 ? (
                <Fact
                  label="Plus/moins-value latente"
                  value={
                    <>
                      {formatCurrency(String(pnl), baseCurrency)}
                      {pnlPct != null ? (
                        <span className={cn("ml-1.5", getChangeColor(pnlPct))}>
                          {formatPercent(String(pnlPct))}
                        </span>
                      ) : null}
                    </>
                  }
                  tone={pnl > 0 ? "positive" : pnl < 0 ? "negative" : "muted"}
                />
              ) : null}
            </Block>

            {envelopes.length > 0 ? (
              <>
                <SectionTitle>Répartition par enveloppe</SectionTitle>
                <Block>
                  {envelopes.map((e) => (
                    <Fact
                      key={e.accountType}
                      label={envelopeLabel(e.accountType)}
                      value={
                        <>
                          {formatCurrency(
                            e.valueBase || e.valueEur,
                            baseCurrency
                          )}
                          <span className="text-meta ml-1.5">
                            {e.positionCount} pos.
                          </span>
                        </>
                      }
                    />
                  ))}
                </Block>
              </>
            ) : null}

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

        {section === "connection" ? (
          <>
            <SectionTitle>Origine des données</SectionTitle>
            <Block>
              <Fact
                label="Mode"
                value={
                  view.canSync
                    ? "Synchronisation on-chain"
                    : "Saisie manuelle et import"
                }
              />
              {view.chainLabel ? (
                <Fact label="Réseau" value={view.chainLabel} />
              ) : null}
              <Fact label="Statut" value={<StatusPill view={view} />} />
              {view.canSync ? (
                <Fact
                  label="Dernière synchronisation"
                  value={dateLabel(view.lastSyncedAt)}
                  tone={view.lastSyncedAt ? undefined : "muted"}
                />
              ) : null}
              {address ? (
                <Fact
                  label="Adresse publique"
                  value={
                    <span title={address} className="font-mono">
                      {shortAddress(address)}
                    </span>
                  }
                />
              ) : null}
              <Fact label="Ajoutée le" value={dateLabel(p.createdAt)} />
            </Block>

            {/*
              La clé API n'est jamais renvoyée par le serveur : seule sa
              présence est connue ici, et c'est tout ce qu'il est légitime
              d'afficher. Même masquée, une clé affichée est une clé exposée.
            */}
            {p.hasWalletApiKey ? (
              <p
                className="text-meta mt-[var(--space-3)] flex items-center gap-[var(--space-2)]"
                data-testid="platform-panel-key-hint"
              >
                <KeyRound className="h-3 w-3 shrink-0" aria-hidden />
                Une clé API est enregistrée pour cette plateforme. Elle reste
                sur le serveur et n&apos;est jamais affichée.
              </p>
            ) : null}

            {view.status === "ADDRESS_MISSING" ? (
              <div
                className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
                data-testid="platform-panel-attention"
              >
                <p className="text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                  Adresse publique manquante
                </p>
                <p className="text-meta mt-[var(--space-1)]">
                  Aurea reconnaît ce réseau mais n&apos;a aucune adresse à lire.
                  Renseignez-la pour activer la synchronisation.
                </p>
              </div>
            ) : null}

            {view.status === "STALE" || view.status === "NEVER_SYNCED" ? (
              <div
                className="mt-[var(--space-3)] rounded-[var(--radius-md)] border border-[var(--border)] p-[var(--space-3)]"
                data-testid="platform-panel-attention"
              >
                <p className="text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
                  {view.status === "STALE"
                    ? "Synchronisation ancienne"
                    : "Jamais synchronisée"}
                </p>
                <p className="text-meta mt-[var(--space-1)]">
                  Les positions de ce wallet peuvent être en retard sur la
                  chaîne.
                </p>
              </div>
            ) : null}

            {view.canSync ? (
              <Button
                variant="outline"
                className="mt-[var(--space-3)] w-full"
                onClick={() => onSync(view)}
                disabled={syncing}
                data-testid="platform-panel-sync"
              >
                <RefreshCw
                  className={cn("mr-1.5 h-3.5 w-3.5", syncing && "animate-spin")}
                  aria-hidden
                />
                {syncing ? "Synchronisation…" : "Synchroniser maintenant"}
              </Button>
            ) : (
              <p className="text-meta mt-[var(--space-3)]">
                Aucune connexion automatique n&apos;existe pour cette plateforme.
                Ses données proviennent de vos saisies et de vos imports de
                relevés — ce n&apos;est pas une anomalie.
              </p>
            )}
          </>
        ) : null}

        {section === "activity" ? (
          <>
            <SectionTitle>Journal</SectionTitle>
            <Block>
              <Fact
                label="Opérations enregistrées"
                value={view.transactionCount || "—"}
                tone={view.transactionCount ? undefined : "muted"}
              />
              <Fact
                label="Dernière opération"
                value={dateLabel(view.lastTransactionAt)}
                tone={view.lastTransactionAt ? undefined : "muted"}
              />
            </Block>

            {/*
              Pas d'histogramme d'activité par jour : le compte par plateforme
              existe, la ventilation quotidienne demanderait une requête
              dédiée par plateforme — exactement le N+1 que ce module doit
              éviter. Le lien ci-dessous ouvre le journal réel, filtré.
            */}

            <SectionTitle>Ouvrir dans le contexte</SectionTitle>
            <div className="grid gap-[var(--space-2)]">
              {onViewTransactions ? (
                <Button
                  variant="ghost"
                  onClick={() => onViewTransactions(view)}
                  data-testid="platform-panel-transactions"
                >
                  Voir les transactions
                  <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
              {onViewPositions ? (
                <Button
                  variant="ghost"
                  onClick={() => onViewPositions(view)}
                  data-testid="platform-preview-positions"
                >
                  Voir les positions
                  <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                </Button>
              ) : null}
              {onNewTransaction ? (
                <Button
                  variant="ghost"
                  onClick={() => onNewTransaction(view)}
                  data-testid="platform-preview-new-tx"
                >
                  Nouvelle transaction
                </Button>
              ) : null}
              {onImport ? (
                <Button
                  variant="ghost"
                  onClick={() => onImport(view)}
                  data-testid="platform-panel-import"
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Importer un relevé
                </Button>
              ) : null}
            </div>
          </>
        ) : null}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid gap-[var(--space-2)]">
          <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => onEdit(view)}
              data-testid="platform-panel-edit"
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Modifier
            </Button>
            <Button
              variant="ghost"
              onClick={() => onMerge(view)}
              data-testid="platform-panel-merge"
            >
              <GitMerge className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Fusionner
            </Button>
          </div>
          <Button
            variant="danger"
            onClick={() => onDelete(view)}
            data-testid="platform-panel-delete"
          >
            Déconnecter la plateforme
          </Button>
        </div>
      </div>
    </aside>
  );
}
