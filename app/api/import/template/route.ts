import { NextResponse } from "next/server";

const TEMPLATE = `date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class
15/03/2023;ACHAT;MC.PA;LVMH;8;612.5;12.5;EUR;;Achat initial;ACTIONS
02/07/2024;ACHAT;MC.PA;LVMH;4;658;8;EUR;;;ACTIONS
18/04/2025;DIVIDENDE;MC.PA;LVMH;;;;EUR;312;Dividende 2025;ACTIONS
10/09/2021;ACHAT;BTC;Bitcoin;0.45;38200;42;EUR;;;CRYPTO
05/03/2024;ACHAT;BTC;Bitcoin;0.12;61200;18;EUR;;;CRYPTO
18/03/2025;VENTE;BTC;Bitcoin;0.08;87500;15;EUR;;;CRYPTO
10/05/2024;APPORT;;;;;;EUR;5000;Apport compte;CASH
`;

export async function GET() {
  return new NextResponse(TEMPLATE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="patrimo-import-modele.csv"',
    },
  });
}
