"use client";

/**
 * Deuxième étape après la création d'une plateforme sur un compte sans
 * journal — cf. `components/dashboard/first-operations-options.ts` pour la
 * décision « quelles options ».
 *
 * Pas un passage forcé : « Plus tard » ferme la fenêtre sans rien exiger, et
 * le plancher de contenu du tableau de bord (carte de tête + journal, D22)
 * reste la garantie de dernier recours si l'utilisateur ferme sans choisir.
 */

import { FilePlus2, FileUp, RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import {
  resolveFirstOperationsOptions,
  type FirstOperationsPlatformInput,
  type SyncableFirstPlatform,
} from "@/components/dashboard/first-operations-options";

function PathCard({
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
  primary?: boolean;
  testId: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col items-center gap-[var(--space-2)] rounded-[var(--radius-lg)]",
        "border border-[var(--border)] bg-[var(--card)] p-[var(--space-4)] text-center",
        primary && "border-[var(--gold-border)]"
      )}
      data-testid={testId}
    >
      <span className="text-[var(--primary-text)]" aria-hidden>
        {icon}
      </span>
      <h3 className="text-[length:var(--text-sm)] font-semibold text-[var(--foreground)]">
        {title}
      </h3>
      <p className="text-[length:var(--text-2xs)] leading-relaxed text-[var(--foreground-secondary)]">
        {description}
      </p>
      <Button
        type="button"
        variant={primary ? "default" : "outline"}
        size="sm"
        onClick={onClick}
        className="mt-[var(--space-1)] w-full"
        data-testid={`${testId}-cta`}
      >
        {cta}
      </Button>
    </section>
  );
}

export function FirstOperationsModal({
  open,
  platform,
  onClose,
  onAddTransaction,
  onImportCsv,
  onSync,
}: {
  open: boolean;
  /** Plateforme qui vient d'être créée — seule base de la décision « synchro ». */
  platform: FirstOperationsPlatformInput | null;
  onClose: () => void;
  onAddTransaction: () => void;
  onImportCsv: () => void;
  /** Reçoit la plateforme synchronisable — absent si aucune ne l'est. */
  onSync: (platform: SyncableFirstPlatform) => void;
}) {
  if (!open || !platform) return null;

  const options = resolveFirstOperationsOptions([platform]);

  return (
    <Modal
      title="Ajoutez vos premières opérations"
      onClose={onClose}
      testId="first-operations-modal"
      panelClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <p className="text-[length:var(--text-xs)] leading-relaxed text-[var(--foreground-secondary)]">
          « {platform.name} » est prête. Il ne lui manque que ses premières
          opérations pour nourrir le tableau de bord.
        </p>

        <div
          className={cn(
            "grid w-full gap-[var(--gap-card)]",
            options.sync ? "sm:grid-cols-3" : "sm:grid-cols-2"
          )}
        >
          <PathCard
            testId="first-operations-manual"
            primary
            icon={<FilePlus2 className="h-5 w-5" />}
            title="Saisie manuelle"
            description="Un achat, un versement, une opération à la fois."
            cta="Ajouter une transaction"
            onClick={onAddTransaction}
          />
          <PathCard
            testId="first-operations-csv"
            icon={<FileUp className="h-5 w-5" />}
            title="Import CSV"
            description="Un relevé de courtier ou de banque, importé d'un coup."
            cta="Importer un fichier"
            onClick={onImportCsv}
          />
          {options.sync && (
            <PathCard
              testId="first-operations-sync"
              icon={<RefreshCw className="h-5 w-5" />}
              title={`Synchronisation · ${options.sync.chainLabel}`}
              description={options.sync.description}
              cta="Connecter le wallet"
              onClick={() => onSync(options.sync!)}
            />
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="first-operations-later"
          >
            Plus tard
          </Button>
        </div>
      </div>
    </Modal>
  );
}
