/**
 * Jeux de démonstration — mêmes formes que la production, validés par les
 * contrats Zod (voir `tests/fixtures.test.ts`).
 *
 * Servent à deux choses : la démonstration publique (SPEC §4.1) et le
 * développement des écrans sans dépendre des clés API.
 */
import type { CreativeKit, MarketKit, ProductKit } from "../contracts/index.ts";

const NOW = "2026-10-20T09:00:00.000Z";

export const demoProductKit: ProductKit = {
  source: {
    listingUrl: "https://www.aliexpress.com/item/1005006.html",
    title: "Sérum Vitamine C 30 ml — visage, éclat",
    supplierSku: "AE-SERUM-C-30",
    matchScore: 87,
    variant: "Flacon 30 ml — jaune",
  },
  identity: {
    archetype: "beaute-serum-30ml",
    brand: "Non marqué",
    category: "beaute",
    subcategory: "Soin du visage",
  },
  specs: {
    dimensions: {
      value: "11,2 × 3,4 × 3,4 cm",
      sources: [
        { url: "https://www.aliexpress.com/item/1005006.html", platform: "aliexpress" },
        { url: "https://www.jumia.ci/serum-c-30ml.html", platform: "jumia" },
      ],
      confidence: "medium",
    },
    capacity: {
      value: "30 ml",
      sources: [{ url: "https://www.aliexpress.com/item/1005006.html", platform: "aliexpress" }],
      confidence: "high",
    },
    material: {
      value: "Verre ambré, bouchon plastique doré",
      sources: [{ url: "https://www.jumia.ci/serum-c-30ml.html", platform: "jumia" }],
      confidence: "low",
    },
    packContents: {
      value: "1 flacon + 1 pipette",
      sources: [{ url: "https://www.aliexpress.com/item/1005006.html", platform: "aliexpress" }],
      confidence: "medium",
    },
  },
  claims: [
    {
      text: "Sans parfum",
      source: { url: "https://www.aliexpress.com/item/1005006.html", platform: "aliexpress" },
      verified: false,
      hypothesis: false,
    },
    {
      text: "Éclaircit les taches en 2 semaines",
      verified: false,
      hypothesis: true,
    },
  ],
  labelOcr: {
    raw: "VITAMIN C SERUM 30ml BRIGHTENING",
    corrected: "VITAMIN C SERUM 30 ml — BRIGHTENING",
    fields: [
      { key: "produit", value: "Vitamin C Serum" },
      { key: "contenance", value: "30 ml" },
    ],
  },
  variant: { colorName: "Jaune", colorHex: "#E8C55A", capacity: "30ml" },
  images: [
    { id: "img-face", url: "https://cdn.example/face.jpg", slot: "face", provenance: "fournisseur", width: 1600, height: 1600, hasWatermark: false, isDistinctSource: true },
    { id: "img-34", url: "https://cdn.example/trois-quarts.jpg", slot: "trois-quarts", provenance: "fournisseur", width: 1600, height: 1600, hasWatermark: false, isDistinctSource: true },
    { id: "img-dos", url: "https://cdn.example/dos.jpg", slot: "dos", provenance: "fournisseur", width: 1400, height: 1400, hasWatermark: false, isDistinctSource: true },
    { id: "img-label", url: "https://cdn.example/label.jpg", slot: "macro-label", provenance: "fournisseur", width: 2048, height: 2048, hasWatermark: false, isDistinctSource: true },
    { id: "img-cap", url: "https://cdn.example/capuchon.jpg", slot: "macro-capuchon", provenance: "utilisateur", width: 1800, height: 1800, hasWatermark: false, isDistinctSource: true },
  ],
  coverage: {
    requiredSlots: ["face", "trois-quarts", "dos", "macro-label", "macro-capuchon"],
    filled: ["face", "trois-quarts", "dos", "macro-label", "macro-capuchon"],
    missing: [],
  },
  fidelity: {
    score: 82,
    breakdown: { resolution: 18.4, coverage: 30, consistency: 13.5, text: 11.2, consensus: 8.9 },
    gatePassed: true,
  },
  evidence: {
    sources: [
      { url: "https://www.aliexpress.com/item/1005006.html", platform: "aliexpress" },
      { url: "https://www.jumia.ci/serum-c-30ml.html", platform: "jumia" },
    ],
    conflicts: ["Contenance annoncée 30 ml et 28 ml selon les annonces"],
    consensusNote: "3 sources distinctes, 2 valeurs concordantes sur la contenance.",
  },
};

export const demoMarketKit: MarketKit = {
  market: { country: "CI", language: "fr", currency: "XOF", maturityStage: "growing" },
  personas: [
    {
      name: "Aïcha, 29 ans, Abidjan",
      profile:
        "Vendeuse en boutique, très active sur TikTok. A déjà acheté trois sérums « miracle » qui n'ont rien changé. Regarde les commentaires avant d'acheter.",
      verbatims: [
        {
          quote: "J'ai payé 15 000 pour un sérum, ça n'a rien fait sur mes taches. Je ne veux plus être arnaquée.",
          sourceUrl: "https://www.tiktok.com/@exemple/video/1",
          platform: "tiktok",
        },
        {
          quote: "Vous livrez à Yopougon ? Et on paie à la réception ?",
          sourceUrl: "https://www.facebook.com/exemple/posts/1",
          platform: "meta",
        },
      ],
    },
  ],
  desires: [
    {
      level: 1,
      statement: "Avoir une peau nette, sans taches visibles",
      evidence: [{ url: "https://www.tiktok.com/@exemple/video/1", platform: "tiktok" }],
    },
    {
      level: 3,
      statement: "Se sentir respectable et soignée en public",
      evidence: [{ url: "https://www.facebook.com/exemple/posts/1", platform: "meta" }],
    },
  ],
  objections: [
    {
      objection: "« Les photos mentent, le produit reçu n'est pas le même »",
      frequency: 0.31,
      evidence: [{ url: "https://www.tiktok.com/@exemple/video/2", platform: "tiktok" }],
      counterAngle: "Montrer le produit reçu en main, filmé sans montage, avec le colis ouvert.",
    },
    {
      objection: "« Est-ce que je vais vraiment recevoir quelque chose ? »",
      frequency: 0.27,
      evidence: [{ url: "https://www.facebook.com/exemple/posts/2", platform: "meta" }],
      counterAngle: "Paiement à la livraison mis en avant dès la première seconde.",
    },
  ],
  competitors: [
    {
      name: "Belle-Afrique Shop",
      platform: "Facebook / WhatsApp",
      url: "https://www.facebook.com/exemple",
      offer: "Sérum + éponge offerte",
      price: "12 500 FCFA",
      promise: "Résultat en 7 jours",
      ads: [
        {
          hook: "Avant / après 7 jours seulement",
          startDate: "2026-07-02T00:00:00.000Z",
          daysRunning: 105,
          url: "https://www.facebook.com/ads/library/?id=1",
        },
      ],
    },
    {
      name: "Glow CI",
      platform: "TikTok",
      url: "https://www.tiktok.com/@glowci",
      price: "15 000 FCFA",
      promise: "Le sérum des dermatologues",
      ads: [
        {
          hook: "Certifié par un dermatologue",
          startDate: "2026-09-28T00:00:00.000Z",
          daysRunning: 25,
          url: "https://www.tiktok.com/@glowci/video/9",
        },
      ],
    },
  ],
  anglePortfolio: [
    {
      angleFamily: "avant-apres",
      status: "proven_here",
      advertisersCount: 7,
      medianDaysRunning: 78,
      markets: ["CI"],
      evidenceUrls: ["https://www.facebook.com/ads/library/?id=1"],
      proofAvailable: ["photos avant/après", "témoignages vidéo"],
      priority: 68,
    },
    {
      angleFamily: "garantie",
      status: "proven_elsewhere",
      advertisersCount: 0,
      medianDaysRunning: 96,
      markets: ["Nigeria", "Ghana"],
      evidenceUrls: ["https://www.facebook.com/ads/library/?id=ng-42"],
      proofAvailable: ["paiement à la livraison", "retour sous 7 jours"],
      objectionAddressed: "« Vais-je vraiment recevoir quelque chose ? »",
      priority: 100,
    },
    {
      angleFamily: "temoignage",
      status: "rising",
      advertisersCount: 3,
      medianDaysRunning: 18,
      markets: ["CI"],
      evidenceUrls: ["https://www.tiktok.com/@glowci/video/9"],
      proofAvailable: ["UGC client"],
      priority: 92,
    },
    {
      angleFamily: "autorite",
      status: "observed_unproven",
      advertisersCount: 2,
      medianDaysRunning: 21,
      markets: ["CI"],
      evidenceUrls: ["https://www.tiktok.com/@glowci/video/12"],
      proofAvailable: [],
      priority: 44,
    },
    {
      angleFamily: "urgence",
      status: "unobserved",
      advertisersCount: 0,
      medianDaysRunning: 0,
      markets: [],
      evidenceUrls: [],
      proofAvailable: [],
      priority: 10,
    },
  ],
  whiteSpaceImported: [
    {
      angle: "garantie",
      sourceMarket: "Nigeria",
      whyTransferable:
        "La peur de l'arnaque est le premier frein en Côte d'Ivoire ; le Nigeria a résolu ça par le paiement à la livraison mis en avant, pas par plus de promesses.",
    },
  ],
  riskFlags: [
    {
      type: "meta_policy",
      severity: "warning",
      note: "Éviter toute promesse d'éclaircissement de la peau : refus publicitaire fréquent et risque juridique.",
    },
  ],
  dataQuality: {
    adsFound: 34,
    confidence: "medium",
    gaps: ["Aucune annonce TikTok organique collectée sur la période."],
  },
};

export const demoCreativeKit: CreativeKit = {
  bigIdea:
    "Arrêter de promettre des résultats : montrer le produit reçu, en main, et laisser le paiement à la livraison faire le travail de confiance.",
  angles: [
    {
      id: "a1",
      insight: "Le marché ne croit plus aux promesses, il croit ce qu'il voit arriver chez lui.",
      promise: "Tu paies seulement quand le colis est dans ta main.",
      mechanism: "Paiement à la livraison + produit filmé sans montage.",
      proof: "Colis ouvert à l'écran, flacon montré sous tous les angles.",
      objectionHandled: "« Les photos mentent, je ne recevrai pas ça. »",
      hook: "Commande, tu paies à la réception. Regarde ce qu'il y a dedans.",
      awarenessLevel: 3,
      sourceAngleRef: "garantie",
    },
    {
      id: "a2",
      insight: "Elles comparent leur peau à celles qu'elles voient en photo.",
      promise: "Le même flacon, la même lumière, à 7 jours d'intervalle.",
      mechanism: "Une photo par semaine, même fenêtre, même heure.",
      proof: "Deux photos non retouchées, même cadre.",
      objectionHandled: "« Ça ne marchera pas sur moi. »",
      hook: "Même fenêtre, même heure, 7 jours d'écart.",
      awarenessLevel: 2,
      sourceAngleRef: "avant-apres",
    },
    {
      id: "a3",
      insight: "Une vendeuse qui répond en commentaire rassure plus qu'une marque.",
      promise: "Des réponses en direct, livraison partout à Abidjan.",
      mechanism: "Format UGC : la vendeuse filme, répond, montre le stock.",
      proof: "Commentaires réels affichés à l'écran.",
      objectionHandled: "« Est-ce que je vais vraiment recevoir quelque chose ? »",
      hook: "Vous m'avez demandé si on livre à Yopougon. Regardez.",
      awarenessLevel: 4,
      sourceAngleRef: "temoignage",
    },
  ],
  hooks: [
    { format: "ugc", text: "Commande, tu paies à la réception. Regarde ce qu'il y a dedans.", durationS: 15 },
    { format: "ugc", text: "Même fenêtre, même heure, 7 jours d'écart.", durationS: 15 },
    { format: "static", text: "Tu paies seulement quand le colis est dans ta main.", durationS: 6 },
    { format: "voiceover", text: "Vous m'avez demandé si on livre à Yopougon.", durationS: 12 },
  ],
  scripts: [
    {
      format: "ugc",
      durationS: 15,
      hookEndsAtS: 2,
      scenes: [
        { atS: 0, visual: "Main qui tient le colis fermé, gros plan", text: "Tu paies à la réception" },
        { atS: 2, visual: "Ouverture du colis, flacon sorti", voiceover: "Voilà exactement ce que tu reçois." },
        { atS: 7, visual: "Flacon retourné, label lisible", voiceover: "30 ml, verre ambré, pipette." },
        { atS: 11, visual: "Application sur le visage", voiceover: "Et si ça ne te va pas, tu ne paies pas." },
      ],
    },
  ],
  visualDirection: {
    palette: ["#E8C55A", "#1C1917", "#F5EFE6"],
    motifs: ["lumière naturelle de fenêtre", "mains réelles", "colis ouvert"],
    do: ["montrer le produit sous tous les angles", "filmer en vertical, sans montage"],
    dont: ["promettre un éclaircissement", "utiliser des visages générés"],
  },
  imagePrompts: [
    {
      slotRef: "face",
      scene: "Flacon posé sur un tissu beige, lumière de fenêtre",
      prompt:
        "Photographie produit, flacon de sérum en verre ambré avec bouchon doré strié, étiquette blanche lisible, posé sur un tissu beige, lumière naturelle latérale douce, fond neutre, rendu réaliste, 4:5",
      negativePrompt: "texte déformé, filigrane, produit inventé, couleur différente",
      referenceImages: ["https://cdn.example/face.jpg"],
    },
  ],
};

export const demoKits = {
  product: demoProductKit,
  market: demoMarketKit,
  creative: demoCreativeKit,
};
