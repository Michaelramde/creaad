/**
 * Comparatif rigoureux des acteurs AliExpress / recherche par image.
 * Critères : exécutions, actifs 7 j, taux de succès 30 j, note et nombre d'avis.
 */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();

const TERMS = [
  "aliexpress",
  "aliexpress product",
  "ali express",
  "reverse image search",
  "image search",
  "1688",
  "alibaba product",
];

const seen = new Map();

for (const term of TERMS) {
  const res = await fetch(
    `https://api.apify.com/v2/store?search=${encodeURIComponent(term)}&limit=25&token=${token}`,
  );
  if (!res.ok) continue;
  const { data } = await res.json();
  for (const item of data?.items ?? []) {
    const key = `${item.username}/${item.name}`;
    if (seen.has(key)) continue;
    seen.set(key, item);
  }
}

const rows = [...seen.entries()].map(([key, item]) => {
  const stats = item.stats ?? {};
  const runs = stats.publicActorRunStats30Days ?? {};
  const total = runs.TOTAL ?? 0;
  const success = total > 0 ? ((runs.SUCCEEDED ?? 0) / total) * 100 : null;

  // Note et nombre d'avis : selon le payload, ils sont à deux endroits.
  const rating = item.actorReviewRating ?? item.rating ?? 0;
  const reviews = item.actorReviewCount ?? item.reviewCount ?? 0;

  return {
    key,
    runs: stats.totalRuns ?? 0,
    users7d: stats.totalUsers7Days ?? 0,
    success,
    runs30: total,
    rating,
    reviews,
    price:
      Object.entries(item.currentPricingInfo?.pricingPerEvent?.actorChargeEvents ?? {})
        .map(([k, v]) => `${k}=${v.eventPriceUsd}$`)
        .join(" ") || item.currentPricingInfo?.pricingModel || "—",
  };
});

// Score : fiabilité d'abord, puis usage réel, puis note.
const score = (r) =>
  (r.success ?? 0) * 0.5 +
  Math.log10(1 + r.runs) * 6 +
  Math.log10(1 + r.users7d) * 4 +
  r.rating * 3 +
  Math.log10(1 + r.reviews) * 2;

rows.sort((a, b) => score(b) - score(a));

console.log(
  "acteur".padEnd(46) + "runs".padStart(9) + "u/7j".padStart(6) + "succ30".padStart(8) + "note".padStart(9),
);
console.log("─".repeat(78));

for (const r of rows.slice(0, 16)) {
  console.log(
    r.key.slice(0, 45).padEnd(46) +
      String(Math.round(r.runs / 1000) + "k").padStart(9) +
      String(r.users7d).padStart(6) +
      (r.success === null ? "—" : `${r.success.toFixed(1)}%`).padStart(8) +
      `${r.rating || "—"}${r.reviews ? ` (${r.reviews})` : ""}`.padStart(9),
  );
}

console.log("\n── prix des 8 premiers ──");
for (const r of rows.slice(0, 8)) console.log(`  ${r.key.padEnd(46)} ${r.price}`);
