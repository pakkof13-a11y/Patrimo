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
  const [addOpen, setAddOpen] = useState(false);

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

    /*
      Attendre que l'ancre existe, pas qu'une frame passe.

      Le repli ne monte son contenu qu'après le rendu de React, et une seule
      `requestAnimationFrame` ne le garantit pas : `querySelector` rendait
      `null`, `scrollIntoView` s'appliquait à rien, et la page ne bougeait pas.
      Le panneau s'ouvrait sans jamais être montré — le défaut se voyait sur le
      simulateur de rachat, monté plus bas que le formulaire de contrat.

      L'attente se compte en **temps**, pas en frames : le simulateur de rachat
      ne se rend qu'une fois ses contrats et ses supports chargés, ce qui prend
      bien plus que les quelques frames suffisantes à un formulaire statique.
      Une demi-seconde d'attente expliquait pourquoi « un contrat » défilait et
      « un rachat » non.

      Le budget reste borné : mieux vaut ne pas défiler que de boucler
      indéfiniment si la cible n'apparaît jamais.
    */
    const limite = Date.now() + 4_000;
    const viser = () => {
      const el = target
        ? document.querySelector(`[data-testid="${target}"]`)
        : document.getElementById("av-manage");
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (Date.now() < limite) requestAnimationFrame(viser);
    };
    requestAnimationFrame(viser);
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

        <div className="relative flex shrink-0 flex-wrap items-center gap-[var(--space-2)]">
          <Button
            type="button"
            variant="ghost"
            onClick={() => openManage()}
            data-testid="av-manage-open"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Gérer
          </Button>

          <Button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            aria-haspopup="menu"
            data-testid="av-add-open"
          >
            <Plus className="h-3.5 w-3.5" />
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
                className="absolute right-0 top-full z-50 mt-[var(--space-1)] min-w-[13rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] py-[var(--space-1)] shadow-[var(--shadow-lg)]"
                data-testid="av-add-menu"
              >
                {(
                  [
                    /*
                      Le verbe est déjà porté par le bouton « Ajouter » qui
                      ouvre ce menu : le répéter dans chaque entrée donnait
                      « Ajouter › Ouvrir un contrat ». Ne reste que le
                      complément d'objet, et la phrase se lit d'un trait.
                    */
                    ["av-contract-form", "un contrat"],
                    ["av-support-form", "un support"],
                    /*
                      Le simulateur porte déjà son identifiant : viser un nom
                      inventé (`av-redemption-form`) ne trouvait rien, et le
                      défilement ne se faisait pas.
                    */
                    ["av-redemption-simulator", "un rachat"],
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
                    data-testid={`av-add-${target}`}
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
        Plus d'onglet unique décoratif.

        La page affichait un « Vue d'ensemble » souligné qui ne menait nulle
        part : une navigation à un seul élément n'est pas une navigation. Les
        vues réelles — allocation, performances, versements, frais — sont
        portées par la barre segmentée de `AvOverview`, où elles changent
        effectivement le contenu.
      */}
      <AvOverview />

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
