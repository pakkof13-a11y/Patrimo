"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Building2,
  FileUp,
  Landmark,
  LayoutDashboard,
  List,
  Plus,
  Search,
  Settings,
  Wallet,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import type { MainTab } from "@/app/lib/types/ui";
import type { Holding } from "@/app/lib/types/ui";

type ActionItem = {
  id: string;
  label: string;
  section: "Actions" | "Navigation" | "Actifs";
  keywords?: string;
  icon?: React.ReactNode;
  run: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  holdings = [],
  onNavigate,
  onOpenTransaction,
  onOpenImport,
  onOpenPlatform,
  onOpenPreferences,
  onOpenAsset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  holdings?: Holding[];
  onNavigate: (tab: MainTab) => void;
  onOpenTransaction: (type?: string) => void;
  onOpenImport: () => void;
  onOpenPlatform: () => void;
  onOpenPreferences?: () => void;
  onOpenAsset?: (assetId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setHi(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
      // Échap ferme la palette (en plus du trap interne éventuel)
      if (open && e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const items = useMemo(() => {
    const actions: ActionItem[] = [
      {
        id: "tx-buy",
        label: "Enregistrer un achat",
        section: "Actions",
        keywords: "transaction achat",
        icon: <Plus className="h-3.5 w-3.5" />,
        run: () => onOpenTransaction("ACHAT"),
      },
      {
        id: "tx-sell",
        label: "Enregistrer une vente",
        section: "Actions",
        keywords: "transaction vente",
        icon: <Plus className="h-3.5 w-3.5" />,
        run: () => onOpenTransaction("VENTE"),
      },
      {
        id: "tx-div",
        label: "Enregistrer un dividende",
        section: "Actions",
        keywords: "dividende revenu",
        icon: <Plus className="h-3.5 w-3.5" />,
        run: () => onOpenTransaction("DIVIDENDE"),
      },
      {
        id: "tx",
        label: "Ajouter une transaction",
        section: "Actions",
        keywords: "transaction",
        icon: <Plus className="h-3.5 w-3.5" />,
        run: () => onOpenTransaction(),
      },
      {
        id: "import",
        label: "Importer un CSV",
        section: "Actions",
        keywords: "import csv courtier",
        icon: <FileUp className="h-3.5 w-3.5" />,
        run: () => onOpenImport(),
      },
      {
        id: "platform",
        label: "Créer une plateforme",
        section: "Actions",
        keywords: "plateforme courtier",
        icon: <Building2 className="h-3.5 w-3.5" />,
        run: () => onOpenPlatform(),
      },
      {
        id: "nav-holdings",
        label: "Aller aux Positions",
        section: "Navigation",
        icon: <Wallet className="h-3.5 w-3.5" />,
        run: () => onNavigate("holdings"),
      },
      {
        id: "nav-tx",
        label: "Aller aux Transactions",
        section: "Navigation",
        icon: <List className="h-3.5 w-3.5" />,
        run: () => onNavigate("transactions"),
      },
      {
        id: "nav-dash",
        label: "Aller au Tableau de bord",
        section: "Navigation",
        icon: <LayoutDashboard className="h-3.5 w-3.5" />,
        run: () => onNavigate("dashboard"),
      },
      {
        id: "nav-banks",
        label: "Aller aux Banques",
        section: "Navigation",
        icon: <Landmark className="h-3.5 w-3.5" />,
        run: () => onNavigate("banques"),
      },
      {
        id: "nav-plat",
        label: "Aller à Mes plateformes",
        section: "Navigation",
        icon: <Building2 className="h-3.5 w-3.5" />,
        run: () => onNavigate("platforms"),
      },
      {
        id: "nav-fiscal",
        label: "Aller à la Fiscalité",
        section: "Navigation",
        run: () => onNavigate("fiscal"),
      },
    ];
    if (onOpenPreferences) {
      actions.push({
        id: "prefs",
        label: "Ouvrir les préférences",
        section: "Actions",
        icon: <Settings className="h-3.5 w-3.5" />,
        run: () => onOpenPreferences(),
      });
    }

    const qn = q.trim().toLowerCase();
    const filtered = qn
      ? actions.filter(
          (a) =>
            a.label.toLowerCase().includes(qn) ||
            (a.keywords || "").includes(qn)
        )
      : actions;

    const assetHits: ActionItem[] = [];
    if (qn.length >= 1 && onOpenAsset) {
      for (const h of holdings) {
        const hay = `${h.name} ${h.ticker || ""} ${h.isin || ""}`.toLowerCase();
        if (!hay.includes(qn)) continue;
        assetHits.push({
          id: `asset-${h.assetId}`,
          label: `${h.name}${h.ticker ? ` (${h.ticker})` : ""}`,
          section: "Actifs",
          icon: <Search className="h-3.5 w-3.5" />,
          run: () => onOpenAsset(h.assetId),
        });
        if (assetHits.length >= 8) break;
      }
    }

    return [...filtered, ...assetHits];
  }, [
    q,
    holdings,
    onNavigate,
    onOpenTransaction,
    onOpenImport,
    onOpenPlatform,
    onOpenPreferences,
    onOpenAsset,
  ]);

  useEffect(() => {
    setHi(0);
  }, [q]);

  const run = useCallback(
    (item: ActionItem) => {
      onOpenChange(false);
      item.run();
    },
    [onOpenChange]
  );

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[hi];
      if (item) run(item);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  if (!open) return null;

  const sections = ["Actions", "Navigation", "Actifs"] as const;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/55 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Palette de commandes"
      data-testid="command-palette"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="Rechercher une action, un actif, une page…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Recherche dans la palette"
            data-testid="command-palette-input"
          />
          <kbd className="hidden rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-slate-400 sm:inline">
            Échap
          </kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {items.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              Aucun résultat
            </p>
          )}
          {sections.map((section) => {
            const group = items.filter((i) => i.section === section);
            if (!group.length) return null;
            return (
              <div key={section} className="mb-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {section}
                </div>
                {group.map((item) => {
                  const idx = items.indexOf(item);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={idx === hi}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition",
                        idx === hi
                          ? "bg-teal-50 text-teal-900 dark:bg-teal-950/50 dark:text-teal-100"
                          : "hover:bg-[var(--muted)]"
                      )}
                      onMouseEnter={() => setHi(idx)}
                      onClick={() => run(item)}
                    >
                      <span className="text-slate-400">{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="border-t border-[var(--border)] px-3 py-1.5 text-[10px] text-slate-400">
          ↑↓ naviguer · Entrée valider · Ctrl/⌘ K ouvrir
        </div>
      </div>
    </div>
  );
}
