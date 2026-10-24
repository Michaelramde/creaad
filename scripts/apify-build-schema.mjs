/** Récupère le vrai schéma d'entrée via le dernier build. */
import { readFile } from "node:fs/promises";

const token = (await readFile(".secrets/apify_token.txt", "utf8")).trim();
const id = "dev00~alibaba-1688-aliexpress-reverse-image-search-api";

const buildsRes = await fetch(`https://api.apify.com/v2/acts/${id}/builds?limit=1&desc=1&token=${token}`);
console.log("builds →", buildsRes.status);
const builds = await buildsRes.json();
const build = builds.data?.items?.[0];
if (!build) {
  console.log(JSON.stringify(builds).slice(0, 400));
  process.exit(1);
}

console.log(`build ${build.buildNumber} · ${build.status}`);

const schema = build.inputSchema;
if (!schema) {
  console.log("pas de schéma dans le build");
} else {
  const props = schema.properties ?? {};
  console.log(`\nchamps (${Object.keys(props).length}) :`);
  for (const [key, value] of Object.entries(props)) {
    const v = value;
    console.log(
      `  ${key.padEnd(26)} ${String(v.type ?? "?").padEnd(9)} ${v.required ? "requis " : "        "}${String(v.title ?? v.description ?? "").slice(0, 70)}`,
    );
  }
  const required = schema.required ?? [];
  console.log(`\nrequis : ${required.join(", ") || "aucun"}`);
}
