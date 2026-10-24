/**
 * Vérifie la requête de recherche sur un cas réel : « Sac Jeep 3 en 1 ».
 * Avant : on cherchait « sac » → sacs génériques → 0/40 en visuel.
 */
import { AliExpressHttpSource, buildSearchQuery } from "@/lib/providers/aliexpress-http";
import { buildArchetype } from "@/lib/archetype/extract";

const text = "Sac Jeep 3 en 1";
const archetype = buildArchetype({ text, fallbackCategory: "mode" });
const source = new AliExpressHttpSource();

console.log(`archétype : ${archetype.slug}`);
console.log(`requête   : "${buildSearchQuery(archetype, text)}"`);
console.log(`(ancienne : "${[archetype.noun, archetype.capacity].filter(Boolean).join(" ")}")\n`);

for (const query of ["", text]) {
  const label = query ? `avec texte "${query}"` : "sans texte (ancien comportement)";
  try {
    const found = await source.search({ archetype, country: "CI", limit: 8, query: query || undefined });
    console.log(`${label} → ${found.length} candidat(s)`);
    for (const item of found.slice(0, 5)) {
      console.log(`   · ${item.title.slice(0, 75)}`);
    }
  } catch (error) {
    console.log(`${label} → échec : ${error instanceof Error ? error.message : error}`);
  }
  console.log();
}
