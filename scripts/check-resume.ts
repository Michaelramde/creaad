/** Reprise locale : la fiche est-elle bien relue depuis le cache ? */
import { createProviders } from "@/lib/providers";
import { runAnalysis } from "@/lib/pipeline/run-analysis";
import { getFreshRecord } from "@/lib/products/records";

const PRODUCT = "1005001843831532";
const record = await getFreshRecord("aliexpress", PRODUCT);
console.log(`fiche en cache : ${record ? `${record.title.slice(0, 40)} · ${record.variantAxes.length} axe(s)` : "ABSENTE"}`);
if (!record) process.exit(1);

const brown = record.variantAxes[0]?.values.find((v) => v.available && /brown/i.test(v.name));
console.log(`coloris choisi : ${brown?.name} (${brown?.valueId})`);

const providers = createProviders();
const result = await runAnalysis(providers, {
  country: "CI",
  photos: [{ url: record.gallery[0]?.url ?? "" }],
  productRef: PRODUCT,
  variantSelection: { [record.variantAxes[0]?.axis ?? "Color"]: [brown?.valueId ?? ""] },
});

console.log(`produit relu   : ${result.product ? "OUI" : "non"}`);
console.log(`bloqué         : ${result.blocked}`);
console.log(`matcher        : ${result.identify.match.score}/100 · accepté=${result.identify.match.accepted}`);
if (result.plan) {
  console.log(`planche        : ${result.plan.plan.fidelity.score}/100 · ${result.plan.plan.fidelity.gate}`);
  console.log(`vues           : ${result.plan.plan.assignments.map((a) => a.slot.id).join(", ") || "aucune"}`);
}
