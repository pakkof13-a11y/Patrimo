"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  FileText,
  LayoutGrid,
  Layers,
  PieChart,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { isPositionsTab, type MainTab } from "@/app/lib/types/ui";

/**
 * Sections regroupées derrière l'entrée « Patrimoine ».
 *
 * Le mockup ne prévoit que sept entrées ; l'application en compte quatorze.
 * Plutôt que d'orpheliner neuf écrans réellement implémentés ou de gonfler la
 * colonne jusqu'à la rendre illisible, ils vivent dans un panneau déroulant —
 * la sidebar garde sa silhouette, rien ne devient inatteignable.
 *
 * Le classement suit la nature comptable, pas l'ordre historique : ce qu'on
 * détient via un contrat, ce qu'on détient en direct, ce qu'on doit.
 */
const WEALTH_GROUPS: {
  title: string;
  items: { id: MainTab; label: string; testId: string }[];
}[] = [
  {
    title: "Enveloppes",
    items: [
      { id: "securities", label: "PEA & CTO", testId: "securities" },
      { id: "assurance-vie", label: "Assurance-vie", testId: "assurance-vie" },
      { id: "banques", label: "Banques", testId: "banques" },
    ],
  },
  {
    title: "Actifs détenus",
    items: [
      { id: "immobilier", label: "Immobilier", testId: "immobilier" },
      { id: "crypto", label: "Cryptos", testId: "crypto" },
      { id: "alternatifs", label: "Actifs alternatifs", testId: "alternatifs" },
      {
        id: "epargne-salariale",
        label: "Épargne salariale",
        testId: "epargne-salariale",
      },
    ],
  },
  {
    title: "Positions & engagements",
    items: [
      { id: "trading", label: "Trading", testId: "trading" },
      { id: "liabilities", label: "Passifs", testId: "liabilities" },
    ],
  },
];

const WEALTH_TABS = new Set<MainTab>(
  WEALTH_GROUPS.flatMap((g) => g.items.map((i) => i.id))
);

type DirectEntry = {
  id: MainTab;
  label: string;
  icon: LucideIcon;
  testId: string;
};

/** Les six entrées qui mènent directement à un écran. */
const DIRECT_TOP: DirectEntry[] = [
  { id: "dashboard", label: "Tableau de bord", icon: LayoutGrid, testId: "dashboard" },
  { id: "holdings", label: "Portefeuille", icon: Wallet, testId: "holdings" },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight, testId: "transactions" },
  { id: "platforms", label: "Plateformes", icon: Layers, testId: "platforms" },
];

const DIRECT_BOTTOM: DirectEntry[] = [
  { id: "fiscal", label: "Fiscalité", icon: FileText, testId: "fiscal" },
];

function NavButton({
  label,
  icon: Icon,
  active,
  testId,
  onClick,
  expanded,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  testId: string;
  onClick: () => void;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="term-nav-item"
      data-active={active}
      data-testid={`nav-${testId}`}
      aria-current={active && expanded === undefined ? "page" : undefined}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : "menu"}
      onClick={onClick}
      title={label}
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.5} aria-hidden />
      <span className="w-full px-[var(--space-px)] leading-[var(--leading-tight)]">
        {label}
      </span>
    </button>
  );
}

export function AppSidebar({
  tab,
  onTabChange,
  onOpenPreferences,
}: {
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
  onOpenPreferences: () => void;
}) {
  const [wealthOpen, setWealthOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // `crypto` appartient à la famille Positions côté données mais possède sa
  // propre entrée : sans l'exclure, deux éléments seraient actifs à la fois.
  const positionsActive = isPositionsTab(tab) && tab !== "crypto";
  const wealthActive = WEALTH_TABS.has(tab);

  useEffect(() => {
    if (!wealthOpen) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setWealthOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setWealthOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [wealthOpen]);

  function go(next: MainTab) {
    setWealthOpen(false);
    onTabChange(next);
  }

  return (
    <div ref={wrapRef} className="relative">
      <nav
        className="term-sidebar"
        aria-label="Navigation principale"
        data-testid="primary-nav"
      >
        {DIRECT_TOP.map((e) => (
          <NavButton
            key={e.id}
            label={e.label}
            icon={e.icon}
            testId={e.testId}
            active={e.id === "holdings" ? positionsActive : tab === e.id}
            onClick={() => go(e.id)}
          />
        ))}

        <NavButton
          label="Patrimoine"
          icon={PieChart}
          testId="wealth"
          active={wealthActive}
          expanded={wealthOpen}
          onClick={() => setWealthOpen((v) => !v)}
        />

        {DIRECT_BOTTOM.map((e) => (
          <NavButton
            key={e.id}
            label={e.label}
            icon={e.icon}
            testId={e.testId}
            active={tab === e.id}
            onClick={() => go(e.id)}
          />
        ))}

        {/* Repoussé en pied de colonne : réglages, jamais une destination métier. */}
        <div className="mt-auto max-[900px]:mt-0" />
        <NavButton
          label="Paramètres"
          icon={Settings}
          testId="preferences"
          active={false}
          onClick={onOpenPreferences}
        />
      </nav>

      {wealthOpen && (
        <div
          role="menu"
          aria-label="Sections patrimoniales"
          data-testid="nav-wealth-menu"
          className={cn(
            "absolute z-40 w-[15rem] rounded-[var(--radius-lg)] border border-[var(--border-strong)]",
            "bg-[var(--surface-raised)] p-[var(--space-3)] shadow-[var(--shadow-lg)]",
            // Desktop : à droite de la colonne. Mobile (sidebar horizontale) :
            // en dessous, aligné à gauche.
            "left-full top-[var(--space-3)] ml-[var(--space-2)]",
            "max-[900px]:left-[var(--space-2)] max-[900px]:top-full max-[900px]:ml-0 max-[900px]:mt-[var(--space-2)]"
          )}
        >
          {WEALTH_GROUPS.map((group, gi) => (
            <div
              key={group.title}
              className={gi > 0 ? "mt-[var(--space-3)]" : undefined}
            >
              <p className="text-label mb-[var(--space-1)] px-[var(--space-2)]">
                {group.title}
              </p>
              {group.items.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    data-testid={`nav-${item.testId}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => go(item.id)}
                    className={cn(
                      "block w-full rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)]",
                      "text-left text-[length:var(--text-base)] transition-colors",
                      "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      active
                        ? "bg-[var(--primary-soft)] font-medium text-[var(--primary-text)]"
                        : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
