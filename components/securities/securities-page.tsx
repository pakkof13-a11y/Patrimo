"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SecuritiesOverview } from "@/components/securities/securities-overview";
import { SecuritiesTab } from "@/components/securities/securities-tab";
import { cn } from "@/app/lib/utils";

/**
 * Écran PEA & CTO.
 *
 * Un onglet et un seul : « Vue d'ensemble ». Tout ce qui relevait d'une
 * navigation secondaire a disparu — la page se lit d'un bloc.
 *
 * La gestion des comptes (ouverture, versements, rattachement des lignes)
 * reste accessible mais repliée. Elle n'est pas supprimée : c'est le seul
 * endroit d'où l'on déclare un compte, et une vue d'ensemble sans moyen de
 * créer ce qu'elle résume serait une impasse. Elle n'a simplement plus à
 * occuper le premier écran.
 */

/**
 * Ancre du repli. L'état vit dans l'URL et non dans le composant : un
 * rafraîchissement au milieu d'une saisie de versement ne doit pas refermer
 * la section, et le lien peut se partager tel quel.
 */
const MANAGE_HASH = "#gestion";

export function SecuritiesPage({ className }: { className?: string }) {
  const router = useRouter();
  const [manageOpen, setManageOpen] = useState(false);

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

  function openPositions(envelopeType: string) {
    // Le portefeuille sait filtrer par enveloppe via l'URL : réutiliser ce
    // chemin plutôt que d'en inventer un second qui divergerait.
    const target = envelopeType
      ? `/positions?envelope=${encodeURIComponent(envelopeType.toLowerCase())}`
      : "/positions";
    router.push(target);
  }

  function openManage() {
    setManage(true);
    // Laisser le repli s'ouvrir avant de viser l'ancre.
    requestAnimationFrame(() => {
      document
        .getElementById("securities-manage")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div className={cn("min-w-0", className)} data-testid="securities-page">
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="mb-[var(--space-4)] flex flex-wrap items-start justify-between gap-[var(--space-4)]">
        <div className="min-w-0">
          <h1 className="text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)] text-[var(--foreground)]">
            PEA &amp; CTO
            <span className="text-[var(--foreground-faint)]"> — Vue d&apos;ensemble</span>
          </h1>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="outline"
            onClick={openManage}
            data-testid="securities-manage-open"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gérer les comptes
          </Button>
          <Button type="button" onClick={openManage} data-testid="securities-add-account">
            <Plus className="h-3.5 w-3.5" />
            Ouvrir un compte
          </Button>
        </div>
      </header>

      {/* Onglet unique — conservé pour la lisibilité de la page, pas pour
          naviguer : il n'y a rien d'autre à atteindre. */}
      <div
        className="mb-[var(--gap-card)] border-b border-[var(--border)]"
        data-testid="securities-tabs"
      >
        <span className="inline-block border-b-2 border-[var(--primary)] px-[var(--space-1)] pb-[var(--space-2)] text-[length:var(--text-sm)] font-medium text-[var(--primary-text)]">
          Vue d&apos;ensemble
        </span>
      </div>

      <SecuritiesOverview
        onOpenPositions={openPositions}
        onManageAccounts={openManage}
      />

      {/* ── Gestion des comptes (repliée) ───────────────────────── */}
      <section id="securities-manage" className="mt-[var(--gap-card)]">
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
          data-testid="securities-manage-toggle"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              manageOpen && "rotate-180"
            )}
            aria-hidden
          />
          Gestion des comptes — ouverture, versements, rattachement des lignes
        </button>

        {manageOpen && <SecuritiesTab className="mt-[var(--space-3)]" />}
      </section>
    </div>
  );
}
