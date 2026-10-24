/**
 * Vérifie le chemin de livraison SANS appeler Gemini.
 *
 * Les fournisseurs sont remplacés par des doublures déterministes ; seule la
 * source AliExpress reste réelle. But : prouver que l'orchestration, la
 * planche, le marché et le calcul de fidélité s'enchaînent correctement,
 * indépendamment de tout quota.
 *
 *   node --env-file=.env.local .tmp/e2e-stub.mjs
 */
import { db } from "@/lib/db";
import { sourceListings } from "@/lib/db/schema";
import { createProviders } from "@/lib/providers";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { requiredSlots } from "@/lib/planche/slots";

const [listing] = await db.select().from(sourceListings).limit(1);
if (!listing) {
  console.error("Aucun listing en base.");
  process.exit(1);
}

const base = createProviders();

const providers = {
  ...base,
  ocr: {
    name: "stub-ocr",
    extract: async () => ({ text: "SERUM VITAMINE C 30 ML", confidence: 1, provider: "stub" }),
    extractMany: async (urls: readonly string[]) =>
      urls.map(() => ({ text: "SERUM VITAMINE C 30 ML", confidence: 1, provider: "stub" })),
  },
  attributes: {
    name: "stub-attrs",
    describe: async () => ({ color: "jaune", category: "beaute" as const, form: "flacon" }),
  },
  visual: {
    name: "stub-vision",
    compare: async (_images: readonly string[], _text: string, candidates: readonly { id: string }[]) =>
      new Map(candidates.map((c) => [c.id, { visual: 0.95, text: 0.95 }])),
  },
  slots: {
    name: "stub-slots",
    classify: async (images: readonly string[], slots: readonly { id: string }[]) =>
      new Map(images.map((_, index) => [index, slots[index]?.id ?? null])),
  },
  writer: {
    name: "stub-writer",
    write: async () =>
      JSON.stringify({
        bigIdea: "Montrer le flacon reçu plutôt que promettre un résultat.",
        angles: [
          {
            id: "a1",
            insight: "Elles ne croient plus aux promesses.",
            promise: "Tu paies à la réception.",
            mechanism: "Colis ouvert à l'écran.",
            proof: "Flacon filmé sous tous les angles.",
            objectionHandled: "« Je ne recevrai pas ça. »",
            hook: "Commande, tu paies à la réception. Regarde dedans.",
            awarenessLevel: 3,
            sourceAngleRef: "avant-apres",
          },
        ],
        hooks: [{ format: "ugc", text: "Commande, tu paies à la réception.", durationS: 15 }],
        scripts: [
          {
            format: "ugc",
            durationS: 15,
            hookEndsAtS: 2,
            scenes: [
              { atS: 0, visual: "Colis fermé dans la main" },
              { atS: 2, visual: "Ouverture du colis" },
            ],
          },
        ],
        visualDirection: { palette: ["#E8C55A"], motifs: [], do: [], dont: [] },
        imagePrompts: [
          {
            slotRef: "face",
            scene: "Flacon sur tissu beige",
            prompt: "Photographie produit, flacon ambré, lumière naturelle",
            referenceImages: [],
          },
        ],
      }),
  },
};

const slots = requiredSlots("beaute");
const photos = slots.slice(0, 5).map((slot, index) => ({
  url: `https://example.test/photo-${index}.jpg`,
  width: 1600,
  height: 1600,
}));

console.log(`archétype   : ${listing.title?.slice(0, 50)}`);
console.log(`photos      : ${photos.length} · emplacements attendus : ${slots.map((s) => s.id).join(", ")}\n`);

const result = await runAnalysis(providers, {
  category: "beaute",
  regime: "non_detenu",
  country: "CI",
  photos,
  userText: listing.title ?? undefined,
});

console.log(`score       : ${result.identify.match.score}/100 — ${result.identify.match.accepted ? "accepté" : "bloqué"}`);
if (result.plan) {
  const f = result.plan.plan.fidelity;
  console.log(`planche     : ${f.score}/100 · ${f.gatePassed ? "VALIDÉE" : `refusée (${f.gate})`}`);
  console.log(`   assignées : ${result.plan.plan.assignments.map((a) => a.slot.id).join(", ")}`);
  console.log(`   manquantes: ${f.missing.join(", ") || "aucune"}`);
}
if (result.market) {
  console.log(`marché      : ${result.market.matrix.dataQuality.adsFound} annonces · publiable=${result.market.matrix.publishable}`);
  console.log(`   angles   : ${result.market.portfolio.entries.slice(0, 4).map((e) => `${e.family}:${e.action}`).join(", ")}`);
}

if (result.creative) {
  const kit = result.creative.kit;
  console.log(
    `production  : ${kit ? `${kit.angles.length} angle(s), ${kit.hooks.length} hook(s), ${kit.scripts.length} script(s), ${kit.imagePrompts.length} prompt(s)` : "non généré"}`,
  );
  if (!kit && result.creative.warnings.length > 0) {
    console.log(`   raison   : ${result.creative.warnings[0]}`);
  }
}
console.log(`livré       : ${!result.blocked ? "OUI" : "non"} (bloqué=${result.blocked})`);

process.exit(!result.blocked ? 0 : 1);
