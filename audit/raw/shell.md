# audit-shell — kpi-strip, préférences, wipe, onboarding

```
ID:             SHELL-01
Gravité:        P2
Fichier:Ligne:  dashboard/kpi-strip.tsx:152-161 ; app/portfolio-app.tsx:1239-1252
Reproduction:   Préférence "P&L latent — période" = 1M. Le seul appelant de KpiStrip ne passe plus `history` (retiré de /api/portfolio) → periodLatent=null → latentValue retombe sur le cumul "Tout".
Effet:          Tuile annonce "P&L latent (1M)" mais affiche le cumul total — chiffre faux sous son libellé sur toutes les périodes sauf "Tout". La préférence reste proposée sans effet.
Déjà connu:     non (résidu du retrait de history[] déjà connu, pas ce symptôme précis)

ID:             SHELL-02
Gravité:        P2
Fichier:Ligne:  app/portfolio-app.tsx:252,1064-1072 ; api/holdings/route.ts:40
Reproduction:   Changer la devise de reporting en USD → persisté (user.baseCurrency=USD). F5 ou nouvelle session : useState("EUR") jamais réalimenté depuis le serveur.
Effet:          Préférence persistée mais jamais restaurée : le shell repart toujours en EUR au chargement.
Déjà connu:     non

ID:             SHELL-03
Gravité:        P2
Fichier:Ligne:  app/portfolio-app.tsx:812,1250,1312 ; holdings-section.tsx:1872-2038
Reproduction:   GET /api/holdings en échec (500/504). `loading = isPending && !data` = false ; allHoldings retombe sur [] sans lire holdingsQ.isError.
Effet:          Une requête en échec est rendue comme un portefeuille vide, avec incitation à importer un CSV — indiscernable d'un compte réellement vide.
Déjà connu:     non

ID:             SHELL-04
Gravité:        P2
Fichier:Ligne:  app/portfolio-app.tsx:886,1451-1464
Reproduction:   GET /api/patrimony-state en échec (retry 1). patrimonyResolved=false sans branche isError.
Effet:          Tableau de bord = squelette de chargement permanent (aria-busy), sans message ni bouton "réessayer", jusqu'à F5.
Déjà connu:     non

ID:             SHELL-05
Gravité:        P2 [NON MESURÉ]
Fichier:Ligne:  portfolio/clear-user-data.ts:31 ; prisma.ts:41-56
Reproduction:   $transaction sans timeout/maxWait explicite (défaut Prisma 5s). Compte volumineux: cascade PriceQuote/PriceHistory/AssetDailyClose/AssetIntradayBar via Neon WebSocket.
Effet:          2e mode d'échec du wipe indépendant du RESTRICT déjà connu — dépassement de budget possible sur un compte volumineux, rollback intégral.
Déjà connu:     non

ID:             SHELL-06
Gravité:        P2 [NON MESURÉ]
Fichier:Ligne:  api/admin/users/route.ts:146 ; schema.prisma:238,1681
Reproduction:   Suppression admin d'un utilisateur avec Asset ou SecuritiesAccount: ordre des cascades User→Platform vs User→Asset/SecuritiesAccount non garanti (tous deux RESTRICT sur Platform).
Effet:          Même racine que le wipe déjà connu (RESTRICT), surface nouvelle : suppression admin potentiellement refusée en 500.
Déjà connu:     non (racine connue, surface admin non couverte)

ID:             SHELL-07
Gravité:        P3
Fichier:Ligne:  portfolio/patrimony-state.ts:99-166
Reproduction:   Compte dont la seule donnée est un SecuritiesAccount/TermDeposit/TradingAccount/DefiStrategy/PreciousMetalSale — aucune de ces familles n'est interrogée par isEmpty, malgré le commentaire "miroir exact du wipe".
Effet:          Cockpit "Bienvenue, commencez par…" affiché par-dessus des données réelles ; dashboard inaccessible tant qu'aucune autre famille n'existe.
Déjà connu:     non

ID:             SHELL-08
Gravité:        P3
Fichier:Ligne:  portfolio/clear-user-data.ts:36-117
Reproduction:   `.catch(()=>({count:0}))`/try-catch À L'INTÉRIEUR du $transaction Postgres — une requête en erreur avorte déjà toute la transaction, la tolérance est illusoire.
Effet:          La vraie cause d'échec est masquée dans les logs ; aucun wipe partiel contrôlé possible. tradingDeleted absent du type ResetUserDataResult.
Déjà connu:     non

ID:             SHELL-09
Gravité:        P3
Fichier:Ligne:  portfolio/clear-user-data.ts:19-26 ; schema.prisma:28-38
Reproduction:   taxHousehold/marginalTaxRatePct renseignés, puis wipe complet — le wipe ne touche jamais le modèle User.
Effet:          Profil fiscal conservé après un wipe présenté comme "retour au premier lancement", ré-appliqué silencieusement aux futurs calculs IFI/fiscaux.
Déjà connu:     non

ID:             SHELL-10
Gravité:        P3
Fichier:Ligne:  ui/user-avatar-prefs.ts:7-17 ; ui-preferences.ts:5,34-41 ; header-account-menu.tsx:276
Reproduction:   Utilisateur A charge un avatar + vues enregistrées (avec termes de recherche), se déconnecte sans nettoyage localStorage. Utilisateur B se connecte sur le même navigateur — clés `patrimo.ui.*` non préfixées par userId.
Effet:          B voit la photo, les vues enregistrées (noms, recherches) et les réglages de confidentialité de A. Un wipe ne les efface pas non plus.
Déjà connu:     non

ID:             SHELL-11
Gravité:        P3
Fichier:Ligne:  dashboard/dashboard-tab.tsx:225-237
Reproduction:   Supprimer la seule position d'une classe d'actif. Le refetch renvoie allocation.byClass=[] ; stableAllocation ne se met à jour que si non vide → l'ancienne répartition reste affichée.
Effet:          Camembert et part crypto continuent d'afficher la position supprimée jusqu'à F5 — répartition vide indiscernable d'un rafraîchissement en cours.
Déjà connu:     non

ID:             SHELL-12
Gravité:        P3
Fichier:Ligne:  preferences-panel.tsx:220-244 ; trading-tab.tsx:111-114 ; real-estate-tab.tsx:98-102
Reproduction:   Ouvrir Trading puis Immobilier (caches à staleTime 60s), effacer le patrimoine, rouvrir ces onglets dans la minute — ces clés de cache ne figurent ni dans la liste post-wipe ni dans invalidatePortfolioView.
Effet:          Positions à levier et biens immobiliers affichés comme présents après le wipe, sans indicateur, jusqu'à expiration du cache ou F5.
Déjà connu:     non
```
