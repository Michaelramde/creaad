/** Reclasse les images du sac avec le modèle vision. */
import { readFile } from "node:fs/promises";
import { Pool } from "@neondatabase/serverless";

import { classifyImages } from "@/lib/products/classify-images";

const PRODUCT = process.argv.find((a) => a.startsWith("--produit="))?.split("=")[1] ?? "1005001843831532";
const env = await readFile(".env.local", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\r\n]+)"?/m.exec(env)?.[1];
const apiKey = /^GEMINI_API_KEY="?([^"\r\n]+)"?/m.exec(env)?.[1];

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
if (!apiKey) {
  console.error("GEMINI_API_KEY absente");
  process.exit(1);
}

const classified = await classifyImages({
  apiKey,
  urls: record.images.map((image: { url: string }) => image.url),
  colours,
});
console.log(`classées : ${classified.size}/${record.images.length} en ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

const updated = record.images.map((image: Record<string, unknown>, index: number) => {
  const { url, origin, width, height } = image as {
    url: string;
    origin: string;
    width?: number;
    height?: number;
  };
  const base: Record<string, unknown> = { url, origin };
  if (width !== undefined) base.width = width;
  if (height !== undefined) base.height = height;

  const verdict = classified.get(index);
  // Objet reconstruit volontairement : un ancien coloris ne doit pas survivre
  // à un reclassement en image technique.
  if (!verdict) return { ...base, kind: "technique" };
  return verdict.variantValueId
    ? { ...base, kind: verdict.kind, variantValueId: verdict.variantValueId }
    : { ...base, kind: verdict.kind };
});

await pool.query("UPDATE product_records SET images = $1 WHERE product_id = $2", [
  JSON.stringify(updated),
  PRODUCT,
]);

const tally: Record<string, number> = {};
const types: Record<string, number> = {};
for (const [index, image] of updated.entries()) {
  const key = image.variantValueId
    ? (colours.find((c) => c.valueId === image.variantValueId)?.name ?? "?")
    : "technique";
  tally[key] = (tally[key] ?? 0) + 1;
  const type = classified.get(index)?.type ?? "?";
  types[type] = (types[type] ?? 0) + 1;
}

console.log("par type :", JSON.stringify(types));
console.log("par coloris :", JSON.stringify(tally));

for (const [index, verdict] of [...classified.entries()].sort((a, b) => a[0] - b[0])) {
  const colour = colours.find((c) => c.valueId === verdict.variantValueId)?.name ?? "—";
  console.log(`  ${String(index).padStart(2)} ${verdict.type.padEnd(9)} ${colour}`);
}

await pool.end();
