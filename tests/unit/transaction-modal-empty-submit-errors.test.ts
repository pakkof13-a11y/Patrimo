import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Journal → Nouvelle transaction → Achat → "Enregistrer" avec un formulaire
 * vide n'affichait aucun indice d'échec : seule l'erreur `platformId` était
 * branchée sur `Field`, alors que le schéma Zod (`createTransactionSchema`,
 * `app/lib/schemas.ts`) rejette aussi silencieusement `assetId`, `quantity`,
 * `unitPrice`, `cashAmount` et `occurredAt` selon le type d'opération — la
 * validation RHF/Zod bloquait déjà `onSubmit` (donc aucun POST), mais rien ne
 * le disait à l'utilisateur ni au lecteur d'écran.
 *
 * Pas de RTL/jsdom dans ce repo (voir `transaction-modal-fx-source.test.ts`) :
 * on verrouille sur le source réel que (1) chaque champ requis est bien
 * branché sur son message d'erreur RHF et que (2) un résumé accessible
 * (`role="alert"`) atterrit près du bouton Enregistrer pour les champs dont
 * le contrôle (combobox custom) ne peut pas recevoir le focus automatique de
 * `shouldFocusError`.
 */

const SOURCE = readFileSync(
  resolve(process.cwd(), "components/modals/transaction-modal.tsx"),
  "utf8"
);

describe("transaction-modal — feedback d'erreur sur soumission vide", () => {
  it.each([
    "platformId",
    "assetId",
    "quantity",
    "unitPrice",
    "cashAmount",
    "occurredAt",
  ])("branche error={...} sur formState.errors.%s", (field) => {
    expect(SOURCE).toContain(
      `error={form.formState.errors.${field}?.message as string | undefined}`
    );
  });

  it("affiche un résumé role=alert des erreurs après une tentative de soumission", () => {
    expect(SOURCE).toContain('data-testid="tx-form-errors"');
    expect(SOURCE).toContain("form.formState.submitCount > 0");
    // Le résumé ne doit apparaître qu'après une tentative de soumission,
    // sinon il polluerait un formulaire vide encore jamais soumis.
    const alertIdx = SOURCE.indexOf('data-testid="tx-form-errors"');
    const before = SOURCE.slice(Math.max(0, alertIdx - 400), alertIdx);
    expect(before).toContain('role="alert"');
  });

  it("ne modifie pas le chemin d'interception plateforme (find-or-create)", () => {
    // Le correctif ne doit pas toucher à la logique existante de résolution
    // de plateforme tapée-mais-non-sélectionnée (cf. commentaire dédié).
    expect(SOURCE).toContain("onRequestCreatePlatform?.(label)");
  });
});
