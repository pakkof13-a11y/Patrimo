"use client";

/**
 * Table des plateformes — la couche de connexion du patrimoine.
 *
 * Elle ne fait que **montrer**. Synchronisation, édition, fusion et
 * déconnexion vivent dans le panneau de détail : la liste portait auparavant
 * un menu « ⋯ » par carte, ce qui en faisait une console d'administration
 * plutôt qu'une lecture de « où sont mes comptes ».
 *
 * Six colonnes, celles qui répondent aux quatre questions du module : quelle
 * plateforme, de quelle nature, combien elle porte, et si quelque chose
 * réclame mon attention.
 */

import { PlatformLogo } from "@/components/ui/platform-logo";
import { formatCurrency } from "@/app/lib/utils";
import { DataRow } from "@/components/ui/data-row";
import type {
  PlatformStatusTone,
  PlatformView,
} from "@/app/lib/platforms/connection";

const TONE_COLOR: Record<PlatformStatusTone, string> = {
  positive: "var(--success)",
  warning: "var(--warning)",
  attention: "var(--danger)",
  muted: "var(--foreground-faint)",
};

/**
 * Dernier signe de vie.
 *
 * Pour un wallet, c'est la dernière synchronisation ; pour tout le reste, la
 * dernière opération enregistrée — une plateforme manuelle n'a pas de synchro,
 * et laisser la colonne vide sur les trois quarts des lignes la rendrait
 * inutile.
 */
export function lastActivityLabel(v: PlatformView, now: Date): string {
  const iso = v.canSync ? (v.lastSyncedAt ?? v.lastTransactionAt) : v.lastTransactionAt;
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";

  const days = Math.floor((now.getTime() - t) / 86_400_000);
  if (days <= 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: days > 300 ? "numeric" : undefined,
  });
}

/** Sous-titre de la cellule : ce que la plateforme porte réellement. */
function contentLabel(v: PlatformView): string {
  const parts: string[] = [];
  if (v.positionCount > 0) {
    parts.push(`${v.positionCount} position${v.positionCount > 1 ? "s" : ""}`);
  }
  if (v.envelopeCount > 1) parts.push(`${v.envelopeCount} enveloppes`);
  if (parts.length === 0 && v.transactionCount > 0) {
    parts.push(
      `${v.transactionCount} opération${v.transactionCount > 1 ? "s" : ""}`
    );
  }
  return parts.join(" · ") || "Aucune position";
}

export function StatusPill({ view }: { view: PlatformView }) {
  return (
    <span
      className="inline-flex items-center gap-[var(--space-2)] whitespace-nowrap text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]"
      data-status={view.status}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: TONE_COLOR[view.statusTone] }}
        aria-hidden
      />
      {view.statusLabel}
    </span>
  );
}

export function PlatformList({
  views,
  selectedId,
  onSelect,
  baseCurrency,
  now,
}: {
  views: PlatformView[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  baseCurrency: string;
  now: Date;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="term-table" data-testid="platforms-table">
        <thead>
          <tr>
            <th>Plateforme</th>
            <th>Nature</th>
            <th className="text-right">Contenu</th>
            <th className="text-right">Valeur</th>
            <th className="text-right">Dernière activité</th>
            <th>Connexion</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <DataRow
              key={v.id}
              selected={selectedId === v.id}
              onSelect={() => onSelect(v.id)}
              data-testid={`platform-${v.name}`}
              data-platform-row={v.id}
            >
              <td>
                <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                  <PlatformLogo
                    src={v.row.logoUrl}
                    name={v.name}
                    size={22}
                  />
                  <span className="truncate font-medium text-[var(--foreground)]">
                    {v.name}
                  </span>
                </div>
              </td>
              <td>
                <span className="text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                  {v.typeLabel}
                </span>
                {v.row.subtype ? (
                  <span className="text-meta block">{v.row.subtype}</span>
                ) : null}
              </td>
              <td className="text-right">
                <span className="text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                  {contentLabel(v)}
                </span>
              </td>
              <td className="num text-right font-medium">
                {formatCurrency(String(v.value), baseCurrency)}
              </td>
              <td className="text-right text-[length:var(--text-2xs)] text-[var(--foreground-secondary)]">
                {lastActivityLabel(v, now)}
              </td>
              <td>
                <StatusPill view={v} />
              </td>
            </DataRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}
