/**
 * Inventaire du store Apify pour les besoins du projet :
 * recherche par image, produits AliExpress, produits Alibaba.
 */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const TERMS = [
  ["AliExpress", "aliexpress"],
  ["Alibaba", "alibaba"],
  ["recherche par image", "image search"],
  ["Google Lens", "google lens"],
  ["recherche inversée", "reverse image search"],
  ["détail produit", "product details"],
];

const fmt = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

for (const [label, term] of TERMS) {
  const res = await fetch(
    `https://api.apify.com/v2/store?search=${encodeURIComponent(term)}&limit=8&token=${token}`,
  );
  if (!res.ok) {
    console.log(`\n### ${label} — HTTP ${res.status}`);
    continue;
  }
  const data = await res.json();
  const items = data.data?.items ?? [];
  console.log(`\n### ${label} (${items.length} résultats)`);

  for (const item of items.slice(0, 6)) {
    const stats = item.stats ?? {};
    const pricing = item.currentPricingInfo ?? {};
    const price =
      pricing.pricingModel === "PAY_PER_EVENT"
        ? `${pricing.pricePerUnitUsd ?? "?"} $/événement`
        : pricing.pricingModel === "FLAT_PRICE_PER_MONTH"
          ? `${pricing.pricePerUnitUsd ?? "?"} $/mois`
          : (pricing.pricingModel ?? "—");
    console.log(
      `  ${`${item.username}/${item.name}`.padEnd(52)} ${fmt(stats.totalRuns ?? 0).padStart(5)} exéc · ` +
        `${String(item.stats?.usersLast7Days ?? 0).padStart(4)} util/7j · ${price}`,
    );
    const desc = (item.description ?? "").replace(/\s+/g, " ").slice(0, 110);
    if (desc) console.log(`     ${desc}`);
  }
}
