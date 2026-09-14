-- Devise figée sur l'événement, comme sur EnvelopeCashEvent.
--
-- Le chargeur historique convertissait chaque BankAccountEvent avec la devise
-- *courante* du compte : changer la devise d'un compte réécrivait rétroactivement
-- la valeur en euros de tout son passé. La colonne fige l'unité au moment du fait.
--
-- Additive et non destructive : les lignes existantes prennent 'EUR', qui est
-- aussi le défaut de BankAccount.currency.
ALTER TABLE "BankAccountEvent" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EUR';
