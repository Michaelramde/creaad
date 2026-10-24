/**
 * Vérifie en production que le parcours d'inscription fonctionne réellement :
 * inscription → session → accès au wallet. Sans ça, l'app est inutilisable.
 */
const BASE = "https://creaad.site";
const email = `probe-${Date.now()}@example.test`;
const password = "motdepasse-2026";

async function signUp() {
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email, password, name: "Probe" }),
  });
  const text = await res.text();
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  console.log(`inscription : HTTP ${res.status} ${text.slice(0, 120)}`);
  console.log(`session     : ${cookie ? "cookie reçu" : "AUCUN COOKIE"}`);
  return cookie;
}

async function wallet(cookie) {
  const res = await fetch(`${BASE}/api/wallet`, {
    headers: { cookie },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  console.log(`wallet      : HTTP ${res.status} ${text.slice(0, 140)}`);
  return res.status === 200;
}

const cookie = await signUp();
if (!cookie) process.exit(1);
const ok = await wallet(cookie);
console.log(ok ? "\nPARCOURS D'INSCRIPTION VALIDÉ EN PRODUCTION" : "\nÉCHEC : wallet inaccessible");
process.exit(ok ? 0 : 1);
