"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormWizard, type WizardStep } from "@/components/ui/form-wizard";
import { Field, FormSection } from "@/components/ui/field";
import {
  ACCESS_MODE_OPTIONS,
  CUSTODY_MODEL_OPTIONS,
  DEFI_POSITION_TYPE_OPTIONS,
  getDefiFieldHelpText,
  getDefiFieldLabel,
  getFieldsToResetOnChange,
  isDefiFieldRequired,
  isDefiFieldVisible,
  type DefiFieldId,
  type DefiFormRuleState,
} from "@/app/lib/crypto/defi-ui-rules";

type PlatformOption = { id: string; name: string; type: string | null };

type ExtraLegForm = { symbol: string; amount: string; entryPriceEur: string };

type WizardForm = {
  accessMode: "DEFI" | "HYBRID" | "CEFI";
  custodyModel: string;
  platformId: string;
  ownerLabel: string;
  ownershipPct: string;
  positionType: string;
  chain: string;
  protocol: string;
  protocolVersion: string;
  underlyingProtocol: string;
  marketRef: string;
  vaultRef: string;
  poolRef: string;
  validatorName: string;
  nftPositionRef: string;
  assetSymbol: string;
  quantity: string;
  unitPriceEur: string;
  openedAt: string;
  // LP
  pairedSymbol: string;
  pairedAmount: string;
  pairedEntryPriceEur: string;
  extraLegs: ExtraLegForm[];
  isConcentrated: boolean;
  priceRangeMin: string;
  priceRangeMax: string;
  // Borrowing
  collateralSymbol: string;
  collateralQuantity: string;
  collateralUnitPriceEur: string;
  healthFactor: string;
  ltvPct: string;
  liqThresholdPct: string;
  // Restaking
  pointsAmount: string;
  // Lock
  lockEnabled: boolean;
  unlockAt: string;
  // Yield
  apyPct: string;
  rewardsSymbol: string;
  rewardsAmount: string;
  rewardsValueEur: string;
  notes: string;
};

function emptyForm(): WizardForm {
  return {
    accessMode: "DEFI",
    custodyModel: "SELF_CUSTODY",
    platformId: "",
    ownerLabel: "",
    ownershipPct: "100",
    positionType: "STAKING",
    chain: "",
    protocol: "",
    protocolVersion: "",
    underlyingProtocol: "",
    marketRef: "",
    vaultRef: "",
    poolRef: "",
    validatorName: "",
    nftPositionRef: "",
    assetSymbol: "",
    quantity: "",
    unitPriceEur: "",
    openedAt: new Date().toISOString().slice(0, 10),
    pairedSymbol: "",
    pairedAmount: "",
    pairedEntryPriceEur: "",
    extraLegs: [],
    isConcentrated: false,
    priceRangeMin: "",
    priceRangeMax: "",
    collateralSymbol: "",
    collateralQuantity: "",
    collateralUnitPriceEur: "",
    healthFactor: "",
    ltvPct: "",
    liqThresholdPct: "",
    pointsAmount: "",
    lockEnabled: false,
    unlockAt: "",
    apyPct: "",
    rewardsSymbol: "",
    rewardsAmount: "",
    rewardsValueEur: "",
    notes: "",
  };
}

function ruleState(f: WizardForm): DefiFormRuleState {
  return {
    accessMode: f.accessMode,
    positionType: f.positionType,
    isConcentrated: f.isConcentrated,
    lockEnabled: f.lockEnabled,
  };
}

const STEPS: WizardStep[] = [
  { id: "access", label: "Mode d'accès", description: "DeFi, hybride ou CeFi — et qui garde les clés" },
  { id: "source", label: "Détention", description: "Wallet ou plateforme, détenteur et quote-part" },
  { id: "type", label: "Type", description: "Nature de la position et contexte protocolaire" },
  { id: "infra", label: "Infrastructure", description: "Marché, pool, vault ou validateur" },
  { id: "exposure", label: "Exposition", description: "Ce qui est réellement engagé" },
  { id: "valuation", label: "Valorisation", description: "Comment cette position sera valorisée" },
  { id: "risk", label: "Risque", description: "Verrouillage, dette et seuils" },
  { id: "rewards", label: "Rewards", description: "Récompenses et notes" },
  { id: "summary", label: "Récapitulatif", description: "Vérifiez avant d'enregistrer" },
];

/**
 * Formulaire d'ajout d'une position DeFi / CeFi / CeDeFi — 9 étapes,
 * divulgation progressive stricte pilotée par `defi-ui-rules.ts`.
 *
 * Aucune condition sur `accessMode`/`positionType` n'est écrite ici : chaque
 * champ appelle `isDefiFieldVisible`/`isDefiFieldRequired`, qui sont la seule
 * source de vérité — modifier une règle se fait dans un fichier, jamais dans
 * ce JSX.
 */
export function DefiPositionForm({
  platforms,
  onClose,
  onCreated,
}: {
  platforms: PlatformOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<WizardForm>(emptyForm());
  const [step, setStep] = useState(0);
  const [pendingAccessMode, setPendingAccessMode] = useState<WizardForm["accessMode"] | null>(null);
  const [pendingPositionType, setPendingPositionType] = useState<string | null>(null);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const rules = ruleState(form);
  const visible = (id: DefiFieldId) => isDefiFieldVisible(id, rules);
  const required = (id: DefiFieldId) => isDefiFieldRequired(id, rules);
  const label = (id: DefiFieldId) => getDefiFieldLabel(id, rules);
  const help = (id: DefiFieldId) => getDefiFieldHelpText(id, rules);

  /** Reset en cascade — appelé après confirmation pour accessMode/positionType. */
  function applyReset(field: DefiFieldId, base: WizardForm): WizardForm {
    const toReset = new Set(getFieldsToResetOnChange(field));
    if (toReset.size === 0) return base;
    const empty = emptyForm();
    const next = { ...base };
    for (const key of toReset) {
      (next as Record<string, unknown>)[key] = (empty as Record<string, unknown>)[key];
    }
    return next;
  }

  function changeAccessMode(next: WizardForm["accessMode"]) {
    const hasFilledDependents = form.platformId || form.chain || form.protocol;
    if (hasFilledDependents && next !== form.accessMode) {
      setPendingAccessMode(next);
      return;
    }
    setForm((f) => applyReset("accessMode", { ...f, accessMode: next }));
  }

  function changePositionType(next: string) {
    const hasFilledDependents =
      form.pairedSymbol || form.collateralSymbol || form.marketRef || form.vaultRef;
    if (hasFilledDependents && next !== form.positionType) {
      setPendingPositionType(next);
      return;
    }
    setForm((f) => applyReset("positionType", { ...f, positionType: next }));
  }

  const filteredPlatforms = platforms.filter((p) =>
    form.accessMode === "DEFI" ? p.type === "BLOCKCHAIN" : p.type !== "BLOCKCHAIN"
  );

  const create = useMutation({
    mutationFn: async () => {
      const isLp = form.positionType === "LP";
      const isBorrowing = form.positionType === "BORROWING";
      const isRestaking = form.positionType === "RESTAKING";

      const legs: Array<Record<string, unknown>> = [];
      if (isBorrowing && form.collateralSymbol.trim()) {
        legs.push({
          legType: "COLLATERAL",
          symbol: form.collateralSymbol.trim(),
          quantity: form.collateralQuantity,
          unitCostEur: form.collateralUnitPriceEur || null,
        });
      }
      // LP : les jetons au-delà du premier sont traduits en jambes UNDERLYING
      // pour que la nouvelle décomposition de valorisation les compte —
      // transparent pour l'utilisateur, aucun champ supplémentaire.
      if (isLp && form.pairedSymbol.trim()) {
        legs.push({
          legType: "UNDERLYING",
          symbol: form.pairedSymbol.trim(),
          quantity: form.pairedAmount,
          unitCostEur: form.pairedEntryPriceEur || null,
        });
        for (const leg of form.extraLegs) {
          if (!leg.symbol.trim()) continue;
          legs.push({
            legType: "UNDERLYING",
            symbol: leg.symbol.trim(),
            quantity: leg.amount,
            unitCostEur: leg.entryPriceEur || null,
          });
        }
      }

      const rewards: Array<Record<string, unknown>> = [];
      if (form.rewardsSymbol.trim()) {
        rewards.push({
          symbol: form.rewardsSymbol.trim(),
          rewardType: "YIELD",
          accruedQuantity: form.rewardsAmount || null,
          valueEur: form.rewardsValueEur || null,
        });
      }
      if (isRestaking && form.pointsAmount.trim()) {
        rewards.push({
          symbol: "POINTS",
          rewardType: "POINTS",
          accruedQuantity: form.pointsAmount,
        });
      }

      const body = {
        platformId: form.platformId,
        assetSymbol: form.assetSymbol,
        protocol: form.protocol,
        positionType: form.positionType,
        chain: form.chain || null,
        quantity: form.quantity,
        unitPriceEur: form.unitPriceEur,
        openedAt: form.openedAt,
        apyPct: form.apyPct || null,
        rewardsSymbol: form.rewardsSymbol || null,
        rewardsAmount: form.rewardsAmount || null,
        rewardsValueEur: form.rewardsValueEur || null,
        healthFactor: isBorrowing ? form.healthFactor || null : null,
        ltvPct: isBorrowing ? form.ltvPct || null : null,
        liqThresholdPct: isBorrowing ? form.liqThresholdPct || null : null,
        unlockAt: form.lockEnabled && form.unlockAt ? form.unlockAt : null,

        accessMode: form.accessMode,
        custodyModel: form.custodyModel,
        ownerLabel: form.ownerLabel || null,
        ownershipPct: form.ownershipPct || "100",
        protocolVersion: form.protocolVersion || null,
        underlyingProtocol: form.underlyingProtocol || null,
        marketRef: form.marketRef || null,
        vaultRef: form.vaultRef || null,
        poolRef: form.poolRef || null,
        validatorName: form.validatorName || null,
        nftPositionRef: form.nftPositionRef || null,
        notes: form.notes || null,
        legs: legs.length > 0 ? legs : null,
        rewards: rewards.length > 0 ? rewards : null,

        ...(isLp
          ? {
              pairedSymbol: form.pairedSymbol,
              pairedAmount: form.pairedAmount,
              pairedEntryPriceEur: form.pairedEntryPriceEur,
              extraLegs: form.extraLegs
                .filter((l) => l.symbol.trim())
                .map((l) => ({ symbol: l.symbol, amount: l.amount, entryPriceEur: l.entryPriceEur })),
              isConcentrated: form.isConcentrated,
              priceRangeMin: form.isConcentrated ? form.priceRangeMin : null,
              priceRangeMax: form.isConcentrated ? form.priceRangeMax : null,
            }
          : {}),
      };

      return fetchJson("/api/crypto/defi/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      toast.success("Position enregistrée");
      void qc.invalidateQueries({ queryKey: ["crypto-defi-portfolio"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function validateStep(index: number): boolean {
    const id = STEPS[index]?.id;
    const missing: string[] = [];
    const check = (field: DefiFieldId, value: unknown) => {
      if (!required(field)) return;
      if (value == null || value === "") missing.push(label(field));
    };

    if (id === "access") {
      check("accessMode", form.accessMode);
    } else if (id === "source") {
      check("platformId", form.platformId);
      check("ownershipPct", form.ownershipPct);
    } else if (id === "type") {
      check("positionType", form.positionType);
      check("chain", form.chain);
      check("protocol", form.protocol);
    } else if (id === "exposure") {
      check("assetSymbol", form.assetSymbol);
      check("quantity", form.quantity);
      check("unitPriceEur", form.unitPriceEur);
      check("pairedSymbol", form.pairedSymbol);
      check("pairedAmount", form.pairedAmount);
      check("pairedEntryPriceEur", form.pairedEntryPriceEur);
      check("priceRangeMin", form.priceRangeMin);
      check("priceRangeMax", form.priceRangeMax);
      check("collateralSymbol", form.collateralSymbol);
      check("collateralQuantity", form.collateralQuantity);
      check("collateralUnitPriceEur", form.collateralUnitPriceEur);
    } else if (id === "risk") {
      check("unlockAt", form.unlockAt);
    }

    if (missing.length > 0) {
      toast.error(`Champ requis manquant : ${missing.join(", ")}`);
      return false;
    }
    return true;
  }

  return (
    <>
      <Modal
        title="Ajouter une position DeFi"
        onClose={onClose}
        panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]"
        testId="defi-form-modal"
      >
        <FormWizard
          steps={STEPS}
          current={step}
          onStepChange={setStep}
          onValidateStep={validateStep}
          submitLabel="Enregistrer la position"
          submitPending={create.isPending}
          submitDisabled={create.isPending}
          onSubmit={() => create.mutate()}
          onCancel={onClose}
          testId="defi-wizard"
        >
          {STEPS[step]?.id === "access" && (
            <FormSection title="Mode d'accès et garde" step={1}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={label("accessMode")} htmlFor="defi-access-mode" hint={help("accessMode")}>
                  <select
                    id="defi-access-mode"
                    className="input mt-1 w-full"
                    value={form.accessMode}
                    onChange={(e) => changeAccessMode(e.target.value as WizardForm["accessMode"])}
                    data-testid="defi-w-access-mode"
                  >
                    {ACCESS_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label("custodyModel")} htmlFor="defi-custody" optional>
                  <select
                    id="defi-custody"
                    className="input mt-1 w-full"
                    value={form.custodyModel}
                    onChange={(e) => set("custodyModel", e.target.value)}
                    data-testid="defi-w-custody"
                  >
                    {CUSTODY_MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "source" && (
            <FormSection title="Source de détention" step={2}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={label("platformId")} htmlFor="defi-platform" hint={help("platformId")}>
                  <select
                    id="defi-platform"
                    className="input mt-1 w-full"
                    value={form.platformId}
                    onChange={(e) => set("platformId", e.target.value)}
                    data-testid="defi-w-platform"
                  >
                    <option value="">— choisir —</option>
                    {filteredPlatforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {filteredPlatforms.length === 0 && (
                    <p className="text-meta mt-1" data-testid="defi-w-platform-empty-hint">
                      {form.accessMode === "DEFI"
                        ? "Aucun wallet enregistré — ajoutez-en un depuis « Mes plateformes », ou passez en mode Hybride/CeFi si la position est détenue via une plateforme centralisée."
                        : "Aucune plateforme de ce type enregistrée — ajoutez-en une depuis « Mes plateformes », ou passez en mode DeFi directe si la position est détenue via un wallet."}
                    </p>
                  )}
                </Field>
                <Field label={label("ownershipPct")} htmlFor="defi-ownership" hint={help("ownershipPct")}>
                  <input
                    id="defi-ownership"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.ownershipPct}
                    onChange={(e) => set("ownershipPct", e.target.value)}
                    data-testid="defi-w-ownership"
                  />
                </Field>
                <Field label={label("ownerLabel")} htmlFor="defi-owner" optional className="sm:col-span-2">
                  <input
                    id="defi-owner"
                    className="input mt-1 w-full"
                    placeholder="SCI Dupont, holding familiale…"
                    value={form.ownerLabel}
                    onChange={(e) => set("ownerLabel", e.target.value)}
                    data-testid="defi-w-owner"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "type" && (
            <FormSection title="Type de position" step={3}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={label("positionType")} htmlFor="defi-position-type">
                  <select
                    id="defi-position-type"
                    className="input mt-1 w-full"
                    value={form.positionType}
                    onChange={(e) => changePositionType(e.target.value)}
                    data-testid="defi-w-position-type"
                  >
                    {DEFI_POSITION_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {visible("chain") && (
                  <Field label={label("chain")} htmlFor="defi-chain">
                    <input
                      id="defi-chain"
                      className="input mt-1 w-full"
                      placeholder="ethereum, solana…"
                      value={form.chain}
                      onChange={(e) => set("chain", e.target.value)}
                      data-testid="defi-w-chain"
                    />
                  </Field>
                )}
                {visible("protocol") && (
                  <Field label={label("protocol")} htmlFor="defi-protocol" hint={help("protocol")}>
                    <input
                      id="defi-protocol"
                      className="input mt-1 w-full"
                      placeholder="Aave, Lido, Uniswap…"
                      value={form.protocol}
                      onChange={(e) => set("protocol", e.target.value)}
                      data-testid="defi-w-protocol"
                    />
                  </Field>
                )}
                {visible("protocolVersion") && (
                  <Field label={label("protocolVersion")} htmlFor="defi-protocol-version" optional>
                    <input
                      id="defi-protocol-version"
                      className="input mt-1 w-full"
                      placeholder="v3"
                      value={form.protocolVersion}
                      onChange={(e) => set("protocolVersion", e.target.value)}
                      data-testid="defi-w-protocol-version"
                    />
                  </Field>
                )}
                {visible("underlyingProtocol") && (
                  <Field
                    label={label("underlyingProtocol")}
                    htmlFor="defi-underlying-protocol"
                    optional
                    hint={help("underlyingProtocol")}
                  >
                    <input
                      id="defi-underlying-protocol"
                      className="input mt-1 w-full"
                      placeholder="Laisser vide si non divulgué"
                      value={form.underlyingProtocol}
                      onChange={(e) => set("underlyingProtocol", e.target.value)}
                      data-testid="defi-w-underlying-protocol"
                    />
                  </Field>
                )}
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "infra" && (
            <FormSection title="Infrastructure" step={4}>
              <div className="grid gap-2 sm:grid-cols-2">
                {visible("marketRef") && (
                  <Field label={label("marketRef")} htmlFor="defi-market" optional>
                    <input
                      id="defi-market"
                      className="input mt-1 w-full"
                      value={form.marketRef}
                      onChange={(e) => set("marketRef", e.target.value)}
                      data-testid="defi-w-market"
                    />
                  </Field>
                )}
                {visible("poolRef") && (
                  <Field label={label("poolRef")} htmlFor="defi-pool" optional>
                    <input
                      id="defi-pool"
                      className="input mt-1 w-full"
                      value={form.poolRef}
                      onChange={(e) => set("poolRef", e.target.value)}
                      data-testid="defi-w-pool"
                    />
                  </Field>
                )}
                {visible("vaultRef") && (
                  <Field label={label("vaultRef")} htmlFor="defi-vault" optional>
                    <input
                      id="defi-vault"
                      className="input mt-1 w-full"
                      placeholder="Yearn — stratégie delta-neutre…"
                      value={form.vaultRef}
                      onChange={(e) => set("vaultRef", e.target.value)}
                      data-testid="defi-w-vault"
                    />
                  </Field>
                )}
                {visible("validatorName") && (
                  <Field label={label("validatorName")} htmlFor="defi-validator" optional>
                    <input
                      id="defi-validator"
                      className="input mt-1 w-full"
                      value={form.validatorName}
                      onChange={(e) => set("validatorName", e.target.value)}
                      data-testid="defi-w-validator"
                    />
                  </Field>
                )}
                {visible("nftPositionRef") && (
                  <Field label={label("nftPositionRef")} htmlFor="defi-nft-ref" optional>
                    <input
                      id="defi-nft-ref"
                      className="input mt-1 w-full"
                      placeholder="Uniswap V3 #12345"
                      value={form.nftPositionRef}
                      onChange={(e) => set("nftPositionRef", e.target.value)}
                      data-testid="defi-w-nft-ref"
                    />
                  </Field>
                )}
                {!visible("marketRef") &&
                  !visible("poolRef") &&
                  !visible("vaultRef") &&
                  !visible("validatorName") && (
                    <p className="text-meta sm:col-span-2">
                      Aucune infrastructure spécifique pour cette nature de position.
                    </p>
                  )}
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "exposure" && (
            <FormSection title="Exposition économique" step={5}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={label("assetSymbol")} htmlFor="defi-symbol" hint={help("assetSymbol")}>
                  <input
                    id="defi-symbol"
                    className="input mt-1 w-full"
                    value={form.assetSymbol}
                    onChange={(e) => set("assetSymbol", e.target.value)}
                    data-testid="defi-w-symbol"
                  />
                </Field>
                <Field label={label("quantity")} htmlFor="defi-quantity">
                  <input
                    id="defi-quantity"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.quantity}
                    onChange={(e) => set("quantity", e.target.value)}
                    data-testid="defi-w-quantity"
                  />
                </Field>
                <Field label={label("unitPriceEur")} htmlFor="defi-unit-price" hint={help("unitPriceEur")}>
                  <input
                    id="defi-unit-price"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.unitPriceEur}
                    onChange={(e) => set("unitPriceEur", e.target.value)}
                    data-testid="defi-w-unit-price"
                  />
                </Field>
                <Field label="Date d'engagement" htmlFor="defi-opened-at">
                  <input
                    id="defi-opened-at"
                    type="date"
                    className="input mt-1 w-full"
                    value={form.openedAt}
                    onChange={(e) => set("openedAt", e.target.value)}
                    data-testid="defi-w-opened-at"
                  />
                </Field>
              </div>

              {visible("pairedSymbol") && (
                <div
                  className="mt-3 space-y-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/10 p-2.5"
                  data-testid="defi-w-lp-section"
                >
                  <p className="text-label">Second jeton de la paire</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label={label("pairedSymbol")} htmlFor="defi-paired-symbol">
                      <input
                        id="defi-paired-symbol"
                        className="input mt-1 w-full"
                        value={form.pairedSymbol}
                        onChange={(e) => set("pairedSymbol", e.target.value)}
                        data-testid="defi-w-paired-symbol"
                      />
                    </Field>
                    <Field label={label("pairedAmount")} htmlFor="defi-paired-amount">
                      <input
                        id="defi-paired-amount"
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={form.pairedAmount}
                        onChange={(e) => set("pairedAmount", e.target.value)}
                        data-testid="defi-w-paired-amount"
                      />
                    </Field>
                    <Field
                      label={label("pairedEntryPriceEur")}
                      htmlFor="defi-paired-entry"
                      hint={help("pairedEntryPriceEur")}
                    >
                      <input
                        id="defi-paired-entry"
                        inputMode="decimal"
                        className="input mt-1 w-full"
                        value={form.pairedEntryPriceEur}
                        onChange={(e) => set("pairedEntryPriceEur", e.target.value)}
                        data-testid="defi-w-paired-entry"
                      />
                    </Field>
                  </div>

                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={form.isConcentrated}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setForm((f) => applyReset("isConcentrated", { ...f, isConcentrated: checked }));
                      }}
                      data-testid="defi-w-concentrated"
                    />
                    {getDefiFieldHelpText("isConcentrated", rules) ?? "Liquidité concentrée"}
                  </label>

                  {form.isConcentrated && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field label={label("priceRangeMin")} htmlFor="defi-range-min">
                        <input
                          id="defi-range-min"
                          inputMode="decimal"
                          className="input mt-1 w-full"
                          value={form.priceRangeMin}
                          onChange={(e) => set("priceRangeMin", e.target.value)}
                          data-testid="defi-w-range-min"
                        />
                      </Field>
                      <Field label={label("priceRangeMax")} htmlFor="defi-range-max">
                        <input
                          id="defi-range-max"
                          inputMode="decimal"
                          className="input mt-1 w-full"
                          value={form.priceRangeMax}
                          onChange={(e) => set("priceRangeMax", e.target.value)}
                          data-testid="defi-w-range-max"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              {visible("collateralSymbol") && (
                <div
                  className="mt-3 grid gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/10 p-2.5 sm:grid-cols-3"
                  data-testid="defi-w-borrowing-section"
                >
                  <Field label={label("collateralSymbol")} htmlFor="defi-collateral-symbol">
                    <input
                      id="defi-collateral-symbol"
                      className="input mt-1 w-full"
                      value={form.collateralSymbol}
                      onChange={(e) => set("collateralSymbol", e.target.value)}
                      data-testid="defi-w-collateral-symbol"
                    />
                  </Field>
                  <Field label={label("collateralQuantity")} htmlFor="defi-collateral-qty">
                    <input
                      id="defi-collateral-qty"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.collateralQuantity}
                      onChange={(e) => set("collateralQuantity", e.target.value)}
                      data-testid="defi-w-collateral-qty"
                    />
                  </Field>
                  <Field
                    label={label("collateralUnitPriceEur")}
                    htmlFor="defi-collateral-price"
                    hint={help("collateralUnitPriceEur")}
                  >
                    <input
                      id="defi-collateral-price"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.collateralUnitPriceEur}
                      onChange={(e) => set("collateralUnitPriceEur", e.target.value)}
                      data-testid="defi-w-collateral-price"
                    />
                  </Field>
                </div>
              )}

              {visible("pointsAmount") && (
                <div className="mt-3">
                  <Field label={label("pointsAmount")} htmlFor="defi-points" optional hint={help("pointsAmount")}>
                    <input
                      id="defi-points"
                      inputMode="decimal"
                      className="input mt-1 w-full sm:w-64"
                      value={form.pointsAmount}
                      onChange={(e) => set("pointsAmount", e.target.value)}
                      data-testid="defi-w-points"
                    />
                  </Field>
                </div>
              )}
            </FormSection>
          )}

          {STEPS[step]?.id === "valuation" && (
            <FormSection title="Valorisation" step={6}>
              <p className="text-meta">
                La valeur de cette position viendra du journal (prix de marché courant × quantité),
                pas de la saisie ci-dessus — le prix d&apos;entrée ne sert qu&apos;à l&apos;écriture
                comptable initiale. Une fois créée, une valorisation manuelle pourra être ajoutée
                depuis le détail de la position si aucun prix fiable n&apos;est disponible.
              </p>
              <div className="mt-2 max-w-xs">
                <Field label={label("apyPct")} htmlFor="defi-apy" optional hint={help("apyPct")}>
                  <input
                    id="defi-apy"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.apyPct}
                    onChange={(e) => set("apyPct", e.target.value)}
                    data-testid="defi-w-apy"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "risk" && (
            <FormSection title="Statut, liquidité et risque" step={7}>
              {visible("lockEnabled") && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={form.lockEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((f) => applyReset("lockEnabled", { ...f, lockEnabled: checked }));
                    }}
                    data-testid="defi-w-lock-enabled"
                  />
                  Cette position est verrouillée jusqu&apos;à une date connue
                </label>
              )}
              {visible("unlockAt") && (
                <div className="mt-2 max-w-xs">
                  <Field label={label("unlockAt")} htmlFor="defi-unlock-at" hint={help("unlockAt")}>
                    <input
                      id="defi-unlock-at"
                      type="date"
                      className="input mt-1 w-full"
                      value={form.unlockAt}
                      onChange={(e) => set("unlockAt", e.target.value)}
                      data-testid="defi-w-unlock-at"
                    />
                  </Field>
                </div>
              )}
              {visible("healthFactor") && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <Field label={label("healthFactor")} htmlFor="defi-hf" optional hint={help("healthFactor")}>
                    <input
                      id="defi-hf"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      placeholder="1.85"
                      value={form.healthFactor}
                      onChange={(e) => set("healthFactor", e.target.value)}
                      data-testid="defi-w-health-factor"
                    />
                  </Field>
                  <Field label={label("ltvPct")} htmlFor="defi-ltv" optional hint={help("ltvPct")}>
                    <input
                      id="defi-ltv"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.ltvPct}
                      onChange={(e) => set("ltvPct", e.target.value)}
                      data-testid="defi-w-ltv"
                    />
                  </Field>
                  <Field label={label("liqThresholdPct")} htmlFor="defi-liq-threshold" optional>
                    <input
                      id="defi-liq-threshold"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.liqThresholdPct}
                      onChange={(e) => set("liqThresholdPct", e.target.value)}
                      data-testid="defi-w-liq-threshold"
                    />
                  </Field>
                </div>
              )}
              {!visible("lockEnabled") && !visible("healthFactor") && (
                <p className="text-meta">Aucun paramètre de risque pour cette nature de position.</p>
              )}
            </FormSection>
          )}

          {STEPS[step]?.id === "rewards" && (
            <FormSection title="Récompenses et notes" step={8}>
              {visible("rewardsSymbol") ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label={label("rewardsSymbol")} htmlFor="defi-rewards-symbol" optional>
                    <input
                      id="defi-rewards-symbol"
                      className="input mt-1 w-full"
                      value={form.rewardsSymbol}
                      onChange={(e) => set("rewardsSymbol", e.target.value)}
                      data-testid="defi-w-rewards-symbol"
                    />
                  </Field>
                  <Field label={label("rewardsAmount")} htmlFor="defi-rewards-amount" optional>
                    <input
                      id="defi-rewards-amount"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.rewardsAmount}
                      onChange={(e) => set("rewardsAmount", e.target.value)}
                      data-testid="defi-w-rewards-amount"
                    />
                  </Field>
                  <Field label={label("rewardsValueEur")} htmlFor="defi-rewards-value" optional>
                    <input
                      id="defi-rewards-value"
                      inputMode="decimal"
                      className="input mt-1 w-full"
                      value={form.rewardsValueEur}
                      onChange={(e) => set("rewardsValueEur", e.target.value)}
                      data-testid="defi-w-rewards-value"
                    />
                  </Field>
                </div>
              ) : (
                <p className="text-meta">Un emprunt ne génère pas de récompense.</p>
              )}
              <div className="mt-3">
                <Field label={label("notes")} htmlFor="defi-notes" optional>
                  <textarea
                    id="defi-notes"
                    className="input mt-1 w-full"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    data-testid="defi-w-notes"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "summary" && (
            <FormSection title="Récapitulatif" step={9}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3" data-testid="defi-w-summary">
                <SummaryItem label="Mode d'accès" value={form.accessMode} />
                <SummaryItem label={label("platformId")} value={platformName(platforms, form.platformId)} />
                <SummaryItem label="Type" value={form.positionType} />
                <SummaryItem label="Chaîne" value={form.chain || "—"} />
                <SummaryItem label="Protocole" value={form.protocol || "Non divulgué"} />
                <SummaryItem label={label("assetSymbol")} value={form.assetSymbol || "—"} />
                <SummaryItem label="Quantité" value={form.quantity || "—"} />
                <SummaryItem label="Prix d'entrée" value={form.unitPriceEur ? `${form.unitPriceEur} €` : "—"} />
                <SummaryItem label="Quote-part" value={`${form.ownershipPct || "100"} %`} />
              </dl>
              <p className="text-meta mt-2">
                Vérifiez ces informations avant d&apos;enregistrer — la position sera immédiatement
                comptée dans le patrimoine DeFi.
              </p>
            </FormSection>
          )}
        </FormWizard>
      </Modal>

      {pendingAccessMode && (
        <ConfirmDialog
          open
          title="Changer de mode d'accès"
          message="Le wallet/plateforme, la chaîne et le protocole déjà saisis seront réinitialisés."
          confirmLabel="Changer et réinitialiser"
          danger={false}
          onConfirm={() => {
            setForm((f) => applyReset("accessMode", { ...f, accessMode: pendingAccessMode }));
            setPendingAccessMode(null);
          }}
          onCancel={() => setPendingAccessMode(null)}
          testId="defi-confirm-access-mode-change"
        />
      )}
      {pendingPositionType && (
        <ConfirmDialog
          open
          title="Changer la nature de la position"
          message="Les champs spécifiques déjà saisis (paire LP, collatéral, risque…) seront réinitialisés."
          confirmLabel="Changer et réinitialiser"
          danger={false}
          onConfirm={() => {
            setForm((f) => applyReset("positionType", { ...f, positionType: pendingPositionType }));
            setPendingPositionType(null);
          }}
          onCancel={() => setPendingPositionType(null)}
          testId="defi-confirm-position-type-change"
        />
      )}
    </>
  );
}

function platformName(platforms: PlatformOption[], id: string): string {
  return platforms.find((p) => p.id === id)?.name ?? "—";
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
