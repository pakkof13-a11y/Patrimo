# audit-api-cron — mécanisme d'authentification (hors OOM/staleness déjà audités)

```
ID:             API-C-01
Gravité:        P2
Fichier:Ligne:  env/runtime.ts:73-110 ; docs/secrets.md:31 ; vercel.json:7
Reproduction:   Déployer sans CRON_SECRET. Vercel Cron appelle GET sans header → timingSafeEqualSecret retourne false (secret vide) → 401, rien n'est écrit. /api/health expose cronSecretConfigured:false mais ne le transforme jamais en avertissement (configWarnings=[]).
Effet:          Secret manquant → la route se FERME (401, comportement sûr, pas de bypass) mais silencieusement : le cron planifié échoue chaque nuit sans signal opérationnel ; docs/secrets.md classe CRON_SECRET "Requis: Non" alors qu'un cron est planifié.
Déjà connu:     non

ID:             API-C-02
Gravité:        P3
Fichier:Ligne:  env/runtime.ts:60,121 ; docs/readiness.md:80
Reproduction:   CRON_SECRET de 8 caractères → timingSafeEqualSecret accepte (seuil≥8) → cron autorisé. /api/health déclare cronSecretConfigured:false (seuil≥16 dans la sonde). Docs exigent min. 16.
Effet:          Deux seuils différents pour une même décision de sécurité ; entropie minimale non garantie côté handler. [NON MESURÉ] absence de rate-limit sur /api/cron/**.
Déjà connu:     non

ID:             API-C-03
Gravité:        P2
Fichier:Ligne:  vercel.json:5-10 ; savings/accrue/route.ts:13 ; README.md:252
Reproduction:   Un seul cron dans vercel.json (collect-intraday, GET). savings/accrue est un second endpoint en mode cron (Bearer CRON_SECRET, dispensé de session) mais absent de vercel.json — et n'expose que POST, alors que Vercel Cron appelle en GET.
Effet:          Endpoint cron hors du dossier app/api/cron/ non couvert par l'audit précédent : l'accrual des livrets, documenté comme "cron" (README), n'est jamais déclenché automatiquement.
Déjà connu:     non
```

Vérifié sans constat : comparaison en temps constant (crypto.timingSafeEqual, normalisation de longueur) ; GET exige le secret sans repli session ; POST avec faux header + session valide retombe en mode utilisateur scopé, jamais en mode cron ; proxy auth.ts ne dispense de session que sur /api/cron/** et /api/savings/accrue, la décision réelle restant au handler ; un seul route.ts sous app/api/cron/.
