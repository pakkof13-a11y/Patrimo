# L'application sert une police que personne n'a figée

**Ticket ouvert, pas un chantier.** Trouvé en instrumentant le harnais de
cascade `.input` (D34) ; le sujet dépasse ce harnais et relève d'une décision
produit.

## Le fait

`app/layout.tsx` charge IBM Plex Sans et IBM Plex Mono par `next/font/google` :

```ts
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600"] });
```

`next/font/google` **télécharge le fichier depuis Google Fonts au moment du
build**, puis le réémet dans `.next/static/media/` sous un nom haché. Rien dans
le dépôt ne fige ces octets : ni un fichier versionné, ni une empreinte, ni une
version épinglée. Le lockfile épingle `next`, pas la police.

Une montée de version de Next n'y change rien — elle ne modifie que le nom sous
lequel le fichier est réémis. **Le jour où Google remastérise IBM Plex, le
prochain build servira une autre police**, et rien ne le signalera.

## Pourquoi ce n'est pas anodin

Ce n'est pas une question de dessin de lettres. Google **a déjà** remastérisé
cette police par rapport aux publications d'IBM, et la différence porte sur les
métriques que le moteur de rendu lit pour dimensionner des éléments.

Mesuré au cours de D34, sur un `<input>` vide sans remplissage ni bordure —
donc dimensionné par `size=20` caractères de la police :

| source | 13 px | 26 px | 104 px | 600 @13 px | texte @13 px |
| --- | --- | --- | --- | --- | --- |
| Google Fonts (ce que sert l'application) | 149 px | 282 px | 1131 px | 151 px | 78,000 |
| `@ibm/plex-sans-variable@0.2.0` | 153 px | 290 px | 1163 px | 155 px | 78,000 |
| `@ibm/plex-sans@1.1.0` (statique) | 153 px | 290 px | 1163 px | 153 px | 78,000 |

Les **chasses de glyphes sont identiques** — `0123456789` occupe 78,000 px dans
les trois cas. Ce qui diffère est la métrique de largeur moyenne, et l'écart est
**proportionnel à la taille** : 4 px à 13 px, 8 px à 26 px, 32 px à 104 px.
`font-stretch` n'y joue aucun rôle, le sous-ensemble non plus.

Autrement dit : deux fichiers qui affichent le même texte à l'identique
dimensionnent les champs différemment. Un remastérisage de cette nature
décalerait **la largeur de tous les champs à largeur intrinsèque de
l'application** — aujourd'hui 15 combinaisons de classes, 32 occurrences dans
le dépôt — sans un commit, sans un diff, sans qu'aucun test hors du harnais ne
s'en aperçoive.

## Ce que D34 a fait, et ce qu'il n'a pas fait

Le harnais `tools/input-cascade/` embarque désormais une copie figée du fichier
servi par Google (`tools/input-cascade/fonts/`, empreinte consignée dans
`baseline.json`). **Le harnais est donc à l'abri ; l'application ne l'est pas.**

Cette asymétrie est même une propriété utile à court terme : le jour où Google
change la police, le harnais divergera du produit et ses tests le diront. Mais
il le dira **après coup**, et il ne dit rien du reste de l'interface — colonnes,
troncatures, gabarits — qui dépend aussi des métriques du texte.

## Options

1. **Auto-héberger** : passer de `next/font/google` à `next/font/local`, avec
   les fichiers versionnés dans le dépôt. La police devient un actif comme un
   autre, revue en revue de code quand elle change. Coût : quelques fichiers
   `woff2` dans l'historique, et le choix des sous-ensembles à faire à la main
   plutôt qu'à laisser faire. Bénéfice : la police cesse d'être une entrée non
   maîtrisée, et le harnais et le produit servent le même octet.
2. **Rester sur Google et surveiller** : conserver `next/font/google`, et
   ajouter une vérification qui compare l'empreinte du fichier émis au build à
   celle attendue. Coût plus faible, mais la dérive est constatée au lieu d'être
   empêchée, et il faut un endroit où l'empreinte attendue vit.
3. **Ne rien faire**, en connaissance de cause, et accepter qu'un décalage de
   gabarit puisse arriver sans commit.

Recommandation : l'option 1. C'est la seule qui supprime l'entrée non maîtrisée
au lieu de l'observer, et elle aligne le produit sur ce que le harnais fait déjà.

## Ce qui n'a pas été vérifié

L'impact au-delà des champs à largeur intrinsèque n'a pas été mesuré. Les
tableaux, les libellés tronqués et les gabarits dépendent eux aussi des
métriques du texte, mais ces métriques-là — les chasses — se sont révélées
identiques entre les deux fichiers. Le risque porte donc surtout sur ce que le
moteur dimensionne à partir de la largeur moyenne : les contrôles de formulaire
sans largeur déclarée. Il faudrait une passe dédiée pour l'affirmer plus loin.
