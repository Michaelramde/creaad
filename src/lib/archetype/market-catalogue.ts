/**
 * Catalogue des marchés **réellement collectés** — et le vocabulaire qui les relie.
 *
 * C'est la correction de la faille centrale : jusqu'ici, un slug était produit
 * par une heuristique (`buildArchetype`) et comparé à un vocabulaire écrit à
 * la main dans `seeds.json`. Sur 16 slugs collectés, l'heuristique en
 * retrouvait 3 par coïncidence (mesuré le 25/10).
 *
 * Désormais chaque marché déclare :
 *   · ses `nouns` — les mots qui désignent le TYPE de produit (français ET
 *     anglais, car les fiches fournisseur sont en anglais) ;
 *   · ses `modifiers` — ce qui le distingue d'un voisin (femme/homme,
 *     bluetooth, visage, croissance…).
 *
 * `mode-produit` est volontairement ABSENT : c'est le seau de repli où
 * 18 annonces ont atterri sans que personne ne l'ait voulu. On ne route
 * jamais vers lui.
 */
import type { Category } from "../matching/types.ts";

export interface MarketEntry {
  slug: string;
  label: string;
  category: Category;
  /** Mots qui désignent le type de produit (FR + EN). */
  nouns: string[];
  /** Ce qui distingue ce marché de son voisin. Vide = marché générique. */
  modifiers: string[];
}

export const MARKET_CATALOGUE: MarketEntry[] = [
  {
    slug: "beaute-serum-30ml",
    label: "Sérum visage 30 ml",
    category: "beaute",
    nouns: ["serum", "serums", "ampoule", "essence", "serum visage"],
    modifiers: ["visage", "vitamine", "30ml", "eclaircissant", "anti tache"],
  },
  {
    slug: "beaute-creme-visage",
    label: "Crème visage",
    category: "beaute",
    nouns: ["creme", "cremes", "cream", "moisturizer", "lotion", "baume"],
    modifiers: ["visage", "face", "nuit", "jour"],
  },
  {
    slug: "beaute-savon-noir",
    label: "Savon noir",
    category: "beaute",
    nouns: ["savon", "savons", "soap"],
    modifiers: ["noir", "africain"],
  },
  {
    slug: "beaute-huile-corporelle",
    label: "Huile corporelle",
    category: "beaute",
    nouns: ["huile", "huiles", "oil", "beurre"],
    modifiers: ["corporelle", "corps", "body", "karite"],
  },
  {
    slug: "beaute-parfum",
    label: "Parfum",
    category: "beaute",
    nouns: ["parfum", "parfums", "perfume", "fragrance", "eau de toilette", "deodorant"],
    modifiers: [],
  },
  {
    slug: "cheveux-perruque-lace",
    label: "Perruque lace",
    category: "cheveux",
    nouns: ["perruque", "perruques", "wig", "wigs", "closure", "tissage", "extension"],
    modifiers: ["lace", "frontale", "body wave", "cheveux"],
  },
  {
    slug: "cheveux-huile-croissance",
    label: "Huile de croissance cheveux",
    category: "cheveux",
    nouns: ["huile", "huiles", "oil", "serum"],
    modifiers: ["croissance", "cheveux", "hair", "growth", "capillaire"],
  },
  {
    slug: "cheveux-mousse-boucles",
    label: "Mousse boucles",
    category: "cheveux",
    nouns: ["mousse", "gel", "foam", "creme"],
    modifiers: ["boucles", "boucle", "cheveux", "curl", "coiffant"],
  },
  {
    slug: "mode-sac",
    label: "Sac",
    category: "mode",
    nouns: ["sac", "sacs", "bag", "bags", "sacoche", "cartable", "valise", "porte cartes", "banane", "backpack", "sac a dos"],
    modifiers: [],
  },
  {
    slug: "mode-sac-femme",
    label: "Sac femme",
    category: "mode",
    nouns: ["sac", "sacs", "bag", "bags", "sacoche", "pochette", "clutch", "handbag"],
    modifiers: ["femme", "femmes", "dame", "ladies", "women", "fille"],
  },
  {
    slug: "mode-robe-wax",
    label: "Robe wax",
    category: "mode",
    nouns: ["robe", "robes", "dress", "ensemble", "boubou", "abaya"],
    modifiers: ["wax", "pagne", "africain", "bazin"],
  },
  {
    slug: "mode-chaussure-homme",
    label: "Chaussure homme",
    category: "mode",
    nouns: ["chaussure", "chaussures", "sneaker", "basket", "sandale", "shoe", "shoes", "mocassin"],
    modifiers: ["homme", "men", "masculin", "cuir"],
  },
  {
    slug: "gadgets-ecouteur-bluetooth",
    label: "Écouteurs Bluetooth",
    category: "gadgets",
    nouns: ["ecouteur", "ecouteurs", "casque", "earbuds", "headphone", "headphones", "tws", "airpods"],
    modifiers: ["bluetooth", "sans fil", "wireless"],
  },
  {
    slug: "gadgets-montre-connectee",
    label: "Montre connectée",
    category: "gadgets",
    nouns: ["montre", "montres", "watch", "smartwatch", "bracelet"],
    modifiers: ["connectee", "smart", "intelligente"],
  },
  {
    slug: "gadgets-ventilateur-portable",
    label: "Ventilateur portable",
    category: "gadgets",
    nouns: ["ventilateur", "ventilateurs", "fan", "ventilo"],
    modifiers: ["portable", "mini", "usb", "rechargeable"],
  },
  {
    slug: "gadgets-coque-telephone",
    label: "Coque téléphone",
    category: "gadgets",
    nouns: ["coque", "coques", "case", "housse", "etui", "shell"],
    modifiers: ["telephone", "samsung", "iphone", "phone", "portable"],
  },
];
