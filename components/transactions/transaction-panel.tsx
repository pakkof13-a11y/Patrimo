"use client";

/**
 * Colonne de détail de la transaction sélectionnée.
 *
 * Même géométrie que les panneaux du Portefeuille, des Banques, de
 * l'Assurance-vie, de l'Immobilier, de l'Épargne salariale, des Alternatifs et
 * des Passifs (`.asset-panel`).
 *
 * Le contenu s'adapte au **type** d'opération : un dividende n'a ni quantité ni
 * prix unitaire, un transfert a deux plateformes et aucune contrepartie de
 * marché, un versement n'a pas d'actif. Afficher partout les mêmes quinze
 * lignes en laissant douze vides ferait de la fiche un formulaire à trous
 * plutôt qu'une lecture.
 *
 * Rien n'y est recalculé : chaque montant vient du journal, où le moteur
 * comptable l'a écrit.
 */

import { ExternalLink, X } from "lucide-react";
import { AssetLogo } from "@/components/ui/platform-logo";
import { Button } from "@/components/ui/button";
import { formatCurrency, cn } from "@/app/lib/utils";
import { TRANSACTION_TYPES } from "@/app/lib/constants";
import { txTypeChipClass } from "@/components/transactions/tx-type-filters";
import { txNetPriceEur } from "@/app/lib/transactions/net-price";
import type { TxRow } from "@/app/lib/types/ui";

/** Types qui portent une contrepartie de marché (quantité × prix). */
const TRADE_TYPES = new Set(["ACHAT", "VENTE", "REWARD", "AIRDROP", "SPLIT"]);

/** Types dont le montant est un encaissement pur. */
const INCOME_TYPES = new Set(["DIVIDENDE", "COUPON", "LOYER", "INTERET"]);

const TRANSFER_TYPES = new Set(["TRANSFERT_CASH", "TRANSFERT_TITRE"]);

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const dateLong = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const timeShort = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

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

export function TransactionPanel({
  tx,
  onClose,
  onEdit,
  onDelete,
  onOpenPlatform,
  className,
}: {
  tx: TxRow | null;
  onClose: () => void;
  onEdit: (tx: TxRow) => void;
  onDelete: (tx: TxRow) => void;
  /** Ouvre la plateforme de l'opération. */
  onOpenPlatform?: (platformId: string) => void;
  className?: string;
}) {
  if (!tx) {
    return (
      <aside
        className={cn("asset-panel", className)}
        data-testid="transaction-panel"
        data-open="false"
        aria-label="Détail de la transaction"
      >
        <div className="asset-panel-empty">
          <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
            Aucune transaction sélectionnée
          </p>
          <p className="text-meta max-w-[16rem]">
            Cliquez une ligne pour afficher son détail ici. La liste reste en
            place.
          </p>
        </div>
      </aside>
    );
  }

  const typeLabel =
    TRANSACTION_TYPES[tx.type as keyof typeof TRANSACTION_TYPES] ?? tx.type;

  const isTrade = TRADE_TYPES.has(tx.type);
  const isIncome = INCOME_TYPES.has(tx.type);
  const isTransfer = TRANSFER_TYPES.has(tx.type);

  /*
    Montant affiché en tête : l'impact réel sur la trésorerie, tel que le
    journal l'a inscrit. Un achat sort de l'argent, une vente en fait rentrer —
    le signe vient du moteur comptable, jamais d'une règle réécrite ici.
  */
  const net = num(txNetPriceEur(tx));
  const gross = num(tx.grossAmountEur);
  const fees = num(tx.fees);
  const quantity = tx.quantity ? num(tx.quantity) : null;
  const unitPrice = tx.unitPrice ? num(tx.unitPrice) : null;

  return (
    <aside
      className={cn("asset-panel", className)}
      data-testid="transaction-panel"
      data-open="true"
      aria-label={`Transaction — ${typeLabel}`}
    >
      <div className="asset-panel-bar">
        <div className="flex min-w-0 items-center gap-[var(--space-2)]">
          {tx.asset ? (
            <AssetLogo
              src={tx.asset.logoUrl}
              name={tx.asset.name}
              size={22}
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
              {tx.asset?.name ?? typeLabel}
            </p>
            <p className="text-meta flex min-w-0 items-center gap-[var(--space-2)]">
              <span
                className={cn(
                  "shrink-0 rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-2xs)]",
                  txTypeChipClass(tx.type)
                )}
              >
                {typeLabel}
              </span>
              {tx.asset?.ticker ? (
                <span className="truncate">{tx.asset.ticker}</span>
              ) : null}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="asset-panel-close"
          onClick={onClose}
          aria-label="Fermer le détail"
          data-testid="tx-panel-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="asset-panel-body">
        <p
          className={cn(
            "num text-[length:var(--text-2xl)] font-semibold tracking-tight",
            net > 0 && "val-positive",
            net < 0 && "val-negative",
            net === 0 && "text-[var(--foreground)]"
          )}
          data-testid="tx-panel-amount"
        >
          {formatCurrency(String(net), "EUR")}
        </p>
        <p className="text-meta">
          {dateLong(tx.occurredAt)}
          <span className="mx-1 opacity-40">·</span>
          {timeShort(tx.occurredAt)}
          {isTrade && quantity != null && unitPrice != null ? (
            <>
              <span className="mx-1 opacity-40">·</span>
              <span className="num">{quantity.toLocaleString("fr-FR")}</span> ×{" "}
              <span className="num">
                {formatCurrency(String(unitPrice), tx.currency)}
              </span>
            </>
          ) : null}
        </p>

        {/* ── Informations ────────────────────────────────────────── */}
        <SectionTitle>Informations</SectionTitle>
        <Block>
          <Fact label="Type" value={typeLabel} />
          <Fact
            label="Date"
            value={`${dateLong(tx.occurredAt)} · ${timeShort(tx.occurredAt)}`}
          />

          {tx.asset ? (
            <Fact
              label="Actif"
              value={
                <span className="truncate">
                  {tx.asset.ticker ? `${tx.asset.ticker} · ` : ""}
                  {tx.asset.name}
                </span>
              }
            />
          ) : null}

          {tx.asset?.accountType ? (
            <Fact label="Enveloppe" value={tx.asset.accountType} />
          ) : null}

          {/*
            Un transfert a deux plateformes. Les présenter sur une seule ligne
            « Plateforme » masquerait la seule chose qui distingue un transfert
            d'un mouvement de marché : l'argent change de place sans changer de
            propriétaire.
          */}
          {isTransfer ? (
            <>
              <Fact label="Depuis" value={tx.platform?.name ?? "—"} />
              <Fact label="Vers" value={tx.toPlatform?.name ?? "—"} />
            </>
          ) : (
            <Fact label="Plateforme" value={tx.platform?.name ?? "—"} />
          )}

          {tx.blockchainLabel ? (
            <Fact label="Blockchain" value={tx.blockchainLabel} />
          ) : null}

          <Fact label="Devise" value={tx.currency} />
        </Block>

        {/* ── Montants ────────────────────────────────────────────── */}
        <SectionTitle>Montants</SectionTitle>
        <Block>
          {isTrade && quantity != null ? (
            <Fact
              label="Quantité"
              value={quantity.toLocaleString("fr-FR", {
                maximumFractionDigits: 8,
              })}
            />
          ) : null}

          {isTrade && unitPrice != null ? (
            <Fact
              label="Prix unitaire"
              value={formatCurrency(String(unitPrice), tx.currency)}
            />
          ) : null}

          {gross !== 0 ? (
            <Fact
              label={isIncome ? "Montant brut" : "Montant"}
              value={formatCurrency(String(gross), "EUR")}
            />
          ) : null}

          <Fact
            label="Frais"
            value={
              fees !== 0
                ? formatCurrency(String(fees), tx.currency)
                : formatCurrency("0", tx.currency)
            }
            tone={fees !== 0 ? "negative" : "muted"}
          />

          <Fact
            label="Impact trésorerie"
            value={formatCurrency(String(net), "EUR")}
            tone={net > 0 ? "positive" : net < 0 ? "negative" : "muted"}
          />

          {tx.currency !== "EUR" && tx.fxRateToEur ? (
            <Fact
              label="Taux de change"
              value={`1 ${tx.currency} = ${Number(tx.fxRateToEur).toLocaleString(
                "fr-FR",
                { maximumFractionDigits: 6 }
              )} EUR`}
            />
          ) : null}
        </Block>

        {/*
          Pas de section « Impact sur le portefeuille ».

          Elle demanderait la quantité avant et après l'opération et le PRU qui
          en résulte. Le journal ne les porte pas : ils sont dérivés du rejeu
          complet du ledger, côté positions. Les recalculer ici produirait un
          second moteur comptable, et une valeur qui divergerait du portefeuille
          à la première divergence d'arrondi.
        */}

        {tx.notes ? (
          <>
            <SectionTitle>Notes</SectionTitle>
            <p
              className="border-y border-[var(--border)] py-[var(--space-2)] text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]"
              data-testid="tx-panel-notes"
            >
              {tx.notes}
            </p>
          </>
        ) : null}

        <SectionTitle>Actions</SectionTitle>
        <div className="grid gap-[var(--space-2)]">
          <div className="grid gap-[var(--space-2)] sm:grid-cols-2">
            <Button
              variant="outline"
              onClick={() => onEdit(tx)}
              data-testid="tx-panel-edit"
            >
              Modifier
            </Button>
            {onOpenPlatform && tx.platformId ? (
              <Button
                variant="ghost"
                onClick={() => onOpenPlatform(tx.platformId)}
                data-testid="tx-panel-platform"
              >
                Voir la plateforme
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </Button>
            ) : null}
          </div>
          <Button
            variant="danger"
            onClick={() => onDelete(tx)}
            data-testid="tx-panel-delete"
          >
            Supprimer
          </Button>
        </div>
      </div>
    </aside>
  );
}
