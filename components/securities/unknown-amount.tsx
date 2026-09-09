"use client";

import { useId, useState } from "react";
import { cn } from "@/app/lib/utils";

/**
 * Une grandeur inconnue, et la raison qui va avec — atteignable autrement
 * qu'à la souris.
 *
 * Les écrans titres remplacent par un tiret tout montant qui n'a pas été
 * relevé (doctrine UNKNOWN ≠ ZERO). La justification tenait dans un attribut
 * `title` : elle ne s'ouvre qu'au survol d'un pointeur. Au clavier, au doigt et
 * pour un lecteur d'écran, l'écran ne portait donc qu'un tiret nu, sans le
 * moindre moyen d'apprendre pourquoi — soit exactement l'information que la
 * doctrine existe pour transmettre.
 *
 * Le tiret devient un bouton. Il se tabule, il s'active au doigt, son texte
 * long est rattaché par `aria-describedby` — le lecteur d'écran l'annonce donc
 * à la prise de focus sans qu'aucun survol ne soit nécessaire. L'infobulle
 * reste dans le DOM en permanence, masquée par l'opacité et non par
 * `display`, pour que cette liaison ait toujours une cible.
 *
 * `title` n'est pas conservé : il ferait s'ouvrir deux bulles superposées au
 * survol, l'une native et l'autre dessinée, alors que la seconde couvre déjà
 * le cas de la souris.
 *
 * Le style de bulle est celui de l'aide du pavé de répartition
 * (`components/dashboard/terminal-panels.tsx`) : un seul vocabulaire visuel
 * pour un seul geste.
 */
export function UnknownAmount({
  /** Ce qui s'affiche à la place du montant — un tiret, ou la raison en bref. */
  children,
  /** Phrase courte reprise dans le nom accessible du bouton. */
  short,
  /** Explication complète, rattachée par `aria-describedby`. */
  title,
  className,
  testId,
  ...rest
}: {
  children: React.ReactNode;
  short: string;
  title: string;
  className?: string;
  testId?: string;
} & Record<`data-${string}`, string | undefined>) {
  const id = useId();
  /* Le doigt n'a pas de survol : un appui ouvre et referme la bulle. */
  const [ouvert, setOuvert] = useState(false);

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className={cn(
          "cursor-help underline decoration-dotted underline-offset-2",
          "text-[var(--muted-foreground)]",
          className
        )}
        /* Le nom accessible d'un bouton dont le contenu visible est « — »
           serait « — ». La raison en bref le rend annonçable, et elle contient
           le texte visible quand il y en a un — le nom et l'étiquette ne se
           contredisent donc jamais. */
        aria-label={`${short} — pourquoi ?`}
        aria-expanded={ouvert}
        aria-describedby={id}
        onClick={() => setOuvert((v) => !v)}
        /* L'ouverture au focus passe par l'état plutôt que par une variante
           `group-focus-within:` : un utilisateur au clavier verrait sinon la
           bulle dépendre d'une classe utilitaire que rien ici ne vérifie. */
        onFocus={() => setOuvert(true)}
        onBlur={() => setOuvert(false)}
        data-testid={testId}
        {...rest}
      >
        {children}
      </button>
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 top-full z-40 mt-1.5 w-64",
          "rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5",
          "text-left text-[length:var(--text-2xs)] font-normal leading-snug",
          "text-[var(--foreground-secondary)] shadow-lg transition",
          "opacity-0 group-hover:opacity-100",
          "motion-reduce:transition-none",
          ouvert && "opacity-100"
        )}
      >
        {title}
      </span>
    </span>
  );
}
