import { generate } from "@/lib/providers/gemini.ts";

const key = process.env.GEMINI_API_KEY ?? "";
const models = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
];

for (const model of models) {
  const started = Date.now();
  try {
    const text = await generate(key, model, [{ text: "Réponds uniquement: OK" }]);
    console.log(`${model.padEnd(28)} ✓ ${Date.now() - started} ms — "${text.slice(0, 20)}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /HTTP (\d+)/.exec(message)?.[1] ?? "?";
    console.log(`${model.padEnd(28)} ✗ HTTP ${status} — ${Date.now() - started} ms`);
  }
}
