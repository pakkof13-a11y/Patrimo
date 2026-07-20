# Raccourcis clavier — Patrimo

Accessibilité WCAG 2.1 · navigation clavier.

## Raccourcis globaux

| Touche | Action |
|--------|--------|
| `/` | Ouvrir la recherche globale / palette de commandes |
| `Ctrl+K` (⌘K) | Idem — palette de commandes |
| `n` | Ouvrir la modal **Nouvelle transaction** |
| `Échap` | Fermer la modal, le panneau ou la palette ouverte |
| `?` | Ouvrir le panneau d’aide des raccourcis |

## Règles

1. **Champs de saisie** : les lettres (`n`, `/`, `?`) ne sont **pas** interceptées tant que le focus est dans un `input`, `textarea`, `select` ou élément `contenteditable`.
2. **Modals** : quand un dialogue `role="dialog"` `aria-modal="true"` est ouvert, les raccourcis globaux de création / recherche sont suspendus. `Échap` ferme le dialogue (focus trap géré par `Modal`).
3. **Focus** : à l’ouverture d’une modal, le focus va au **premier champ interactif** du corps (pas le bouton fermer). À la fermeture, le focus revient à l’élément déclencheur.

## Tooltips

Les boutons concernés affichent le raccourci dans l’attribut `title` :

- Recherche header : `Recherche (/) · palette (Ctrl+K)`
- Nouvelle transaction : `Nouvelle transaction (n)`

## Implémentation

| Fichier | Rôle |
|---------|------|
| `app/lib/ui/keyboard-shortcuts.ts` | Définitions + helpers |
| `app/hooks/use-global-shortcuts.ts` | Hook document-level |
| `components/layout/shortcuts-help-panel.tsx` | UI aide (`?`) |
| `components/ui/modal.tsx` | Focus trap, Échap, restore focus |

## Tests manuels recommandés

1. Tab dans l’app → focus visible contrasté sur boutons / liens.
2. Ouvrir Transaction (clic ou `n`) → Tab cycle dans la modal uniquement → Échap ferme → focus sur le bouton d’origine.
3. `/` hors input → palette ouverte, focus dans le champ de recherche.
4. Taper dans un input → `n` saisit « n », ne pas ouvrir la modal.
5. `?` → panneau aide → Échap ferme.
