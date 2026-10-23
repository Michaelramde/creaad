const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("GEMINI_API_KEY absente");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  console.log("http", res.status);
  const body = await res.json();

  if (body.error) {
    console.log("erreur:", body.error.code, body.error.message);
    process.exit(0);
  }

  const usable = (body.models ?? [])
    .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));

  console.log(`${usable.length} modèles:\n` + usable.join("\n"));
} catch (e) {
  console.log("échec:", e.name, e.message);
}
