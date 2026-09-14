# audit-notif — notifications in-app (feature partiellement présente)

Preuve Glob (corrige la doctrine assumant N/A) :
```
find app -iname "*notif*" -o -iname "*mail*" -o -iname "*webhook*"
→ app/lib/notifications

grep -rl "notification" app/lib app/api components
→ app/lib/notifications/context.tsx
  app/lib/notifications/types.ts
  components/layout/app-header.tsx
  components/layout/notification-bell.tsx
```
Résultat : notifications in-app (cloche UI) uniquement. Aucun email, aucun webhook.

```
ID:             NOTIF-01
Gravité:        P2
Fichier:Ligne:  notification-bell.tsx:76-80
Reproduction:   Élément non lu → pastille avec title="Non lu" sur un <span> (jamais exposé au clavier). Le statut lu/non-lu n'est porté que par la couleur de fond de la ligne (style, pas de texte/aria).
Effet:          Statut "lu/non lu" de chaque notification non annoncé aux lecteurs d'écran — perte d'information, pas seulement redondance.
Déjà connu:     non

ID:             NOTIF-02
Gravité:        P3
Fichier:Ligne:  notification-bell.tsx:174,188
Reproduction:   Boutons "Tout lu"/"Vider" : title redondant avec le texte visible du bouton.
Effet:          Mineur — le bouton reste nommé par son texte visible, title n'est pas le seul vecteur ici.
Déjà connu:     non

ID:             NOTIF-03
Gravité:        P3 [NON MESURÉ]
Fichier:Ligne:  notification-bell.tsx:148-158
Reproduction:   Panneau role="dialog" sans focus trap ni focus initial déplacé à l'ouverture.
Effet:          Navigation clavier possible (Escape/clic extérieur ferment) mais gestion de focus non conforme aux patterns dialog standards ; non vérifié en exécution (audit lecture seule).
Déjà connu:     non

ID:             NOTIF-04
Gravité:        P3
Fichier:Ligne:  notification-bell.tsx:196
Reproduction:   Liste de notifications sans role="log"/aria-live ; une nouvelle notification déclenche un toast (sonner) mais le panneau ouvert n'annonce rien de nouveau.
Effet:          Arrivée de notification non annoncée si le panneau est déjà ouvert ; dépend de la config sonner pour le toast lui-même, non vérifiée ici.
Déjà connu:     non
```

Hors périmètre a11y-ui, à transmettre : la logique de déclenchement/fréquence des alertes SL/TP (conditions d'envoi, dédoublonnage inter-onglets via BroadcastChannel) relève de frontend-charts ou finance-metier selon la nature du déclencheur — pas un défaut d'affichage.
