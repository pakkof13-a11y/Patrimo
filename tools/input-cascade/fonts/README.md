# La police du harnais de cascade `.input`

`ibm-plex-sans-latin.woff2` — 39,3 Ko, `sha256:056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818`

## Pourquoi un fichier de police est versionné ici

Le harnais mesure la largeur de champs qui n'en déclarent aucune : `w-auto`,
`flex-1`, `min-w-0`. Chrome la calcule alors sur `size=20` caractères de la
police retenue. Sans police fixée, la mesure décrit le système d'exploitation de
la machine qui l'exécute, pas la cascade du dépôt.

C'est ce qui s'est produit : la référence enregistrée en août 2026 portait des
largeurs qu'aucun poste Windows ne reproduisait, et l'écart — jusqu'à 23 px — ne
venait ni du CSS ni du produit, mais de la police de repli du système.

Pire : la page statique du harnais ne charge pas `next/font`. `--font-plex-sans`
y était donc **indéfinie**, `--font-sans` devenait invalide à la valeur calculée,
et le rendu retombait sur la pile générique de Tailwind. Le harnais n'a jamais
mesuré la police du produit, sur aucune machine.

## Provenance — à lire avant de « simplifier »

Ce fichier est celui que **Google Fonts** distribue, tel que `next/font/google`
le télécharge et le réémet dans `.next/static/media/` pour l'application. Il a
été extrait d'un build Next isolé faisant le même appel que `app/layout.tsx` :

```ts
IBM_Plex_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600"] })
```

C'est une police **variable** : un seul fichier couvre les quatre graisses, dont
les 400 et 600 que le harnais mesure.

**Il n'est pas identique aux fichiers publiés par IBM.** Google les a
remastérisés, et la différence porte précisément sur ce que ce harnais mesure —
mesuré sur un `<input>` vide, sans remplissage ni bordure :

| source | 13 px | 26 px | 104 px | 600 @13 px | texte @13 px |
| --- | --- | --- | --- | --- | --- |
| Google Fonts (ce fichier, = le produit) | 149 px | 282 px | 1131 px | 151 px | 78,000 |
| `@ibm/plex-sans-variable@0.2.0` | 153 px | 290 px | 1163 px | 155 px | 78,000 |
| `@ibm/plex-sans@1.1.0`, statique | 153 px | 290 px | 1163 px | 153 px | 78,000 |

Les **chasses de glyphes sont identiques** — 78,000 px pour `0123456789` dans
les trois cas. Ce qui diffère est la métrique de largeur moyenne que Chrome lit
pour dimensionner un champ, et l'écart est **proportionnel à la taille** :
4 px à 13 px, 8 px à 26 px, 32 px à 104 px. `font-stretch` n'y joue aucun rôle,
et le sous-ensemble non plus (`complete` et `split-Latin1` d'IBM donnent le même
résultat).

Conséquence : **prendre un fichier publié par IBM ferait mesurer au harnais une
largeur que l'application n'affiche jamais**, environ 2,7 % trop large sur
chaque champ intrinsèque. C'est la raison, et la seule, pour laquelle la
provenance est un CDN plutôt qu'une publication versionnée d'IBM.

## Ce que cette provenance implique

Le fichier est figé ici : une montée de version de Next n'y change rien, elle ne
modifie que le nom haché sous lequel Next le réémet.

En revanche, **si Google remastérise la police, l'application changera de
largeurs et pas cette fixture**. Le harnais divergera alors du produit, et c'est
l'empreinte ci-dessus, consignée aussi dans `baseline.json`, qui permettra de
s'en apercevoir. Le fond du problème — l'application sert une police que
personne n'a figée — dépasse ce harnais et fait l'objet d'un ticket séparé.

## Licence

SIL Open Font License 1.1, texte complet dans `LICENSE-OFL.txt`.
« Copyright © 2017 IBM Corp. with Reserved Font Name "Plex" ». La
redistribution est permise ; la licence doit accompagner le fichier, d'où sa
présence dans ce dossier.
