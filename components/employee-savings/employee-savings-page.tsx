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
            Vue d&apos;ensemble de votre épargne salariale
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="outline"
            onClick={() => openManage()}
            data-testid="es-manage-open"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gérer les supports
          </Button>
          <Button
            type="button"
            onClick={() => openManage("es-add-line")}
            data-testid="es-add-open"
          >
            <ListPlus className="h-3.5 w-3.5" />
            Effectuer un versement
          </Button>
        </div>
      </header>

      {/* Onglet unique — pour la lisibilité de la page, pas pour naviguer. */}
      <div
        className="mb-[var(--gap-card)] border-b border-[var(--border)]"
        data-testid="es-tabs"
      >
        <span className="inline-block border-b-2 border-[var(--primary)] px-[var(--space-1)] pb-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[var(--primary-text)]">
          Vue d&apos;ensemble
        </span>
      </div>

      <EsOverview
        onManage={() => openManage()}
        onAddLine={() => openManage("es-add-line")}
      />

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
