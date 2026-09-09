import { findOrCreatePlatform } from "./upsert";
import { findPreset, primaryType } from "./presets";

/**
 * Assure une plateforme homonyme pour qu'un produit bancaire apparaisse dans
 * Sources → Plateformes.
 *
 * Trois routes en portaient une copie mot pour mot — comptes courants, livrets,
 * dépôts à terme — et la quatrième en avait besoin : le PATCH d'un dépôt, qui
 * ne l'appelait pas du tout. Renommer la banque d'un CAT le regroupait alors
 * sous un établissement sans tuile.
 *
 * Les deux routes des dépôts à terme lisent celle-ci ; les deux autres gardent
 * la leur pour l'instant, à unifier séparément.
 *
 * L'échec n'interrompt jamais l'appelant : la plateforme est un confort
 * d'affichage, pas une condition de l'écriture qui vient d'aboutir. Mais il ne
 * doit se produire qu'**après** cette écriture — une requête qui échoue ne
 * laisse pas de plateforme derrière elle (D39, D40).
 */
export async function ensureBankPlatform(
  userId: string,
  bankName: string | null | undefined
): Promise<void> {
  const name = (bankName || "").trim();
  // Deux caractères : en dessous, ce n'est pas un nom d'établissement.
  if (name.length < 2) return;
  const preset = findPreset(name);
  try {
    await findOrCreatePlatform(userId, {
      name: preset?.name || name,
      type: preset ? primaryType(preset) : "BANQUE",
      logoKey: preset?.key || null,
      logoUrl: preset?.logoUrl || null,
    });
  } catch {
    /* non bloquant */
  }
}
