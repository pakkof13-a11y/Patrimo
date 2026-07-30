"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, FileUp, Plus, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { HeaderAccountMenu } from "@/components/layout/header-account-menu";
import { BrandLogo } from "@/components/branding/brand-logo";
import { BRAND } from "@/components/branding/brand-assets";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { cn } from "@/app/lib/utils";

const TX_QUICK: { type: string; label: string }[] = [
  { type: "ACHAT", label: "Achat" },
  { type: "VENTE", label: "Vente" },
  { type: "DIVIDENDE", label: "Dividende" },
  { type: "FRAIS", label: "Frais" },
];

const iconBtnClass = cn(
  "h-[2rem] w-[2rem] shrink-0 p-0 text-[var(--foreground-faint)]",
  "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
  "disabled:opacity-45"
);

/**
 * Header du terminal.
 *
 * La navigation produit a quitté cette barre pour la colonne latérale : le
 * header ne porte plus que l'identité, la recherche et les actions. C'est ce
 * qui permet à la recherche d'occuper le centre — position qu'elle ne pouvait
 * pas tenir tant qu'une rangée d'onglets se disputait la même largeur.
 */
export function AppHeader({
  baseCurrency,
  onBaseCurrencyChange,
  lastPriceSync,
  priceSyncPulse,
  refreshPending,
  onRefreshPrices,
  onOpenTransaction,
  onOpenImport,
  onOpenCommandPalette,
}: {
  baseCurrency: string;
  onBaseCurrencyChange: (code: string) => void;
  lastPriceSync: Date | null;
  priceSyncPulse: boolean;
  refreshPending: boolean;
  onRefreshPrices: () => void;
  onOpenTransaction: (type?: string) => void;
  onOpenImport?: () => void;
  onOpenCommandPalette?: () => void;
}) {
  const [txMenuOpen, setTxMenuOpen] = useState(false);
  const [txCoords, setTxCoords] = useState<{
    top: number;
    left: number;
    minWidth: number;
  } | null>(null);
  const txRef = useRef<HTMLDivElement>(null);
  const txMenuRef = useRef<HTMLDivElement>(null);
  const txToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!txRef.current?.contains(t) && !txMenuRef.current?.contains(t)) {
        setTxMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTxMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useLayoutEffect(() => {
    if (!txMenuOpen) return;
    function update() {
      const btn = txToggleRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const wrap = txRef.current?.getBoundingClientRect();
      const right = wrap ? wrap.right : r.right;
      setTxCoords({ top: r.bottom + 6, left: right - 168, minWidth: 168 });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [txMenuOpen]);

  const effectiveTxCoords = txMenuOpen ? txCoords : null;

  const txMenu =
    effectiveTxCoords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={txMenuRef}
        className={cn(
          "z-[100] rounded-[var(--radius-md)] border border-[var(--border-strong)]",
          "bg-[var(--surface-raised)] py-[var(--space-1)] shadow-[var(--shadow-lg)]"
        )}
        role="menu"
        data-testid="tx-type-menu"
        style={{
          position: "fixed",
          top: effectiveTxCoords.top,
          left: Math.max(8, effectiveTxCoords.left),
          minWidth: effectiveTxCoords.minWidth,
        }}
      >
        <p className="text-label px-[var(--space-3)] py-[var(--space-1)]">
          Type d&apos;opération
        </p>
        {TX_QUICK.map((t) => (
          <button
            key={t.type}
            type="button"
            role="menuitem"
            className={cn(
              "block w-full px-[var(--space-3)] py-[var(--space-2)] text-left",
              "text-[length:var(--text-base)] text-[var(--foreground-secondary)]",
              "transition-colors duration-[var(--duration-fast)]",
              "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
              "focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none"
            )}
            onClick={() => {
              setTxMenuOpen(false);
              onOpenTransaction(t.type);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>,
      document.body
    );

  const priceTitle = lastPriceSync
    ? `Actualiser les prix · dernier : ${formatDateTimeParis(lastPriceSync)}`
    : "Actualiser les prix (auto ~10 s)";

  return (
    <header
      className="app-header sticky top-0 z-20 min-w-0"
      data-testid="app-header"
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-[var(--space-4)]",
          "h-[var(--header-height)] px-[var(--space-4)]"
        )}
      >
        {/* ── Identité ── */}
        <div
          className="flex min-w-0 shrink-0 items-center gap-[var(--space-3)]"
          data-testid="header-brand"
        >
          <BrandLogo
            size={32}
            alt=""
            className="h-[1.75rem] w-[1.75rem] rounded-[var(--radius-sm)]"
          />
          <div className="min-w-0 leading-none">
            <div
              className={cn(
                "truncate text-[length:var(--text-md)] font-semibold",
                "tracking-[var(--tracking-label)] text-[var(--foreground)]"
              )}
            >
              {BRAND.name}
            </div>
            <div className="text-label mt-[var(--space-1)] hidden lg:block">
              {BRAND.terminal}
            </div>
          </div>
        </div>

        {/* ── Recherche, centrée ──
            Un bouton et non un <input> : la saisie a lieu dans la palette de
            commandes, qui sait aussi router vers un onglet ou une action. Un
            champ factice ici obligerait à maintenir deux moteurs de recherche. */}
        <div className="flex min-w-0 flex-1 justify-center">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              data-testid="open-command-palette"
              title="Recherche (/) · palette (Ctrl+K)"
              className={cn(
                "group flex h-[2rem] w-full max-w-[30rem] min-w-0 items-center gap-[var(--space-2)]",
                "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)]",
                "px-[var(--space-3)] text-[length:var(--text-sm)] text-[var(--foreground-faint)]",
                "transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                "hover:border-[var(--border-strong)] hover:text-[var(--foreground-secondary)]",
                "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              )}
            >
              <Search className="h-[0.875rem] w-[0.875rem] shrink-0" aria-hidden />
              <span className="truncate">
                Rechercher un actif, un ticker, une plateforme…
              </span>
              <kbd
                className={cn(
                  "ml-auto hidden shrink-0 rounded-[var(--radius-xs)] border border-[var(--border)]",
                  "px-[var(--space-1)] py-[1px] font-[family-name:var(--font-mono)]",
                  "text-[length:var(--text-2xs)] text-[var(--foreground-faint)] sm:block"
                )}
              >
                ⌘K
              </kbd>
            </button>
          )}
        </div>

        {/* ── Utilitaires ── */}
        <div
          className="flex shrink-0 items-center gap-[var(--space-1)]"
          data-testid="header-utilities"
          role="group"
          aria-label="Outils"
        >
          <NotificationBell />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefreshPrices}
            disabled={refreshPending}
            data-testid="refresh-prices"
            title={priceTitle}
            aria-label="Actualiser les prix"
            className={cn(iconBtnClass, "relative")}
          >
            <RefreshCw
              className={cn(
                "h-[0.875rem] w-[0.875rem]",
                refreshPending && "animate-spin"
              )}
            />
            <span
              className={cn(
                "absolute right-[var(--space-1)] top-[var(--space-1)]",
                "h-[0.3125rem] w-[0.3125rem] rounded-[var(--radius-full)] bg-[var(--chart-positive)]",
                priceSyncPulse ? "opacity-100" : "opacity-40"
              )}
              aria-hidden
            />
          </Button>
          {onOpenImport && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenImport}
              data-testid="open-import-csv"
              title="Importer un relevé CSV"
              aria-label="Importer un relevé CSV"
              className={iconBtnClass}
            >
              <FileUp className="h-[0.875rem] w-[0.875rem]" />
            </Button>
          )}
        </div>

        {/* ── Action métier principale ── */}
        <div ref={txRef} className="relative inline-flex shrink-0">
          <Button
            size="sm"
            variant="gold"
            onClick={() => onOpenTransaction()}
            data-testid="open-tx-form"
            className={cn(
              "rounded-r-none pr-[var(--space-2)]",
              "tracking-[var(--tracking-label)]"
            )}
            title="Nouvelle transaction (n) — source de vérité du portefeuille"
            aria-keyshortcuts="n"
          >
            <Plus className="h-[0.875rem] w-[0.875rem]" />
            <span className="hidden uppercase sm:inline">Transaction</span>
          </Button>
          <Button
            ref={txToggleRef}
            size="sm"
            variant="gold"
            className="rounded-l-none border-l border-[var(--primary-foreground)]/20 px-[var(--space-1)]"
            aria-label="Choisir un type d'opération"
            aria-expanded={txMenuOpen}
            aria-haspopup="menu"
            data-testid="open-tx-menu"
            title="Achat, vente, dividende, frais…"
            onClick={() => setTxMenuOpen((v) => !v)}
          >
            <ChevronDown className="h-[0.875rem] w-[0.875rem]" />
          </Button>
        </div>

        {/* ── Compte ── */}
        <div
          className="flex shrink-0 items-center"
          data-testid="header-account-zone"
          role="group"
          aria-label="Compte"
        >
          <HeaderAccountMenu
            baseCurrency={baseCurrency}
            onBaseCurrencyChange={onBaseCurrencyChange}
            lastPriceSync={lastPriceSync}
            priceSyncPulse={priceSyncPulse}
          />
        </div>
      </div>
      {txMenu}
    </header>
  );
}
