/**
 * Exerce le client GeniusPay de production contre le sandbox :
 * initiation, puis vérification serveur (le chemin utilisé par le webhook).
 *
 *   node --env-file=.env.local .tmp/test-payment.mjs
 */
import { initiatePayment, verifyPayment } from "../src/lib/geniuspay/client.ts";

const amount = 5000;

console.log("→ initiation");
const created = await initiatePayment({
  amountXof: amount,
  description: "Test Creaad",
  paymentMethod: "wave",
  customer: { email: "test@creaad.site", phone: "+2250700000000", country: "CI" },
  metadata: { probe: "test-payment" },
});

console.log("référence :", created.reference);
console.log("statut    :", created.status);
console.log("montant   :", created.amountXof, "XOF");
console.log("checkout  :", created.checkoutUrl ?? "(aucune)");

for (let i = 1; i <= 3; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const state = await verifyPayment(created.reference);
  console.log(`vérification ${i} : statut=${state.status} montant=${state.amountXof} frais=${state.fees}`);
  if (state.status === "completed") break;
}
