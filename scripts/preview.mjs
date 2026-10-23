/**
 * Serveur statique minimal — aucun processus enfant, donc il fonctionne
 * dans les environnements où Next ne peut pas démarrer.
 *
 *   node scripts/preview.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const PORT = Number(process.env.PREVIEW_PORT ?? 4173);

const ROUTES = {
  "/": { file: ".tmp/demo.html", type: "text/html; charset=utf-8" },
  "/demo": { file: ".tmp/demo.html", type: "text/html; charset=utf-8" },
  "/preview.css": { file: ".tmp/preview.css", type: "text/css; charset=utf-8" },
};

const server = createServer(async (req, res) => {
  const path = (req.url ?? "/").split("?")[0] ?? "/";
  const route = ROUTES[path];

  if (!route) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }

  try {
    const body = await readFile(route.file);
    res.writeHead(200, { "Content-Type": route.type, "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Pré-rendu absent : lance `npm run preview:build`.");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Aperçu sur http://localhost:${PORT}`);
});
