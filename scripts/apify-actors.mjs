/** Détail des acteurs qui comptent : prix, entrées, sorties. */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();

const ACTORS = [
  "dev00/alibaba-1688-aliexpress-reverse-image-search-api",
  "piotrv1001/aliexpress-image-search-scraper",
  "devcake/scraper-by-image",
  "khadinakbar/aliexpress-all-in-one-scraper",
  "zen-studio/aliexpress-scraper",
];

for (const full of ACTORS) {
  const [user, name] = full.split("/");
  const res = await fetch(
    `https://api.apify.com/v2/acts/${user}~${name}?token=${token}`,
  );
  if (!res.ok) {
    console.log(`\n### ${full} — HTTP ${res.status}`);
    continue;
  }
  const { data } = await res.json();
  console.log(`\n### ${full}`);
  console.log(`   exécutions : ${(data.stats?.totalRuns ?? 0).toLocaleString("fr-FR")} · note ${data.actorReviewRating ?? "—"} (${data.actorReviewCount ?? 0})`);
  console.log(`   modifié    : ${data.modifiedAt?.slice(0, 10)} · ${data.isDeprecated ? "DÉPRÉCIÉ" : "actif"}`);

  const pricing = data.pricingInfos ?? [];
  for (const p of pricing.slice(0, 3)) {
    const events = p.pricingPerEvent?.actorChargeEvents ?? {};
    const detail = Object.entries(events)
      .slice(0, 3)
      .map(([key, value]) => `${key}=${value.eventPriceUsd}$`)
      .join(" ");
    console.log(
      `   prix       : ${p.pricingModel} · location ${p.pricePerUnitUsd ?? "?"}$ ${detail ? `· ${detail}` : ""}`,
    );
  }

  const desc = (data.description ?? "").replace(/\s+/g, " ");
  console.log(`   résumé     : ${desc.slice(0, 220)}`);
}
