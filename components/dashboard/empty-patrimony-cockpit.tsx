"use client";

/**
 * Cockpit d'accueil — l'état visuel du compte tant qu'aucune donnée
 * patrimoniale n'existe.
 *
 * Ce n'est **pas** un onboarding : ni étapes, ni progression, ni checklist, ni
 * questionnaire, ni bouton « j'ai terminé ». L'écran précédent affichait
 * « 0 / 3 étapes » et une barre de progression, ce qui promettait un parcours
 * là où il n'y a qu'un choix : connecter une plateforme, ou saisir une
 * première opération. Dès qu'une donnée existe, cet écran disparaît de
 * lui-même — personne n'a à le refermer.
 *
 * Aucun chiffre n'y figure. Pas de patrimoine à 0 €, pas de courbe vide, pas
 * d'allocation fictive : un compte sans données n'a rien à afficher, et le
 * prétendre serait la première chose fausse que l'application dirait.
 */

import { Building2, FileUp, FilePlus2, LineChart, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { BRAND } from "@/components/branding/brand-assets";

/** Une des deux actions principales. */
function ActionCard({
  icon,
  title,
  description,
  cta,
  onClick,
  primary,
  testId,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  /** Légèrement mise en avant : elle rapatrie les données existantes. */
  primary?: boolean;
  testId: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col items-center gap-[var(--space-3)] rounded-[var(--radius-lg)]",
        "border border-[var(--border)] bg-[var(--card)] p-[var(--space-6)] text-center",
        primary && "border-[var(--gold-border)]"
      )}
      data-testid={testId}
    >
      <span
        className="text-[var(--primary-text)]"
        aria-hidden
      >
        {icon}
      </span>
      <h2 className="text-[length:var(--text-base)] font-semibold text-[var(--foreground)]">
        {title}
      </h2>
      <p className="max-w-[22rem] text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]">
        {description}
      </p>
      <Button
        type="button"
        variant={primary ? "default" : "outline"}
        onClick={onClick}
        className="mt-[var(--space-1)]"
        data-testid={`${testId}-cta`}
      >
        {cta}
      </Button>
    </section>
  );
}

/** Un des trois repères de valeur — texte seul, jamais une carte. */
function ValuePoint({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <li className="flex min-w-0 items-start gap-[var(--space-3)]">
      <span className="mt-[var(--space-px)] shrink-0 text-[var(--foreground-faint)]" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[length:var(--text-xs)] font-medium text-[var(--foreground)]">
          {title}
        </span>
        <span className="block text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
          {detail}
        </span>
      </span>
    </li>
  );
}

export function EmptyPatrimonyCockpit({
  onAddPlatform,
  onAddTransaction,
  onImport,
  className,
}: {
  onAddPlatform: () => void;
  onAddTransaction: () => void;
  /**
   * Import de fichier — lien discret, jamais une troisième carte. Absent, la
   * ligne ne s'affiche pas plutôt que de proposer un chemin qui n'existe pas.
   */
  onImport?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col items-center",
        "gap-[var(--space-6)] py-[var(--space-10)] text-center",
        className
      )}
      data-testid="empty-patrimony-cockpit"
    >
      <header className="flex flex-col items-center gap-[var(--space-2)]">
        <p className="text-label">Votre cockpit</p>
        <h1 className="text-[length:var(--text-3xl)] font-semibold tracking-[var(--tracking-tight)] text-[var(--foreground)]">
          Bienvenue dans {BRAND.name}
        </h1>
        <p className="text-[length:var(--text-sm)] text-[var(--foreground-secondary)]">
          Votre terminal patrimonial intelligent
        </p>
      </header>

      <p className="max-w-[34rem] text-[length:var(--text-sm)] leading-relaxed text-[var(--foreground-secondary)]">
        {BRAND.name} vous aide à piloter votre patrimoine simplement.
        <br />
        Commencez par connecter vos comptes ou ajouter votre première
        transaction.
      </p>

      <div className="w-full">
        <p className="text-label mb-[var(--space-3)]">Par où commencer ?</p>
        <div className="grid w-full gap-[var(--gap-card)] sm:grid-cols-2">
          <ActionCard
            testId="cockpit-platform"
            primary
            icon={<Building2 className="h-6 w-6" />}
            title="Connectez une plateforme"
            description="Importez automatiquement vos comptes et vos transactions."
            cta="Ajouter une plateforme"
            onClick={onAddPlatform}
          />
          <ActionCard
            testId="cockpit-transaction"
            icon={<FilePlus2 className="h-6 w-6" />}
            title="Ajoutez votre 1ʳᵉ transaction"
            description="Saisissez manuellement un achat, un versement ou toute autre opération."
            cta="Ajouter une transaction"
            onClick={onAddTransaction}
          />
        </div>

        {onImport ? (
          <button
            type="button"
            onClick={onImport}
            className={cn(
              "mt-[var(--space-4)] inline-flex items-center gap-[var(--space-2)]",
              "text-[length:var(--text-xs)] text-[var(--foreground-secondary)]",
              "transition-[color] hover:text-[var(--foreground)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            )}
            data-testid="cockpit-import"
          >
            <FileUp className="h-3.5 w-3.5" aria-hidden />
            Ou importer un fichier
          </button>
        ) : null}
      </div>

      <ul className="grid w-full gap-[var(--space-4)] border-t border-[var(--border)] pt-[var(--space-5)] text-left sm:grid-cols-3">
        <ValuePoint
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Vos données restent privées"
          detail="Stockées sur votre compte, jamais revendues."
        />
        <ValuePoint
          icon={<LineChart className="h-4 w-4" />}
          title="Analyse claire"
          detail="Valeur, performance et fiscalité au même endroit."
        />
        <ValuePoint
          icon={<RefreshCw className="h-4 w-4" />}
          title="Tout au même endroit"
          detail="Bourse, crypto, immobilier, banques et alternatifs."
        />
      </ul>
    </div>
  );
}
