/** Quel est le format d'entrée de l'acteur de recherche par image ? */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const id = "dev00~alibaba-1688-aliexpress-reverse-image-search-api";

const paths = [
  `/v2/acts/${id}/input-schema`,
  `/v2/acts/${id}/builds/default/input-schema`,
  `/v2/acts/${id}`,
];

for (const path of paths) {
  const res = await fetch(`https://api.apify.com${path}?token=${token}`);
  console.log(`${path} → HTTP ${res.status}`);
  if (!res.ok) continue;

  const json = await res.json();
  const candidate = json.data ?? json;

  // Un schéma d'entrée a un "properties"
  const schema = candidate.properties ? candidate : candidate.inputSchema ?? candidate.exampleRunInput;
  if (schema) {
    console.log(JSON.stringify(schema, null, 2).slice(0, 1800));
    break;
  }
}
