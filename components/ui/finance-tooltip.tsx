"use client";

import { HelpCircle } from "lucide-react";
import { cn } from "@/app/lib/utils";

const TIPS: Record<string, string> = {
  CUMP: "Coût unitaire moyen pondéré de vos achats (frais d’achat inclus).",
  "P&L latent":
    "Gain ou perte théorique sur les positions encore détenues (cours − CUMP).",
  "P&L réalisé":
    "Gain ou perte enregistré lors d’une vente ou d’une opération clôturée.",
  PRU: "Prix de revient unitaire — équivalent au CUMP sur cette application.",
  WHT:
    "Pays de résidence fiscale de l’émetteur (code ISO : US, DE, FR…). Taux de retenue à la source optionnel (0–1 ou %). En PEA, pas de PFU dans la perf ; le prélèvement étranger peut rester.",
  "P&L prix vs change":
    "Total = effet du cours de l’actif + effet des variations de change (si devise ≠ EUR).",
  FCPE:
    "Fonds Commun de Placement d’Entreprise — support d’investissement de l’épargne salariale (PEE, PER, PERCO).",
  VL: "Valeur liquidative du fonds : prix d’une part. Valeur de position = parts × VL.",
  PEE: "Plan d’épargne entreprise : versements en général bloqués 5 ans (sauf cas de déblocage anticipé).",
  PER: "Plan d’épargne retraite : horizon retraite par défaut (déblocages anticipés possibles selon cas légaux).",
  PERCO:
    "Ancien plan d’épargne pour la retraite collectif — traité comme un horizon retraite par défaut.",
  Abondement:
    "Complément versé par l’employeur sur vos versements d’épargne salariale.",
  Déblocage:
    "Date ou événement à partir duquel la ligne est considérée disponible (théorique, hors cas anticipés non saisis).",
  MOIC:
    "Multiple on Invested Capital : valorisation actuelle ÷ capital investi. 1,0× = à l’équilibre ; 2,0× = doublement.",
  "NAV PE":
    "Valeur actuelle estimée de la position (saisie manuelle). Non cotée : pas de cours de marché automatique.",
  Physique:
    "Métal détenu en nature (lingot, pièce). Le poids et le stockage sont pertinents.",
  Papier:
    "Exposition via produit financier (ETC, compte alloué…) sans possession physique.",
  "Capital en cours":
    "Somme du capital encore engagé sur les prêts actifs (hors remboursés / défauts selon statut).",
  Échéance:
    "Date théorique de fin de prêt. Si vide, calculée comme date de début + durée en mois.",
  "Capital restant dû":
    "Montant de capital encore à rembourser. Diminue à chaque prélèvement mensuel ou remboursement anticipé.",
  Mensualité:
    "Montant prélevé périodiquement. Utilisée pour le décrément auto du capital et l’estimation de durée restante.",
  Avenant:
    "Modification contractuelle (mensualité ou taux) : les projections (durée, intérêts restants) sont recalculées.",
  "Remboursement anticipé":
    "Remboursement hors échéance mensuelle : partiel (réduit le capital) ou total (solde le crédit).",
  "P&L réalisé fiscal":
    "Plus ou moins-value sur ventes de l’année (prix de vente − CUMP). Indicateur de suivi, pas une case de déclaration.",
  "Dividendes nets":
    "Revenus encaissés nets de retenue à la source étrangère (WHT) et de frais, pour l’année civile.",
  "WHT fiscal":
    "Withholding Tax : impôt prélevé à la source à l’étranger sur certains revenus. Peut ouvrir droit à crédit d’impôt selon conventions — non automatisé ici.",
  "PFU estimé":
    "Prélèvement forfaitaire unique ~30 % (12,8 % IR + 17,2 % PS) appliqué de façon indicative aux gains positifs CTO / crypto / CFD uniquement. Ce n’est pas votre impôt dû.",
  PEA:
    "Plan d’épargne en actions : fiscalité avantageuse sous conditions de durée — le PFU estimé de cette page ne s’y applique pas automatiquement.",
  "Assurance-vie":
    "Régime fiscal spécifique (abattements, durée de détention, rachats) — hors estimation PFU simplifiée de cette page.",
};

/**
 * Infobulle discrète pour acronymes financiers (hover + focus clavier).
 */
export function FinanceTip({
  term,
  className,
}: {
  term: keyof typeof TIPS | string;
  className?: string;
}) {
  const text = TIPS[term] ?? term;
  return (
    <span
      className={cn(
        "group relative inline-flex align-middle text-slate-400",
        className
      )}
      tabIndex={0}
      role="img"
      aria-label={text}
      title={text}
    >
      <HelpCircle className="h-3 w-3 opacity-60 transition group-hover:opacity-100 group-focus:opacity-100" />
      <span
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-left text-[10px] font-normal leading-snug text-slate-600 opacity-0 shadow-lg transition",
          "group-hover:opacity-100 group-focus:opacity-100 dark:text-slate-300",
          "motion-reduce:transition-none"
        )}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}
