"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Bitcoin,
  Briefcase,
  Building2,
  CandlestickChart,
  Gem,
  Landmark,
  LayoutGrid,
  CreditCard,
  Plug,
  PiggyBank,
  Receipt,
  Scale,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/app/lib/utils";
import { isPositionsTab, type MainTab } from "@/app/lib/types/ui";

/**
 * Architecture de navigation — quatre familles.
 *
 * Le critère de regroupement est **ce que la chose fait au patrimoine net**,
 * qui est la question à laquelle l'application existe pour répondre :
 *
 *   Avoirs        s'ajoutent au patrimoine net ;
 *   Engagements   ne s'y ajoutent pas — une dette s'en retranche, une position
 *                 à levier n'y pèse que par sa marge et son P&L latent ;
 *   Suivi         n'est pas du patrimoine mais son instrumentation : le
 *                 journal, la couche de connexion, l'imposition.
 *
 * Les groupes précédents — « Enveloppes », « Actifs détenus », « Positions &
 * engagements » — classaient par **forme de détention**. C'était défendable,
 * mais cela séparait un PEA d'un bien immobilier alors que les deux
 * s'additionnent de la même façon, et cela rangeait Trading avec les avoirs
 * alors qu'une position à levier n'en est pas un.
 *
 * Le mécanisme de dépliant est conservé tel quel : la barre est un rail étroit
 * à icônes et micro-libellés (voir `.term-sidebar`), qui ne peut pas afficher
 * treize entrées à plat sans être élargie — ce qui serait un autre chantier.
 */
type NavSection = {
  id: string;
  title: string;
  icon: LucideIcon;
  testId: string;
  /* `icon` : repère de balayage dans le dépliant, jamais une décoration —
     même gabarit pour toutes, plus discrètes que le libellé. */
  items: { id: MainTab; label: string; testId: string; icon: LucideIcon }[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "avoirs",
    title: "Avoirs",
    // Ce qu'on possède : le portefeuille au sens propre.
    icon: Wallet,
    testId: "group-avoirs",
    items: [
      { id: "holdings", label: "Portefeuille", testId: "holdings", icon: Briefcase },
      // Sous-vue du portefeuille : PEA et CTO y ont été consolidés, et
      // l'éditeur de leurs poches d'espèces y vit désormais.
      { id: "securities", label: "PEA & CTO", testId: "securities", icon: Landmark },
      { id: "banques", label: "Banques", testId: "banques", icon: Banknote },
      { id: "assurance-vie", label: "Assurance-vie", testId: "assurance-vie", icon: ShieldCheck },
      { id: "immobilier", label: "Immobilier", testId: "immobilier", icon: Building2 },
      { id: "crypto", label: "Cryptos", testId: "crypto", icon: Bitcoin },
      {
        id: "epargne-salariale",
        label: "Épargne salariale",
        testId: "epargne-salariale",
        icon: PiggyBank,
      },
      { id: "alternatifs", label: "Actifs alternatifs", testId: "alternatifs", icon: Gem },
    ],
  },
  {
    id: "engagements",
    title: "Engagements",
    // La balance : une dette et un levier déplacent l'équilibre, un avoir non.
    icon: Scale,
    testId: "group-engagements",
    items: [
      { id: "liabilities", label: "Passifs / Crédits", testId: "liabilities", icon: CreditCard },
      { id: "trading", label: "Trading", testId: "trading", icon: CandlestickChart },
    ],
  },
  {
    id: "suivi",
    title: "Suivi",
    // L'instrumentation : d'où viennent les données et ce qu'elles produisent.
    icon: Activity,
    testId: "group-suivi",
    items: [
      { id: "transactions", label: "Transactions", testId: "transactions", icon: ArrowLeftRight },
      { id: "platforms", label: "Plateformes", testId: "platforms", icon: Plug },
      { id: "fiscal", label: "Fiscalité", testId: "fiscal", icon: Receipt },
    ],
  },
];

const SECTION_TABS = new Map<string, Set<MainTab>>(
  NAV_SECTIONS.map((g) => [g.id, new Set(g.items.map((i) => i.id))])
);

type DirectEntry = {
  id: MainTab;
  label: string;
  icon: LucideIcon;
  testId: string;
};

/** Vue — la seule entrée qui n'appartient à aucune famille patrimoniale. */
export const DIRECT_TOP: DirectEntry[] = [
  { id: "dashboard", label: "Tableau de bord", icon: LayoutGrid, testId: "dashboard" },
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
}: {
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
}) {
  /** Groupe dont le sous-menu est ouvert — un seul à la fois. */
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  /*
    `av` et `cfd` sont des vues filtrées du tableau Positions : ce sont des
    onglets à part entière, mais aucune entrée de la barre ne les porte. Sans
    ce repli, `/positions/av` n'allumait rien du tout.

    `crypto` est exclu bien qu'appartenant à la même famille : il a sa propre
    entrée, et sans l'exclure deux éléments seraient actifs à la fois.
  */
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
            active={tab === e.id}
            onClick={() => go(e.id)}
          />
        ))}

        {NAV_SECTIONS.map((group) => {
          const active =
            SECTION_TABS.get(group.id)!.has(tab) ||
            // Les vues filtrées de Positions appartiennent à Avoirs, via
            // l'entrée Portefeuille qui les héberge.
            (group.id === "avoirs" && positionsActive);
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
                    const itemActive =
                      item.id === "holdings" ? positionsActive : tab === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        data-testid={`nav-${item.testId}`}
                        aria-current={itemActive ? "page" : undefined}
                        onClick={() => go(item.id)}
                        className={cn(
                          "flex w-full items-center gap-[var(--space-2)]",
                          "rounded-[var(--radius-sm)] px-[var(--space-2)] py-[var(--space-2)]",
                          "text-left text-[length:var(--text-base)] transition-colors",
                          "duration-[var(--duration-fast)] ease-[var(--ease-out)]",
                          "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                          itemActive
                            ? "bg-[var(--primary-soft)] font-medium text-[var(--primary-text)]"
                            : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                        )}
                      >
                        {/*
                          L'icône reste en retrait du libellé : trait fin, et
                          une teinte en dessous quand la ligne n'est pas active.
                          `shrink-0` fige la gouttière, de sorte que les
                          libellés s'alignent quelle que soit la glyphe.
                        */}
                        <item.icon
                          className={cn(
                            "h-[0.875rem] w-[0.875rem] shrink-0",
                            itemActive ? "opacity-100" : "text-[var(--foreground-faint)]"
                          )}
                          strokeWidth={1.5}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/*
          Paramètres ne figure plus ici : le menu utilisateur y mène déjà, et
          le rail n'a pas à porter deux fois la même destination. La page, la
          route et les réglages sont inchangés.
        */}
      </nav>

    </div>
  );
}
