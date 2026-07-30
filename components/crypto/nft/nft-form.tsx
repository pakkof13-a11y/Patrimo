"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormWizard, type WizardStep } from "@/components/ui/form-wizard";
import { Field, FormSection } from "@/components/ui/field";
import { d } from "@/app/lib/money/decimal";
import { assessNftMetadataQuality, classifyNftSpam } from "@/app/lib/crypto/nft-classification";
import {
  NFT_ACCESS_MODE_OPTIONS,
  NFT_ACQUISITION_SOURCE_OPTIONS,
  NFT_CHAIN_OPTIONS,
  NFT_CUSTODY_MODEL_OPTIONS,
  defaultStandardForChain,
  getNftFieldHelpText,
  getNftFieldLabel,
  getNftFieldsToResetOnChange,
  isNftFieldRequired,
  isNftFieldVisible,
  isSolanaStandard,
  nftCategoryLabel,
  nftStandardOptionsForChain,
  type NftAddMode,
  type NftFieldId,
  type NftFormRuleState,
} from "@/app/lib/crypto/nft-ui-rules";

type PlatformOption = { id: string; name: string; type: string | null };

type WizardForm = {
  addMode: NftAddMode;
  platformId: string;
  ownerLabel: string;
  ownershipShare: string;
  custodyModel: string;
  accessMode: string;
  chain: string;
  standard: string;
  contractAddr: string;
  tokenId: string;
  quantity: string;
  name: string;
  collectionName: string;
  imageUrl: string;
  collectionSlug: string;
  notes: string;
  acquisitionSource: string;
  acquisitionDate: string;
  acquisitionPriceEur: string;
  manualAppraisalEur: string;
};

function emptyForm(): WizardForm {
  return {
    addMode: "MANUAL",
    platformId: "",
    ownerLabel: "",
    ownershipShare: "100",
    custodyModel: "SELF_CUSTODY",
    accessMode: "SELF_CUSTODY",
    chain: "ethereum",
    standard: "ERC_721",
    contractAddr: "",
    tokenId: "",
    quantity: "1",
    name: "",
    collectionName: "",
    imageUrl: "",
    collectionSlug: "",
    notes: "",
    acquisitionSource: "MANUAL",
    acquisitionDate: new Date().toISOString().slice(0, 10),
    acquisitionPriceEur: "",
    manualAppraisalEur: "",
  };
}

function ruleState(f: WizardForm): NftFormRuleState {
  return { addMode: f.addMode, standard: f.standard };
}

const STEPS: WizardStep[] = [
  { id: "mode", label: "Mode d'ajout", description: "Comment ce NFT entre-t-il dans Patrimo ?" },
  { id: "source", label: "Détention", description: "Wallet/plateforme, détenteur et quote-part" },
  { id: "identity", label: "Identité", description: "Chaîne, standard et identifiants techniques" },
  { id: "acquisition", label: "Acquisition", description: "Origine, date et coût" },
  { id: "valuation", label: "Valorisation", description: "Expertise manuelle éventuelle" },
  { id: "classification", label: "Classification", description: "Qualité des données, calculée automatiquement" },
  { id: "advanced", label: "Avancé", description: "Slug de collection, notes" },
  { id: "summary", label: "Récapitulatif", description: "Vérifiez avant d'enregistrer" },
];

/**
 * Formulaire d'ajout d'un NFT — 8 étapes, divulgation progressive stricte
 * pilotée par `nft-ui-rules.ts`. N'expose que les champs réellement écrits
 * par `createNftManual` (`CreateNftInput`) : aucun champ avancé qui n'irait
 * nulle part (royalties, creator address, metadata URL…) n'est modélisé —
 * cf. limites V1 de `docs/nft-backend-v1.md`.
 */
export function NftForm({
  platforms,
  onClose,
  onCreated,
  onSwitchToSync,
}: {
  platforms: PlatformOption[];
  onClose: () => void;
  onCreated: () => void;
  onSwitchToSync: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<WizardForm>(emptyForm());
  const [step, setStep] = useState(0);
  const [pendingSyncSwitch, setPendingSyncSwitch] = useState(false);

  const set = <K extends keyof WizardForm>(k: K, v: WizardForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const rules = ruleState(form);
  const visible = (id: NftFieldId) => isNftFieldVisible(id, rules);
  const required = (id: NftFieldId) => isNftFieldRequired(id, rules);
  const label = (id: NftFieldId) => getNftFieldLabel(id, rules);
  const help = (id: NftFieldId) => getNftFieldHelpText(id, rules);

  function applyReset(field: NftFieldId, base: WizardForm): WizardForm {
    const toReset = new Set(getNftFieldsToResetOnChange(field));
    if (toReset.size === 0) return base;
    const empty = emptyForm();
    const next = { ...base };
    for (const key of toReset) {
      (next as Record<string, unknown>)[key] = (empty as Record<string, unknown>)[key];
    }
    return next;
  }

  function changeAddMode(next: NftAddMode) {
    if (next === "WALLET_SYNC") {
      const hasData = form.name.trim() || form.tokenId.trim() || form.acquisitionPriceEur.trim();
      if (hasData) {
        setPendingSyncSwitch(true);
        return;
      }
      onSwitchToSync();
      return;
    }
    const isCustodial = next === "CUSTODIAL";
    setForm((f) => ({
      ...f,
      addMode: next,
      accessMode: isCustodial ? "CUSTODIAL" : "SELF_CUSTODY",
      custodyModel: isCustodial ? "CUSTODIAL" : "SELF_CUSTODY",
      platformId: "",
    }));
  }

  function changeChain(nextChain: string) {
    const wasSolana = isSolanaStandard(form.standard);
    const willBeSolana = nextChain.trim().toLowerCase() === "solana";
    setForm((f) => {
      const next = applyReset("chain", { ...f, chain: nextChain });
      if (wasSolana !== willBeSolana) {
        next.standard = defaultStandardForChain(nextChain);
      }
      return next;
    });
  }

  const filteredPlatforms = useMemo(() => {
    if (form.addMode === "CUSTODIAL") {
      const nonBlockchain = platforms.filter((p) => p.type !== "BLOCKCHAIN");
      return nonBlockchain.length > 0 ? nonBlockchain : platforms;
    }
    const wallets = platforms.filter((p) => p.type === "BLOCKCHAIN");
    return wallets.length > 0 ? wallets : platforms;
  }, [platforms, form.addMode]);

  const spamPreview = useMemo(
    () =>
      classifyNftSpam({
        collectionVerifiedStatus: "UNKNOWN",
        hasReliableFloor: false,
        acquisitionSource: form.acquisitionSource,
        acquisitionCostEur: form.acquisitionPriceEur ? d(form.acquisitionPriceEur) : null,
        name: form.name,
        description: null,
      }),
    [form.acquisitionSource, form.acquisitionPriceEur, form.name]
  );
  const metadataPreview = useMemo(
    () =>
      assessNftMetadataQuality({
        hasName: !!form.name.trim(),
        hasImage: !!form.imageUrl.trim(),
        hasRawMetadata: false,
        parseFailed: false,
      }),
    [form.name, form.imageUrl]
  );

  const create = useMutation({
    mutationFn: () =>
      fetchJson("/api/crypto/nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId: form.platformId,
          name: form.name.trim(),
          tokenId: form.tokenId.trim(),
          contractAddr: visible("contractAddr") ? form.contractAddr.trim() || null : null,
          chain: form.chain,
          collectionName: form.collectionName.trim() || null,
          collectionSlug: form.collectionSlug.trim() || null,
          imageUrl: form.imageUrl.trim() || null,
          standard: form.standard,
          quantity: form.quantity || "1",
          acquisitionPriceEur: form.acquisitionPriceEur,
          acquisitionDate: form.acquisitionDate,
          manualFloorPriceEur: form.manualAppraisalEur.trim() || null,
          notes: form.notes.trim() || null,
          ownerLabel: form.ownerLabel.trim() || null,
          ownershipShare: form.ownershipShare.trim() || null,
          accessMode: form.accessMode,
          custodyModel: form.custodyModel,
          acquisitionSource: form.acquisitionSource,
        }),
      }),
    onSuccess: () => {
      toast.success("NFT ajouté");
      void qc.invalidateQueries({ queryKey: ["crypto-nft-portfolio"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
      onCreated();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function validateStep(index: number): boolean {
    const id = STEPS[index]?.id;
    const missing: string[] = [];
    const check = (field: NftFieldId, value: unknown) => {
      if (!required(field)) return;
      if (value == null || value === "") missing.push(label(field));
    };

    if (id === "mode" && form.addMode === "CSV_IMPORT") {
      toast.error("L'import CSV n'est pas encore disponible pour les NFT — choisissez un autre mode.");
      return false;
    }
    if (id === "source") {
      check("platformId", form.platformId);
    } else if (id === "identity") {
      check("chain", form.chain);
      check("standard", form.standard);
      check("contractAddr", form.contractAddr);
      check("tokenId", form.tokenId);
      check("name", form.name);
      const qty = Number(form.quantity || "0");
      if (!Number.isFinite(qty) || qty <= 0) missing.push("Quantité (doit être > 0)");
    } else if (id === "acquisition") {
      check("acquisitionDate", form.acquisitionDate);
      check("acquisitionPriceEur", form.acquisitionPriceEur);
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
        title="Ajouter un NFT"
        onClose={onClose}
        panelClassName="w-[min(56rem,calc(100vw-2rem))] max-w-[56rem]"
        testId="nft-form-modal"
      >
        <FormWizard
          steps={STEPS}
          current={step}
          onStepChange={setStep}
          onValidateStep={validateStep}
          submitLabel="Enregistrer le NFT"
          submitPending={create.isPending}
          submitDisabled={create.isPending}
          onSubmit={() => create.mutate()}
          onCancel={onClose}
          testId="nft-wizard"
        >
          {STEPS[step]?.id === "mode" && (
            <FormSection title="Mode d'ajout" step={1}>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    { value: "MANUAL", title: "Saisie manuelle", desc: "Un NFT que vous détenez déjà, dans un wallet personnel." },
                    { value: "WALLET_SYNC", title: "Synchronisation wallet", desc: "Détection automatique des NFT d'une adresse." },
                    { value: "CUSTODIAL", title: "Plateforme custodiale", desc: "Détenu pour vous par un exchange ou une plateforme." },
                    { value: "CSV_IMPORT", title: "Import CSV", desc: "Pas encore disponible pour les NFT." },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => changeAddMode(opt.value)}
                    className={`rounded-[var(--radius-md)] border p-3 text-left transition ${
                      form.addMode === opt.value
                        ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)]"
                    }`}
                    data-testid={`nft-w-mode-${opt.value}`}
                    aria-pressed={form.addMode === opt.value}
                  >
                    <p className="text-sm font-medium">{opt.title}</p>
                    <p className="text-meta mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
              {form.addMode === "CSV_IMPORT" && (
                <p className="text-meta mt-2 text-[var(--warning)]" data-testid="nft-w-csv-note">
                  L&apos;import CSV pour les NFT arrive dans une prochaine version — choisissez la
                  saisie manuelle ou la synchronisation wallet pour continuer.
                </p>
              )}
            </FormSection>
          )}

          {STEPS[step]?.id === "source" && (
            <FormSection title="Source de détention" step={2}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={label("platformId")} htmlFor="nft-platform">
                  <select
                    id="nft-platform"
                    className="input mt-1 w-full"
                    value={form.platformId}
                    onChange={(e) => set("platformId", e.target.value)}
                    data-testid="nft-w-platform"
                  >
                    <option value="">— choisir —</option>
                    {filteredPlatforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {filteredPlatforms.length === 0 && (
                    <p className="text-meta mt-1" data-testid="nft-w-platform-empty-hint">
                      Aucune plateforme enregistrée — ajoutez-en une depuis « Mes plateformes ».
                    </p>
                  )}
                </Field>
                <Field label={label("ownershipShare")} htmlFor="nft-ownership" hint={help("ownershipShare")}>
                  <input
                    id="nft-ownership"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.ownershipShare}
                    onChange={(e) => set("ownershipShare", e.target.value)}
                    data-testid="nft-w-ownership"
                  />
                </Field>
                <Field label={label("custodyModel")} htmlFor="nft-custody" optional hint={help("custodyModel")}>
                  <select
                    id="nft-custody"
                    className="input mt-1 w-full"
                    value={form.custodyModel}
                    onChange={(e) => set("custodyModel", e.target.value)}
                    data-testid="nft-w-custody"
                  >
                    {NFT_CUSTODY_MODEL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label("accessMode")} htmlFor="nft-access-mode" optional>
                  <select
                    id="nft-access-mode"
                    className="input mt-1 w-full"
                    value={form.accessMode}
                    onChange={(e) => set("accessMode", e.target.value)}
                    data-testid="nft-w-access-mode"
                  >
                    {NFT_ACCESS_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label("ownerLabel")} htmlFor="nft-owner" optional className="sm:col-span-2">
                  <input
                    id="nft-owner"
                    className="input mt-1 w-full"
                    placeholder="SCI Dupont, holding familiale…"
                    value={form.ownerLabel}
                    onChange={(e) => set("ownerLabel", e.target.value)}
                    data-testid="nft-w-owner"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "identity" && (
            <FormSection title="Identité du NFT" step={3}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={label("chain")} htmlFor="nft-chain">
                  <select
                    id="nft-chain"
                    className="input mt-1 w-full"
                    value={form.chain}
                    onChange={(e) => changeChain(e.target.value)}
                    data-testid="nft-w-chain"
                  >
                    {NFT_CHAIN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label("standard")} htmlFor="nft-standard" hint={help("standard")}>
                  <select
                    id="nft-standard"
                    className="input mt-1 w-full"
                    value={form.standard}
                    onChange={(e) => set("standard", e.target.value)}
                    data-testid="nft-w-standard"
                  >
                    {nftStandardOptionsForChain(form.chain).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {visible("contractAddr") && (
                  <Field label={label("contractAddr")} htmlFor="nft-contract">
                    <input
                      id="nft-contract"
                      className="input mt-1 w-full"
                      placeholder="0x…"
                      value={form.contractAddr}
                      onChange={(e) => set("contractAddr", e.target.value)}
                      data-testid="nft-w-contract"
                    />
                  </Field>
                )}
                <Field label={label("tokenId")} htmlFor="nft-token-id" hint={help("tokenId")}>
                  <input
                    id="nft-token-id"
                    className="input mt-1 w-full"
                    value={form.tokenId}
                    onChange={(e) => set("tokenId", e.target.value)}
                    data-testid="nft-w-token-id"
                  />
                </Field>
                <Field label={label("quantity")} htmlFor="nft-quantity" hint={help("quantity")}>
                  <input
                    id="nft-quantity"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.quantity}
                    onChange={(e) => set("quantity", e.target.value)}
                    data-testid="nft-w-quantity"
                  />
                </Field>
                <Field label={label("name")} htmlFor="nft-name">
                  <input
                    id="nft-name"
                    className="input mt-1 w-full"
                    placeholder="Bored Ape #1234"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    data-testid="nft-w-name"
                  />
                </Field>
                <Field label={label("collectionName")} htmlFor="nft-collection" optional>
                  <input
                    id="nft-collection"
                    className="input mt-1 w-full"
                    placeholder="Bored Ape Yacht Club"
                    value={form.collectionName}
                    onChange={(e) => set("collectionName", e.target.value)}
                    data-testid="nft-w-collection"
                  />
                </Field>
                <Field label={label("imageUrl")} htmlFor="nft-image" optional hint={help("imageUrl")}>
                  <input
                    id="nft-image"
                    className="input mt-1 w-full"
                    value={form.imageUrl}
                    onChange={(e) => set("imageUrl", e.target.value)}
                    data-testid="nft-w-image"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "acquisition" && (
            <FormSection title="Acquisition" step={4}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label={label("acquisitionSource")} htmlFor="nft-acq-source">
                  <select
                    id="nft-acq-source"
                    className="input mt-1 w-full"
                    value={form.acquisitionSource}
                    onChange={(e) => set("acquisitionSource", e.target.value)}
                    data-testid="nft-w-acq-source"
                  >
                    {NFT_ACQUISITION_SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={label("acquisitionDate")} htmlFor="nft-acq-date">
                  <input
                    id="nft-acq-date"
                    type="date"
                    className="input mt-1 w-full"
                    value={form.acquisitionDate}
                    onChange={(e) => set("acquisitionDate", e.target.value)}
                    data-testid="nft-w-acq-date"
                  />
                </Field>
                <Field
                  label={label("acquisitionPriceEur")}
                  htmlFor="nft-acq-price"
                  hint={help("acquisitionPriceEur")}
                >
                  <input
                    id="nft-acq-price"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.acquisitionPriceEur}
                    onChange={(e) => set("acquisitionPriceEur", e.target.value)}
                    data-testid="nft-w-acq-price"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "valuation" && (
            <FormSection title="Valorisation" step={5}>
              <p className="text-meta">
                La valeur retenue viendra automatiquement du floor de collection ou, à défaut, du
                coût d&apos;acquisition ci-dessus. Une expertise manuelle prévaut sur toute autre
                méthode si vous en renseignez une.
              </p>
              <div className="mt-2 max-w-xs">
                <Field
                  label={label("manualAppraisalEur")}
                  htmlFor="nft-appraisal"
                  optional
                  hint={help("manualAppraisalEur")}
                >
                  <input
                    id="nft-appraisal"
                    inputMode="decimal"
                    className="input mt-1 w-full"
                    value={form.manualAppraisalEur}
                    onChange={(e) => set("manualAppraisalEur", e.target.value)}
                    data-testid="nft-w-appraisal"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "classification" && (
            <FormSection title="Classification et qualité des données" step={6}>
              <p className="text-meta">
                Ces indicateurs sont calculés automatiquement à l&apos;enregistrement — aperçu avec
                les informations déjà saisies. Ils restent modifiables ensuite depuis le détail du
                NFT (masquer, ignorer, requalifier).
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Statut spam prévu
                  </dt>
                  <dd className="font-medium">
                    {spamPreview.spamStatus === "CLEAN"
                      ? "Propre"
                      : spamPreview.spamStatus === "SUSPECTED"
                        ? "Suspect"
                        : "Spam confirmé"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Qualité de la metadata
                  </dt>
                  <dd className="font-medium">
                    {metadataPreview === "COMPLETE"
                      ? "Complète"
                      : metadataPreview === "PARTIAL"
                        ? "Partielle"
                        : metadataPreview === "BROKEN"
                          ? "Cassée"
                          : "Inconnue"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    Catégorie
                  </dt>
                  <dd className="font-medium">
                    {nftCategoryLabel("UNKNOWN")}{" "}
                    <span className="text-meta">(non classifiable à la saisie — limite V1)</span>
                  </dd>
                </div>
              </dl>
              {spamPreview.reason && (
                <p className="text-meta mt-2 text-[var(--warning)]">{spamPreview.reason}</p>
              )}
            </FormSection>
          )}

          {STEPS[step]?.id === "advanced" && (
            <FormSection title="Section avancée" step={7} hint="Repliée par défaut — optionnelle.">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={label("collectionSlug")} htmlFor="nft-slug" optional hint={help("collectionSlug")}>
                  <input
                    id="nft-slug"
                    className="input mt-1 w-full"
                    placeholder="boredapeyachtclub"
                    value={form.collectionSlug}
                    onChange={(e) => set("collectionSlug", e.target.value)}
                    data-testid="nft-w-slug"
                  />
                </Field>
              </div>
              <div className="mt-2">
                <Field label={label("notes")} htmlFor="nft-notes" optional>
                  <textarea
                    id="nft-notes"
                    className="input mt-1 w-full"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                    data-testid="nft-w-notes"
                  />
                </Field>
              </div>
            </FormSection>
          )}

          {STEPS[step]?.id === "summary" && (
            <FormSection title="Récapitulatif" step={8}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3" data-testid="nft-w-summary">
                <SummaryItem label="Wallet / plateforme" value={platformName(platforms, form.platformId)} />
                <SummaryItem label="Chaîne" value={form.chain} />
                <SummaryItem label="Standard" value={form.standard} />
                <SummaryItem label={label("tokenId")} value={form.tokenId || "—"} />
                <SummaryItem label="Nom" value={form.name || "—"} />
                <SummaryItem label="Collection" value={form.collectionName || "Sans collection"} />
                <SummaryItem label="Quantité" value={form.quantity || "1"} />
                <SummaryItem label="Prix d'acquisition" value={form.acquisitionPriceEur ? `${form.acquisitionPriceEur} €` : "—"} />
                <SummaryItem label="Quote-part" value={`${form.ownershipShare || "100"} %`} />
                <SummaryItem
                  label="Expertise manuelle"
                  value={form.manualAppraisalEur ? `${form.manualAppraisalEur} €` : "Aucune — valorisation automatique"}
                />
              </dl>
              <p className="text-meta mt-2">
                Vérifiez ces informations avant d&apos;enregistrer — le NFT sera immédiatement
                compté dans le patrimoine.
              </p>
            </FormSection>
          )}
        </FormWizard>
      </Modal>

      {pendingSyncSwitch && (
        <ConfirmDialog
          open
          title="Passer à la synchronisation wallet"
          message="Les informations déjà saisies dans ce formulaire seront perdues. Continuer ?"
          confirmLabel="Basculer vers la synchronisation"
          danger={false}
          onConfirm={() => {
            setPendingSyncSwitch(false);
            onSwitchToSync();
          }}
          onCancel={() => setPendingSyncSwitch(false)}
          testId="nft-confirm-switch-sync"
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
