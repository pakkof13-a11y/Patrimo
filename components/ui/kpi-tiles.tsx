"use client";

/**
 * Les deux tuiles d'indicateurs partagées des modules.
 *
 * `KpiBandTile`   bande segmentée, sans surface propre — sept modules.
 * `KpiCardTile`   carte `card`, libellé d'abord — Plateformes et Trading.
 *
 * Une troisième famille existe et reste chez elle : les tuiles de panneau
 * (`securities-overview`, `portfolio-kpi-cards`), surface `panel`, valeur plus
 * grande, zone secondaire de hauteur réservée. Leurs deux versions ne partagent
 * que la coquille : l'une prend un emplacement libre, l'autre cinq propriétés
 * typées (unité, ligne secondaire et sa tonalité, courbe et sa couleur). Les
 * fondre demanderait de réécrire cinq appels en JSX inline pour supprimer une
 * douzaine de lignes — le compte n'y est pas.
 *
 * ---
 *
 * ## Ce que `KpiBandTile` factorise
 *
 * Sept modules refondus successivement — Banques, Immobilier, Passifs,
 * Alternatifs, Assurance-vie, Épargne salariale, Transactions — ont chacun
 * recopié la même tuile dans leur propre fichier. Sept déclarations, même
 * structure, mêmes classes, même squelette de chargement. Cette copie était
 * raisonnable au deuxième module ; au septième, elle ne l'est plus.
 *
 * ## Ce qu'elle ne factorise pas
 *
 * Ce n'est pas *la* tuile KPI d'Aurea, c'est celle d'une **bande segmentée** :
 * valeur d'abord, libellé ensuite, aucune surface propre — les tuiles se
 * détachent par les séparateurs de la bande qui les contient. `Kpi`
 * (`ui/kpi.tsx`), tuile du bandeau patrimonial, garde son icône, son ordre
 * inverse, sa tonalité en liseré et sa variante `accent` : la fondre ici
 * produirait un composant à options plus difficile à lire que les deux
 * versions séparées.
 *
 * ## Les quatre états, hérités du correctif du bandeau patrimonial
 *
 *   chargement      squelette au gabarit de la valeur, aucune tonalité —
 *                   affirmer une tendance sur une donnée inconnue est faux ;
 *   donnée absente  l'appelant passe son propre libellé (« — », « Non
 *                   calculé »…), la tuile n'invente rien ;
 *   zéro réel       s'affiche comme un montant, parce que c'en est un ;
 *   valeur          rendu normal.
 */

import { cn } from "@/app/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function KpiBandTile({
  label,
  value,
  secondary,
  tone,
  loading = false,
  testId,
  children,
}: {
  label: string;
  /** Déjà formaté par l'appelant — la tuile ne connaît ni devise ni unité. */
  value: string;
  /** Précision sous le libellé : période, dénominateur, mise en garde. */
  secondary?: string;
  /**
   * Couleur de la valeur.
   *
   * Sémantique, jamais décorative : `positive` et `negative` disent un gain ou
   * une perte. Ignorée pendant le chargement.
   */
  tone?: "positive" | "negative";
  loading?: boolean;
  testId?: string;
  /**
   * Contenu additionnel sous la tuile — une courbe de tendance, par exemple.
   *
   * Un emplacement libre plutôt qu'une prop `spark` : seule l'Assurance-vie en
   * affiche une, et figer sa forme dans la tuile imposerait ce choix aux six
   * autres modules.
   */
  children?: React.ReactNode;
}) {
  return (
    <div
      className="min-w-0 px-[var(--space-4)] py-[var(--space-3)]"
      data-testid={testId}
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
    >
      {loading ? (
        // 24 px : la hauteur qu'occupe réellement la ligne du montant, mesurée.
        <Skeleton className="h-6 w-24" />
      ) : (
        <p
          className={cn(
            "num truncate text-[length:var(--text-lg)] font-semibold tracking-tight",
            tone === "positive" && "val-positive",
            tone === "negative" && "val-negative",
            !tone && "text-[var(--foreground)]"
          )}
        >
          {value}
        </p>
      )}
      <p className="text-label mt-[var(--space-1)]">{label}</p>
      {secondary ? (
        /*
          La ligne secondaire garde sa place pendant le chargement.

          Elle n'était rendue qu'une fois la donnée arrivée : la tuile
          grandissait alors d'une ligne, et toute la bande avec elle — 15 px de
          saut sur la bande Immobilier. `invisible` réserve l'espace exact du
          texte final plutôt qu'une hauteur devinée.
        */
        <p
          className={cn(
            "text-[length:var(--text-2xs)] text-[var(--foreground-faint)]",
            loading && "invisible"
          )}
        >
          {loading ? "—" : secondary}
        </p>
      ) : null}
      {!loading ? children : null}
    </div>
  );
}

/**
 * Tuile d'indicateur posée sur sa propre **carte**.
 *
 * Libellé d'abord, valeur ensuite, précision discrète — l'inverse de la bande,
 * parce qu'ici chaque tuile est un objet autonome et non un segment. Employée
 * par Plateformes et Trading, qui en avaient chacun leur copie mot pour mot.
 *
 * La tonalité y est nommée, jamais numérique : Trading passait le P&L brut et
 * laissait la tuile décider du signe. Le calcul appartient à l'appelant, qui
 * sait ce que son nombre veut dire ; `warning` (Plateformes) et le P&L y
 * cohabitent alors sans que la tuile connaisse ni l'un ni l'autre.
 */
export function KpiCardTile({
  label,
  value,
  hint,
  tone,
  testId,
}: {
  label: string;
  /** Déjà formaté par l'appelant. */
  value: string;
  /** Précision sous la valeur : période, dénominateur, mise en garde. */
  hint?: string;
  tone?: "positive" | "negative" | "warning";
  testId: string;
}) {
  return (
    <div className="card p-[var(--space-3)]" data-testid={testId}>
      <p className="text-label">{label}</p>
      <p
        className={cn(
          "num mt-[var(--space-1)] text-[length:var(--text-lg)] font-semibold tracking-tight",
          tone === "positive" && "val-positive",
          tone === "negative" && "val-negative",
          tone === "warning" && "text-[var(--warning)]",
          !tone && "text-[var(--foreground)]"
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-meta mt-[var(--space-px)]">{hint}</p> : null}
    </div>
  );
}
