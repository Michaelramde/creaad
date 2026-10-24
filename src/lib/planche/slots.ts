/**
 * Slots de vues obligatoires par catégorie (SPEC §9.2).
 * Une planche est jugée sur ce qu'elle couvre : un slot manquant fait baisser
 * le score et est **nommé** à l'utilisateur.
 */
import type { Category, Regime } from "../matching/types.ts";

export type SlotId =
  | "face" | "trois-quarts" | "profil" | "dos" | "sommet" | "dessous"
  | "macro-label" | "macro-capuchon" | "macro-lace" | "macro-tissu" | "macro-couture"
  | "longueur-etiree" | "a-plat" | "porte" | "tranches" | "ecran-allume" | "echelle-main";

export interface SlotSpec {
  id: SlotId;
  label: string;
  /** Poids relatif — un macro de label pèse plus qu'une vue de dessus. */
  weight: number;
  /** Un slot `macro` exige une image zoomée : la résolution y compte double. */
  macro: boolean;
}

const slot = (id: SlotId, label: string, weight: number, macro = false): SlotSpec => ({
  id,
  label,
  weight,
  macro,
});

export const REQUIRED_SLOTS: Record<Category, SlotSpec[]> = {
  beaute: [
    slot("face", "Face avant", 1),
    slot("trois-quarts", "Trois-quarts", 1),
    slot("dos", "Dos / étiquette arrière", 1),
    slot("macro-label", "Macro du label", 2, true),
    slot("macro-capuchon", "Macro du capuchon / bouchon", 1, true),
  ],
  cheveux: [
    slot("face", "Face avant", 1),
    slot("profil", "Profil", 1),
    slot("dos", "Dos", 1),
    slot("sommet", "Sommet / couronne", 1),
    slot("macro-lace", "Macro du lace", 2, true),
    slot("longueur-etiree", "Longueur étirée", 1),
  ],
  mode: [
    slot("a-plat", "Vue à plat", 1),
    slot("porte", "Porté", 1),
    slot("macro-tissu", "Macro du tissu", 2, true),
    slot("macro-couture", "Macro couture / finition", 1, true),
  ],
  gadgets: [
    slot("face", "Face avant", 1),
    slot("dos", "Dos", 1),
    slot("tranches", "Tranches / ports", 1),
    slot("ecran-allume", "Écran allumé", 1),
    slot("echelle-main", "Échelle en main", 1),
  ],
};

/**
 * Vues obligatoires pour un régime donné.
 *
 * Un commerçant qui **possède** le produit peut être envoyé photographier un
 * macro de label. Un commerçant qui ne l'a pas dépend des photos fournisseur,
 * et celles-ci ne contiennent jamais ce genre de détail : exiger un macro le
 * condamnerait à un refus permanent. Les macros deviennent donc facultatives
 * en régime `non_detenu` — leur absence n'est plus bloquante.
 */
export function requiredSlots(category: Category, regime: Regime = "detenu"): SlotSpec[] {
  const slots = REQUIRED_SLOTS[category];
  return regime === "non_detenu" ? slots.filter((slot) => !slot.macro) : slots;
}

export function slotsFromAngles(angles: readonly (string | undefined)[]): SlotId[] {
  const known = new Set(Object.values(REQUIRED_SLOTS).flat().map((s) => s.id));
  return angles.filter((a): a is SlotId => Boolean(a) && known.has(a as SlotId));
}
