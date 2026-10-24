/** Pourquoi le score visuel reste « sans preuve » ? */
import { createProviders } from "@/lib/providers";
import { buildArchetype } from "@/lib/archetype/extract";
import { centroid, cosine } from "@/lib/matching/text";

const image = "https://ae-pic-a1.aliexpress-media.com/kf/S2d87e1462eb74ca8b832bca36cad86eeW.jpg";
const providers = createProviders();

console.log(`embeddings : ${providers.embeddings.name}`);
console.log(`sources    : ${providers.sources.map((s) => s.name).join(", ")}\n`);

let userEmbedding = null;
try {
  const vectors = await providers.embeddings.embed([image]);
  console.log(`vecteurs utilisateur : ${vectors.length} × ${vectors[0]?.length ?? 0} dim`);
  userEmbedding = centroid(vectors);
  console.log(`centroïde : ${userEmbedding ? "oui" : "NON"}`);
} catch (error) {
  console.log(`échec embeddings : ${(error as Error).message}`);
}

const archetype = buildArchetype({ text: "Sac Jeep 3 en 1", fallbackCategory: "mode" });
console.log(`archétype : ${archetype.slug} (${archetype.category})\n`);

for (const source of providers.sources) {
  try {
    const found = await source.search({
      archetype,
      country: "CI",
      limit: 8,
      query: "Sac Jeep 3 en 1",
      imageUrl: image,
    });
    console.log(`${source.name} : ${found.length} candidat(s)`);
    for (const candidate of found.slice(0, 3)) {
      const sim =
        userEmbedding && candidate.embedding ? cosine(userEmbedding, candidate.embedding) : null;
      console.log(
        `   ${candidate.externalId} · vecteur=${candidate.embedding ? "oui" : "non"} · ${candidate.images.length} img · cos=${sim === null ? "—" : sim.toFixed(3)} · ${candidate.title.slice(0, 45)}`,
      );
    }
  } catch (error) {
    console.log(`${source.name} : échec ${(error as Error).message}`);
  }
}
