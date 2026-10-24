/** Prix réels et fiabilité des acteurs candidats. */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();

const ACTORS = [
  ["Recherche par image", "piotrv1001/aliexpress-image-search-scraper"],
  ["Recherche par image", "devcake/scraper-by-image"],
  ["Recherche par image", "borderline/google-lens"],
  ["Recherche par image", "crawleast/1688-image-search-scraper"],
  ["Fiche produit", "zen-studio/aliexpress-scraper"],
  ["Fiche produit", "khadinakbar/aliexpress-all-in-one-scraper"],
  ["Fiche produit", "piotrv1001/aliexpress-listings-scraper"],
  ["Fiche produit", "devcake/aliexpress-products-scraper"],
];

for (const [kind, full] of ACTORS) {
  const [user, name] = full.split("/");
  const res = await fetch(`https://api.apify.com/v2/acts/${user}~${name}?token=${token}`);
  if (!res.ok) {
    console.log(`${kind} · ${full} → HTTP ${res.status}`);
    continue;
  }
  const { data } = await res.json();
  const p = (data.pricingInfos ?? []).find((x) => x.pricingModel === "PAY_PER_EVENT") ?? data.pricingInfos?.[0] ?? {};
  const events = p.pricingPerEvent?.actorChargeEvents ?? {};

  const price = Object.entries(events)
    .map(([key, value]) => `${key} ${value.eventPriceUsd}$`)
    .join(" + ");

  console.log(
    `${kind.padEnd(20)} ${full.split("/")[1].padEnd(38)} ` +
      `${String((data.stats?.totalRuns ?? 0).toLocaleString("fr-FR")).padStart(8)} exéc · ` +
      `${price || p.pricingModel || "n/a"}`,
  );
}
