# audit-holdings-ui — Classes vs comptes

```
ID:             HUI-01
Gravité:        P1
Fichier:ligne:  app/lib/portfolio/service.ts:571-572 ; app/lib/assets/blockchain.ts:282-315 ; components/holdings/holdings-section.tsx:1295-1298,740-766 ; asset-workspace-sections.tsx:658-693
Reproduction:   Actif crypto détenu sur 2 dépositaires — Ledger (bitcoin, 50000€) et Binance (exchange, 5000€) — fusionné en une seule ligne Holding. blockchainKey fusionné = prev.blockchainKey || row.blockchainKey (retient la chaîne du 1er slice traité, jamais pondéré par valeur, contrairement à quantity/marketValueEur sommés). La ligne fusionnée porte blockchainKey="bitcoin" pour 55000€ (100%). Le regroupement "Blockchain" de l'onglet Positions lit ce seul champ.
Effet:          La table Positions affiche 55000€ (100%) sous "Bitcoin" et 0€ sous "Exchange/courtier", alors que la fiche détail du même actif (buildCustodyDistribution, calcul indépendant) affiche correctement 50000€/90,9% Bitcoin et 5000€/9,1% Exchange. Les deux vues du même patrimoine divergent de 5000€ (9,1%) sur l'attribution du regroupement par dépositaire — fausse la lecture du risque de garde (auto-conservation vs exchange). Le total global n'est pas affecté.
Déjà connu:     non
```

Vérifié sans constat (cohérents, pas de divergence chiffrable) : asset-class-groups.ts/categories.ts (bucketing exhaustif sur le même tableau) ; holdings-platform-slice.ts (ratios proportionnels, même taux FX) ; securities-overview.tsx/overview.ts (périmètre `positions` partagé, réconcilié) ; allocation-scope.ts (périmètre différent volontaire, documenté) ; `PortfolioAllocation.byPlatform` (mort mais inoffensif, consommé nulle part côté rendu).
