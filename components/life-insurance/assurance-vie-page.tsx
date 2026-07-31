"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import { AvOverview } from "@/components/life-insurance/av-overview";
import { AssuranceVieManagement } from "@/components/tabs/assurance-vie-tab";
import { cn } from "@/app/lib/utils";

/**
 * Écran « Assurance-vie ».
 *
 * Un onglet et un seul : la vue d'ensemble. Elle répond aux quatre questions
 * qu'on se pose en ouvrant cette page — combien, réparti comment, avec quelle
 * performance, sur quels contrats — et rien d'autre n'y dispute la place.
 *
 * La saisie (ouvrir un contrat, verser, rattacher un support, simuler un
 * rachat) reste accessible, repliée en bas de page. Elle n'est pas supprimée :
 * c'est le seul endroit d'où l'on déclare un contrat, et une vue d'ensemble
 * sans moyen de créer ce qu'elle résume serait une impasse.
 */

/**
 * Ancre du repli. L'état vit dans l'URL et non dans le composant : un
 * rafraîchissement au milieu d'une saisie ne doit pas refermer la section, et
 * le lien se partage tel quel.
 */
const MANAGE_HASH = "#gestion";

export function AssuranceVieTab({ className }: { className?: string }) {
  const [manageOpen, setManageOpen] = useState(false);

  // Le compte des contrats appartient au titre — la même requête sert la vue
  // d'ensemble juste en dessous, React Query ne la lance donc qu'une fois.
  const policiesQ = useQuery({
    queryKey: ["life-insurance"],
    queryFn: () => fetchJson<{ policies: unknown[] }>("/api/life-insurance"),
  });
  const contractCount = policiesQ.data?.policies?.length ?? null;

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
    // Laisser le repli s'ouvrir avant de viser l'ancre.
    requestAnimationFrame(() => {
      const el = target
        ? document.querySelector(`[data-testid="${target}"]`)
        : document.getElementById("av-manage");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className={cn("min-w-0", className)} data-testid="assurance-vie-tab">
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="mb-[var(--space-4)] flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-[var(--space-3)] text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)] text-[var(--foreground)]">
            Assurance-vie
            {contractCount != null && (
              <span
                className="rounded-[var(--radius-sm)] bg-[var(--surface-sunken)] px-[var(--space-2)] py-[var(--space-px)] text-[length:var(--text-xs)] font-medium text-[var(--foreground-secondary)]"
                data-testid="av-contract-count"
              >
                {contractCount} contrat{contractCount > 1 ? "s" : ""}
              </span>
            )}
          </h1>
          <p className="text-meta mt-[var(--space-1)]">
            Vue d&apos;ensemble de votre épargne et de vos performances
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="outline"
            onClick={() => openManage()}
            data-testid="av-manage-open"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gérer les contrats
          </Button>
          <Button
            type="button"
            onClick={() => openManage("av-support-form")}
            data-testid="av-add-support"
          >
            <Plus className="h-3.5 w-3.5" />
            Verser
          </Button>
        </div>
      </header>

      {/* Onglet unique — conservé pour la lisibilité de la page, pas pour
          naviguer : il n'y a rien d'autre à atteindre. */}
      <div
        className="mb-[var(--gap-card)] border-b border-[var(--border)]"
        data-testid="av-tabs"
      >
        <span className="inline-block border-b-2 border-[var(--primary)] px-[var(--space-1)] pb-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[var(--primary-text)]">
          Vue d&apos;ensemble
        </span>
      </div>

      <AvOverview
        onManage={() => openManage()}
        onAddSupport={() => openManage("av-support-form")}
      />

      {/* ── Gestion des contrats (repliée) ──────────────────────── */}
      <section id="av-manage" className="mt-[var(--gap-card)]">
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
          data-testid="av-manage-toggle"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              manageOpen && "rotate-180"
            )}
            aria-hidden
          />
          Gestion des contrats — ouverture, versements, supports, simulation de
          rachat
        </button>

        {manageOpen && <AssuranceVieManagement />}
      </section>
    </div>
  );
}
