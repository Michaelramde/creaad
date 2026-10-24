/** Le sac Jeep est-il routé vers un marché réellement collecté ? */
import { loadCatalogue } from "@/lib/archetype/catalogue";
import { routeArchetype } from "@/lib/archetype/route";
import { getFreshRecord } from "@/lib/products/records";

const catalogue = await loadCatalogue();
console.log(`catalogue : ${catalogue.length} marchés`);
console.log(`   ${catalogue.slice(0, 4).map((e) => `${e.slug}(${e.ads})`).join(", ")}…\n`);

const record = await getFreshRecord("aliexpress", "1005001843831532");
const title = record?.title ?? "JEEP BULUO Messenger Bags Men's Large Capacity Chest Sling Split Leather Bag";
const specs = record ? Object.values(record.specs).join(" ") : "";

const routed = await routeArchetype({
  text: `${title} ${specs}`,
  category: "mode",
  catalogue,
});

console.log(`produit : ${title.slice(0, 62)}`);
console.log(`routage : ${routed.slug ?? "aucun"} (${routed.source})`);
if (routed.reason) console.log(`raison  : ${routed.reason}`);

const entry = catalogue.find((item) => item.slug === routed.slug);
if (entry) console.log(`marché  : ${entry.ads} annonces disponibles`);
