"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ListPlus, Settings2 } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import { EsOverview } from "@/components/employee-savings/es-overview";
import { EmployeeSavingsManagement } from "@/components/tabs/employee-savings-tab";
import {
  groupIntoPlans,
  type OverviewLine,
} from "@/app/lib/employee-savings/overview";
import { cn } from "@/app/lib/utils";

/**
 * Écran « Épargne salariale ».
 *
 * Une vue d'ensemble, et rien d'autre au premier écran : combien, réparti
 * comment, constitué quand, sur quels plans. La saisie — supports, import CSV,
 * dates de déblocage — reste accessible, repliée en bas, son état porté par
 * l'URL pour survivre à un rafraîchissement.
 */

const MANAGE_HASH = "#gestion";

export function EmployeeSavingsTab({
  baseCurrency = "EUR",
  className,
}: {
  baseCurrency?: string;
  className?: string;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  // Le compte des plans appartient au titre. La même requête sert la vue
  // d'ensemble juste en dessous : React Query ne la lance qu'une fois.
  const q = useQuery({
    queryKey: ["employee-savings"],
    queryFn: () => fetchJson<{ lines: OverviewLine[] }>("/api/employee-savings"),
  });
  const planCount = q.data ? groupIntoPlans(q.data.lines).length : null;

  useEffect(() => {
    const sync = () => setManageOpen(window.location.hash === MANAGE_HASH);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  function setManage(open: boolean) {
    setManageOpen(open);
    const url = new URL(window.location.href);
    url.hash = open ? MANAGE_HASH : "";
    window.history.replaceState(null, "", url.toString());
  }

  function openManage(target?: string) {
    setManage(true);
    requestAnimationFrame(() => {
      const el = target
        ? document.querySelector(`[data-testid="${target}"]`)
        : document.getElementById("es-manage");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className={cn("min-w-0", className)} data-testid="employee-savings-tab">
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="mb-[var(--space-4)] flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-[var(--space-3)] text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)] text-[var(--foreground)]">
            Épargne salariale
            {planCount != null && (
              <span
                className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-xs)] font-medium text-[var(--foreground-secondary)]"
                data-testid="es-plan-count"
              >
                {planCount} plan{planCount > 1 ? "s" : ""}
              </span>
            )}
          </h1>
          <p className="text-meta mt-[var(--space-1)]">
            Vue d&apos;ensemble de vos plans et de vos droits
          </p>
        </div>

        <div className="relative flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="ghost"
            onClick={() => openManage()}
            data-testid="es-manage-open"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gérer les supports
          </Button>

          <Button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            aria-haspopup="menu"
            data-testid="es-add-open"
          >
            <ListPlus className="h-3.5 w-3.5" />
            Ajouter
            <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Button>

          {addOpen ? (
            <>
              {/* Cliquer ailleurs referme — moins coûteux qu'un écouteur global. */}
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Fermer le menu"
                onClick={() => setAddOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-[var(--space-1)] min-w-[14rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] py-[var(--space-1)] shadow-[var(--shadow-lg)]"
                data-testid="es-add-menu"
              >
                {(
                  [
                    ["es-add-line", "Ajouter un support / verser"],
                    ["es-csv-import", "Importer un relevé CSV"],
                    ["es-unlock-form", "Dates de déblocage"],
                  ] as const
                ).map(([target, label]) => (
                  <button
                    key={target}
                    type="button"
                    role="menuitem"
                    className="block w-full px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-xs)] text-[var(--foreground)] transition-[background-color] hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setAddOpen(false);
                      openManage(target);
                    }}
                    data-testid={`es-add-${target}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/*
        Plus d'onglet unique décoratif : un « Vue d'ensemble » souligné qui ne
        menait nulle part n'est pas une navigation. Les vues réelles sont
        portées par la barre segmentée d'`EsOverview`, où elles changent
        effectivement le contenu.
      */}
      <EsOverview onManage={openManage} />

      {/* ── Gestion des supports (repliée) ──────────────────────── */}
      <section id="es-manage" className="mt-[var(--gap-card)]">
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-md)]",
            "px-[var(--space-3)] py-[var(--space-2)] text-[length:var(--text-sm)]",
            "text-[var(--foreground-secondary)] transition-colors duration-[var(--duration-fast)]",
            "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
          )}
          aria-expanded={manageOpen}
          onClick={() => setManage(!manageOpen)}
          data-testid="es-manage-toggle"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              manageOpen && "rotate-180"
            )}
            aria-hidden
          />
          Gestion des supports — saisie, import CSV, dates de déblocage
        </button>

        {manageOpen && (
          <EmployeeSavingsManagement baseCurrency={baseCurrency} />
        )}
      </section>
    </div>
  );
}
