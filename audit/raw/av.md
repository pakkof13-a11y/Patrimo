# audit-av — Assurance-Vie (double compte, devise, orphelins)

```
ID:             AV-01
Gravité:        P1
Fichier:ligne:  app/lib/life-insurance/performance-service.ts:329-333 (flux inscrit sur le jour) et :523 (jour incomplet retiré avec son flux, sans report)
Reproduction:   Contrat cA : support X couvert (10000€ plat), support Y acheté samedi 2026-03-07 pour 10000€, 1ère clôture Y en cache le lundi 09/03. Range "all", now 2026-03-10. Points = 02..06 (10000, idx100) puis 09 (20000, idx200) ; 07 et 08 absents. cA.performancePct=100, total.performancePct=100. Attendu : 0 (TWR hors flux).
Effet:          Un versement de 10000€ ressort en +100% de performance (contrat ET consolidé) ; symétrique pour un rachat sur jour incomplet (−50%). Se déclenche dès qu'un flux tombe un jour où un support couvert n'a aucune clôture à reporter (achat week-end/férié, avant 1ère clôture fournisseur). Viole "espacer sans sommer les flux fait passer un apport pour de la performance".
Déjà connu:     non

ID:             AV-02
Gravité:        P3
Fichier:ligne:  app/lib/life-insurance/migrate-to-ledger.ts:317,320,331 (et :126/128, champs `valueEur` sans devise)
Reproduction:   Contrat avec LifeInsuranceProduct currentValue=10000, currency="USD" (taux 1,08). auditLifeInsurance → toMigrateEur="10000.00" ; scripts/migrate-life-insurance.ts:123 l'imprime « 10000€ ». Idem doubleCountedEur.
Effet:          Totaux d'audit annoncés en euros additionnant des montants en devises hétérogènes : 10000 USD comptés 10000€ au lieu de 9259,26€ (écart 740,74€). La migration elle-même convertit correctement ; seul le compte-rendu à blanc lu avant --apply est faux.
Déjà connu:     partiellement (test contract-scoping.test.ts:149 : "toMigrate ne porte pas la devise")

ID:             AV-03
Gravité:        P3
Fichier:ligne:  app/lib/life-insurance/coupon-schedule.ts:200 (boucle dans l'ordre reçu) et :227-233 (cursorPassed→alreadySettled)
Reproduction:   Support 10000€ à 8% trimestriel, aucun curseur. Un POST avec decisions=[{sept,paid},{juin,paid}]. Sept → créé, curseur=20/09 ; juin → alreadySettled++, aucune écriture.
Effet:          200€ de coupon confirmé "versé" jamais journalisé, rapporté "déjà tranché" ; l'échéance de juin n'est plus jamais proposée. Dépend uniquement de l'ordre du tableau reçu. [NON MESURÉ sur le client réel]
Déjà connu:     non

ID:             AV-04
Gravité:        P3
Fichier:ligne:  app/lib/life-insurance/coupon-schedule.ts:111-113 (et :249-254 côté settleCoupons)
Reproduction:   Structuré MATURITY, nominal 10000€, taux 8%, strike 2024-03-20, échéance 2031-03-20, now 2031-04-01. listPendingCoupons propose 800€ (un seul coupon annuel).
Effet:          Montant proposé au terme = 1 année de coupon (800€) pour un produit qui en a couru 7 (5600€ en simple). Proposition modifiable, mais le défaut sous-estime de 4800€. Documenté comme choix (constants.ts:107-111) — à trancher par finance-metier.
Déjà connu:     non

ID:             AV-05
Gravité:        P3
Fichier:ligne:  app/lib/life-insurance/support-service.ts:666-668 (kindFromAssetClass), :755-763 (persisté à l'attachement) ; :508-570/route.ts:76 (kind non modifiable)
Reproduction:   Position AV sans fiche (reprise ancienne), reclassée OBLIGATIONS par l'utilisateur. Rattachement au contrat → fiche créée kind="FONDS_EURO". Aucune route ne permet ensuite de corriger kind.
Effet:          Un fonds obligataire à risque est rangé définitivement en "Fonds en euros" : allocation, libellé contrat, euroSharePct faussés. [NON MESURÉ : dépend de données legacy reclassées]
Déjà connu:     non
```
