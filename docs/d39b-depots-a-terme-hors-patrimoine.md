# D39b — les dépôts à terme n'entrent dans aucun patrimoine

**Carte ouverte, non traitée.** Sortie du lot D39 par consigne : le remède
touche le moteur de valorisation, pas la surface HTTP de `app/api/banks`.

## Le fait

`getExplicitCashTotalEur` (`app/lib/cash/pockets.ts`) interroge trois tables :

```ts
prisma.bankAccount.findMany(...)
prisma.savingsAccount.findMany(...)
prisma.envelopeCash.findMany(...)
```

`TermDeposit` n'y figure pas. Vérifié plus largement : le modèle n'apparaît
nulle part sous `app/lib/portfolio/` — ni dans le chargeur historique, ni dans
le moteur. Ses seuls lecteurs applicatifs sont `app/api/term-deposits/*` et
`app/lib/cash/term-deposits-list.ts`, tous deux au service de l'onglet Banques.

## Ce que l'utilisateur voit

Un compte à terme de 50 000 € apparaît dans la section « Dépôts à terme » de
l'onglet Banques et dans la tuile qui les totalise. Le patrimoine net du
tableau de bord et la courbe de NAV l'ignorent entièrement.

Deux écrans répondent donc différemment à la même question, sans qu'aucun des
deux ne le dise.

## Pourquoi c'est plus qu'un oubli de somme

Un CAT n'est pas un solde courant. Il a un principal, une date d'échéance, un
taux, et une pénalité de retrait anticipé (`earlyWithdrawalPenaltyPct`). Le
brancher revient à décider :

1. **Ce qu'il vaut avant l'échéance** — son principal, ou son principal
   diminué de la pénalité ? Les deux se défendent : le premier est ce qu'il
   rapportera, le second ce qu'on en tirerait aujourd'hui. La doctrine du
   dépôt (« ce qu'on peut engager ») penche pour le second, celle de la
   valorisation pour le premier.
2. **Depuis quelle date il entre dans la courbe** — comme les autres poches,
   la question de l'ancre se posera : `updatedAt` seul appliquerait la valeur
   en arrière sans borne, exactement le défaut fermé en D38 puis en D39.
3. **S'il porte des intérêts courus** — les livrets en ont
   (`savingsDisplayBalance`), les CAT n'en ont pas dans ce dépôt.
4. **`isPro` et `ownershipPct`** — le modèle porte les deux colonnes
   (`prisma/schema.prisma`), et D39 vient d'établir la règle pour les comptes
   et les livrets (`app/lib/cash/ownership.ts`). Le CAT doit la suivre, et
   c'est la partie facile.

Rien de tout cela ne se tranche dans une route.

## Périmètre proposé

`app/lib/cash/pockets.ts`, `app/lib/portfolio/historical/load.ts` et le
compartiment de trésorerie. Agent : `backend-nav`, avec `finance-metier` sur
le point 1, qui est une décision de sens avant d'être du code.

## Ce qu'il ne faut pas faire

Sommer le principal dans `getExplicitCashTotalEur` et s'arrêter là. Le total
du jour deviendrait juste, la courbe ferait apparaître le dépôt entier en flux
le jour de sa dernière écriture, et on aurait déplacé le défaut au lieu de le
fermer — la leçon de D38.
