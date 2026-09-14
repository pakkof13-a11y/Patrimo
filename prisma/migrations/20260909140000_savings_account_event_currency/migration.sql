-- Devise figée sur l'événement, comme sur BankAccountEvent et EnvelopeCashEvent.
--
-- Le chargeur historique convertissait chaque SavingsAccountEvent avec la devise
-- *courante* du livret : changer la devise d'un livret réécrivait rétroactivement
-- la valeur en euros de tout son passé.
--
-- Additive et non destructive : les lignes existantes prennent 'EUR', qui est
-- aussi le défaut de SavingsAccount.currency.
ALTER TABLE "SavingsAccountEvent" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';
