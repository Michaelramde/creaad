/**
 * Pré-rendu statique de la page /demo.
 *
 * Le serveur Next ne peut pas démarrer dans cet environnement (`fork` bloqué),
 * mais la page de démonstration est un composant serveur synchrone : on la
 * rend avec React et on sert le HTML. C'est le **même composant** que la
 * production, pas une copie.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";

import DemoPage from "../src/app/demo/page";

async function main() {
  const body = renderToStaticMarkup(<DemoPage />);

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Creaad — kit de démonstration</title>
    <link rel="stylesheet" href="/preview.css" />
  </head>
  <body class="min-h-dvh">${body}</body>
</html>`;

  await mkdir(".tmp", { recursive: true });
  await writeFile(".tmp/demo.html", html, "utf8");
  console.log(`OK — .tmp/demo.html (${html.length} octets)`);
}

await main();
