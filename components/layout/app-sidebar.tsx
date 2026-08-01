"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftRight,
  FileText,
  Gem,
  LayoutGrid,
  Landmark,
  Layers,
  Scale,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { isPositionsTab, type MainTab } from "@/app/lib/types/ui";

/**
 * Groupes patrimoniaux — chacun est désormais une entrée de premier niveau.
 *
 * Le mockup ne prévoit que sept entrées quand l'application en compte
 * quatorze ; l'écart tenait auparavant dans un unique dépliant « Patrimoine »,
 * générique au point de ne rien dire de ce qu'il contenait. Trois entrées
 * portant chacune son propre nom et sa propre icône disent immédiatement où
 * chercher, sans perdre la compacité qui justifiait le dépliant.
 *
 * Le classement suit la nature comptable, pas l'ordre historique : ce qu'on
 * détient via un contrat (l'enveloppe), ce qu'on détient en direct, ce qu'on
 * doit ou risque.
 */
type WealthGroup = {
  id: string;
  title: string;
  icon: LucideIcon;
  testId: string;
  items: { id: MainTab; label: string; testId: string }[];
};

const WEALTH_GROUPS: WealthGroup[] = [
  {
    id: "enveloppes",
    title: "Enveloppes",
    // Une enveloppe se reçoit et se garde : le pli scellé porté par une
    // institution, plutôt qu'un actif choisi au coup par coup.
    icon: Landmark,
    testId: "group-enveloppes",
    items: [
      { id: "securities", label: "PEA & CTO", testId: "securities" },
      { id: "assurance-vie", label: "Assurance-vie", testId: "assurance-vie" },
      { id: "banques", label: "Banques", testId: "banques" },
      {
        id: "epargne-salariale",
        label: "Épargne salariale",
        testId: "epargne-salariale",
      },
    ],
  },
  {
    id: "actifs",
    title: "Actifs détenus",
    // Un actif détenu en direct — la pierre précieuse plutôt que le contrat
    // qui la couvre.
    icon: Gem,
    testId: "group-actifs",
    items: [
      { id: "immobilier", label: "Immobilier", testId: "immobilier" },
      { id: "crypto", label: "Cryptos", testId: "crypto" },
      { id: "alternatifs", label: "Actifs alternatifs", testId: "alternatifs" },
    ],
  },
  {
    id: "positions",
    title: "Positions & engagements",
    // La balance : un effet de levier ou une dette déplacent l'équilibre
    // dans un sens ou dans l'autre, ce qu'un actif détenu ne fait pas.
    icon: Scale,
    testId: "group-positions",
    items: [
      { id: "trading", label: "Trading", testId: "trading" },
      { id: "liabilities", label: "Passifs", testId: "liabilities" },
    ],
  },
];

const WEALTH_TABS_BY_GROUP = new Map<string, Set<MainTab>>(
  WEALTH_GROUPS.map((g) => [g.id, new Set(g.items.map((i) => i.id))])
);

type DirectEntry = {
  id: MainTab;
  label: string;
  icon: LucideIcon;
  testId: string;
};

/** Les quatre entrées qui mènent directement à un écran. */
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
  /** Groupe dont le sous-menu est ouvert — un seul à la fois. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // `crypto` appartient à la famille Positions côté données mais possède sa
  // propre entrée : sans l'exclure, deux éléments seraient actifs à la fois.
  const positionsActive = isPositionsTab(tab) && tab !== "crypto";

  useEffect(() => {
    if (!openGroupId) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenGroupId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenGroupId(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [openGroupId]);

  function go(next: MainTab) {
    setOpenGroupId(null);
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

        {WEALTH_GROUPS.map((group) => {
          const active = WEALTH_TABS_BY_GROUP.get(group.id)!.has(tab);
          const isOpen = openGroupId === group.id;
          return (
            // Chaque groupe porte son propre menu, ancré sur son propre
            // bouton : trois entrées ouvrent trois menus à trois hauteurs
            // différentes, aucune ne doit deviner où se trouvent les autres.
            <div key={group.id} className="relative">
              <NavButton
                label={group.title}
                icon={group.icon}
                testId={group.testId}
                active={active}
                expanded={isOpen}
                onClick={() =>
                  setOpenGroupId((v) => (v === group.id ? null : group.id))
                }
              />
              {isOpen && (
                <div
                  role="menu"
                  aria-label={group.title}
                  data-testid={`nav-${group.testId}-menu`}
                  className={cn(
                    "absolute z-40 w-[13rem] rounded-[var(--radius-lg)] border border-[var(--border-strong)]",
                    "bg-[var(--surface-raised)] p-[var(--space-3)] shadow-[var(--shadow-lg)]",
                    // Desktop : à droite du bouton qui l'a ouvert. Mobile
                    // (sidebar horizontale) : en dessous, alignée à gauche.
                    "left-full top-0 ml-[var(--space-2)]",
                    "max-[900px]:left-0 max-[900px]:top-full max-[900px]:ml-0 max-[900px]:mt-[var(--space-2)]"
                  )}
                >
                  {group.items.map((item) => {
                    const itemActive = tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        data-testid={`nav-${item.testId}`}
                        aria-current={itemActive ? "page" : undefined}
                        onClick={() => go(item.id)}
                        className={cn(
                          "block w-full rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)]",
                          "text-left text-[length:var(--text-base)] transition-colors",
                          "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                          itemActive
                            ? "bg-[var(--primary-soft)] font-medium text-[var(--primary-text)]"
                            : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

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

    </div>
  );
}
