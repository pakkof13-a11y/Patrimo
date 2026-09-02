"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Modal } from "@/components/ui/modal";
import { fetchJson } from "@/app/lib/api-client";
import {
  PropertyCreateForm,
  type PropertyFormLoan,
} from "@/components/modals/property-create-form";

type LiabilityRow = {
  id: string;
  name: string;
  remainingAmount: string | number;
  assetId?: string | null;
};

/**
 * Conteneur du formulaire immobilier.
 *
 * Charge lui-même la liste des prêts rattachables plutôt que de la faire
 * descendre depuis le shell : ces données ne servent qu'ici, et les remonter
 * obligerait l'application entière à interroger les passifs pour un modal
 * qu'on n'ouvre presque jamais.
 */
export function PropertyModal({
  open,
  platformId,
  platformName,
  onClose,
  onCreated,
}: {
  open: boolean;
  platformId: string;
  platformName: string;
  onClose: () => void;
  onCreated?: (assetId: string) => void;
}) {
  const qc = useQueryClient();

  const loansQ = useQuery({
    queryKey: ["liabilities", "for-property"],
    enabled: open,
    staleTime: 60_000,
    queryFn: () => fetchJson<{ liabilities?: LiabilityRow[] }>("/api/liabilities"),
  });

  // Un prêt déjà rattaché à un bien n'est pas reproposé : le lier deux fois
  // ferait apparaître la même dette sous deux biens dans le net par bien.
  const loans: PropertyFormLoan[] = (loansQ.data?.liabilities ?? [])
    .filter((l) => !l.assetId)
    .map((l) => ({
      id: l.id,
      name: l.name,
      remainingAmountEur: String(l.remainingAmount ?? "0"),
    }));

  if (!open) return null;

  return (
    <Modal title="Ajouter un bien immobilier" onClose={onClose} wide layer={1}>
      <PropertyCreateForm
        platformId={platformId}
        platformName={platformName}
        loans={loans}
        onCancel={onClose}
        onCreated={(assetId) => {
          // Le bien entre au patrimoine par une transaction d'achat : tout ce
          // qui dérive du journal doit être réinterrogé.
          void qc.invalidateQueries({ queryKey: ["holdings"] });
          void qc.invalidateQueries({ queryKey: ["transactions"] });
          void qc.invalidateQueries({ queryKey: ["portfolio-history"] });
          void qc.invalidateQueries({ queryKey: ["liabilities"] });
          onCreated?.(assetId);
          onClose();
        }}
      />
    </Modal>
  );
}
