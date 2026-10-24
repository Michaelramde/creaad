/** Reclasse les images du produit avec la taxonomie à quatre natures. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

import { classifyImages } from "@/lib/products/classify-images";

const PRODUCT = process.argv.find((a) => a.startsWith("--produit="))?.split("=")[1] ?? "1005001843831532";
const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const apiKey = /^GEMINI_API_KEY="?([^"\r\n]+)"?/m.exec(env)?.[1];

if (!apiKey) {
  console.error("GEMINI_API_KEY absente");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl, max: 1 });
const { rows } = await pool.query(
  "SELECT product_id, images, variant_axes FROM product_records WHERE product_id = $1",
  [PRODUCT],
);
const record = rows[0];
if (!record) {
  console.error("fiche absente");
  process.exit(1);
}

const colours: { valueId: string; name: string }[] = [];
for (const axis of record.variant_axes ?? []) {
  for (const value of axis.values ?? []) {
    if (value.image) colours.push({ valueId: value.valueId, name: value.name });
  }
}

console.log(`produit ${PRODUCT} · ${record.images.length} images · coloris : ${colours.map((c) => c.name).join(", ")}`);

const started = Date.now();
const classified = await classifyImages({
  apiKey,
  urls: record.images.map((image: { url: string }) => image.url),
  colours,
});
console.log(`classées : ${classified.size}/${record.images.length} en ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

const updated = record.images.map((image: Record<string, unknown>, index: number) => {
  const base: Record<string, unknown> = { url: image.url, origin: image.origin };
  if (image.width !== undefined) base.width = image.width;
  if (image.height !== undefined) base.height = image.height;

  const verdict = classified.get(index);
  if (!verdict) return { ...base, kind: "sans_produit" };

  return {
    ...base,
    kind: verdict.type,
    ...(verdict.variantValueId ? { variantValueId: verdict.variantValueId } : {}),
    ...(verdict.hasTechnicalText ? { technicalText: true } : {}),
  };
});

await pool.query("UPDATE product_records SET images = $1 WHERE product_id = $2", [
  JSON.stringify(updated),
  PRODUCT,
]);

const tally: Record<string, number> = {};
for (const [index, image] of updated.entries() as [number, Record<string, unknown>][]) {
  const colour = colours.find((c) => c.valueId === image.variantValueId)?.name.replace(/^\d+\s*/, "") ?? "—";
  const key = `${String(image.kind).padEnd(12)} ${colour}`;
  tally[key] = (tally[key] ?? 0) + 1;
  console.log(`  ${String(index + 1).padStart(2)} ${String(image.kind).padEnd(12)} ${colour}`);
}

console.log("\nrépartition :");
for (const [key, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(24)} ${count}`);
}

await pool.end();
