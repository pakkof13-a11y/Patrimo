# Le scan de secrets de la CI ne regarde jamais en arrière

**Ticket ouvert, pas un chantier.** Trouvé en tentant de faire exécuter le
harnais de cascade `.input` par la CI (D35) ; le sujet dépasse ce chantier.

## Le fait

Le job `secrets` du workflow CI lance `gitleaks/gitleaks-action@v2`. Son
comportement dépend de l'événement qui déclenche le workflow :

- sur un **`push`**, il ne scanne que l'intervalle de commits poussé ;
- sur un **`workflow_dispatch`**, il scanne **tout l'historique**.

Mesuré, et non déduit — deux exécutions du même workflow sur le même dépôt, à
un jour d'intervalle :

```
run 34259482536   push sur staging      1 commits scanned.    no leaks found
run 34326815501   workflow_dispatch     559 commits scanned.  leaks found: 5
```

La CI est donc verte depuis toujours **parce qu'elle ne regarde qu'un commit à
la fois**. Un secret introduit puis retiré dans le même intervalle poussé serait
vu ; un secret introduit dans un commit et découvert plus tard ne l'est jamais.

## Ce que le premier scan complet a révélé

Cinq constats, tous en règle `generic-api-key`. Contenu vérifié au commit où
chacun a été signalé.

| # | fichier · ligne | commit · date | nature |
| --- | --- | --- | --- |
| 1 | `e2e/platforms.spec.ts:206` | `e631533f` · 2026-08-23 | `const SECRET = "zk_prod_e2e_secret_…"` — fixture E2E factice |
| 2 | `app/lib/portfolio/evolution-prefs.ts:21` | `0f5bd392` · 2026-07-30 | clé de stockage local `evolutionPrefs.v5` |
| 3 | `app/lib/zerion/chains.ts:146` | `1dc89421` · 2026-07-20 | **`DEFAULT_ZERION_API_KEY`, clé réelle** |
| 4 | `app/lib/portfolio/evolution-prefs.ts:16` | `e13b7d23` · 2026-07-17 | clé de stockage local `evolutionPrefs.v4` |
| 5 | `app/lib/notifications/context.tsx:18` | `ebe5dac6` · 2026-07-16 | clé de stockage local `patrimo.notifications.v1` |

**Quatre sur cinq sont des faux positifs** : trois clés de `localStorage` et une
constante de test dont la valeur est manifestement synthétique. La règle
`generic-api-key` se déclenche sur l'entropie d'une chaîne assignée à un
identifiant qui *ressemble* à un secret — `SECRET`, `KEY` — sans savoir ce que
la valeur désigne.

**Le troisième était une vraie clé d'API Zerion**, committée le 20 juillet 2026.
La source courante est assainie depuis (`chains.ts:150` porte
`export const DEFAULT_ZERION_API_KEY = "";`), mais la valeur restait lisible
dans l'historique d'un dépôt public.

Elle est **traitée** : l'ancienne clé a été supprimée chez Zerion avant qu'une
nouvelle soit créée, et la nouvelle vit dans `.env` et dans la configuration
Vercel. La valeur qui subsiste dans l'historique ne donne plus accès à rien.

**L'historique n'est pas réécrit**, décision prise : le dépôt est public et déjà
cloné, le coût d'une réécriture dépasse le gain une fois la clé morte.

Ce qu'il faut retenir du délai : la clé est restée exposée **sept semaines**, et
ce n'est pas la CI qui l'a trouvée — c'est un `workflow_dispatch` lancé pour une
raison sans rapport.

## Ce qui reste vrai, et qu'il faut trancher

Sur **tout scan complet à venir**, la clé Zerion morte continuera d'être
signalée, au même titre que les quatre faux positifs. Cinq constats
apparaîtront, dont aucun ne demande d'action.

C'est le problème classique du scanner qu'on n'a jamais fait tourner : le
premier passage produit un bruit de fond qu'il faut neutraliser avant que
l'outil devienne utile. Sans quoi le sixième constat — celui qui comptera —
arrivera au milieu de cinq qu'on a appris à ignorer.

## Options

**(a) Scan complet périodique, avec une baseline documentée.** Un déclencheur
`schedule` — hebdomadaire, par exemple — qui scanne tout l'historique, et un
`.gitleaksignore` à la racine listant les cinq empreintes connues :

```
e631533f9a245a6fc346c44da36b4833a241561f:e2e/platforms.spec.ts:generic-api-key:206
0f5bd392555c1e2132b37dac033a20236036a249:app/lib/portfolio/evolution-prefs.ts:generic-api-key:21
1dc8942142649447b332a6a92852d2bdf8900995:app/lib/zerion/chains.ts:generic-api-key:146
e13b7d2357895460f646b57d5d00c039bd0b24c2:app/lib/portfolio/evolution-prefs.ts:generic-api-key:16
ebe5dac6e463af6f2799ea29e6dfc1c4e6b404a4:app/lib/notifications/context.tsx:generic-api-key:18
```

Ces cinq empreintes ont été vérifiées une par une : chaque commit existe, et la
ligne citée porte bien la déclaration signalée.

Une baseline **n'est pas un silence** si chaque entrée porte sa raison — d'où
l'intérêt de commenter le fichier, et de traiter la ligne Zerion à part : elle
n'est pas un faux positif, c'est un secret mort qu'on assume de ne pas effacer.

Coût : un job de plus, hors du chemin des PR, donc sans effet sur la latence de
développement. Bénéfice : le sixième constat se verra.

**(b) Baseline seule, sans scan périodique.** Poser le `.gitleaksignore` pour
que le prochain scan complet, quand il arrivera, soit lisible — mais ne rien
programmer. Coût nul, bénéfice différé : on prépare le terrain sans jamais y
marcher.

**(c) Statu quo assumé.** On accepte que le scan ne regarde qu'un commit à la
fois, et on documente que ce filet n'attrape que ce qui entre — jamais ce qui
est déjà là. C'est défendable si l'on considère que le vrai contrôle est
ailleurs (revue de code, `docs/secrets.md`), mais alors il faut cesser de croire
que la CI protège l'historique.

## Recommandation

**(a)**, et dans cet ordre : d'abord le `.gitleaksignore` commenté, ensuite le
déclencheur `schedule`. L'inverse ferait démarrer le scan sur cinq constats et
apprendrait à l'équipe à ignorer ce job dès sa première exécution.

Un point de méthode que cet épisode illustre, et qui vaut au-delà du sujet :
c'est la même famille de défaut que D33 — un contrôle qui *passe* sans avoir
rien vérifié. Là c'étaient deux tests qui sautaient en silence ; ici c'est un
scan qui ne lit qu'une ligne d'histoire. Dans les deux cas le tableau de bord
est vert, et dans les deux cas il ne veut rien dire.

## Ce qui n'a pas été vérifié

Le comportement exact de `gitleaks-action@v2` sur un événement `pull_request`
n'a pas été mesuré — seulement `push` et `workflow_dispatch`. L'action scanne
probablement l'intervalle de la branche, mais je ne l'ai pas constaté et ne
l'affirme pas.

Le dépôt n'a pas non plus été audité au-delà de ce que `gitleaks` signale : cinq
constats sur 559 commits, avec un seul jeu de règles, ne disent pas qu'il n'y a
rien d'autre.
