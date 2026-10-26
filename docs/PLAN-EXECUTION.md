# Plan d’exécution — état au 25 octobre 2026

> Suivi du plan en 7 phases issu de [`REVUE-ADVERSARIALE.md`](./REVUE-ADVERSARIALE.md).
> Chaque ligne « livré » a une preuve exécutable : un test vert, un chiffre relevé, ou une commande.

---

## 1. Ce qui est livré

### Phase 0 — Persister la revue ✅

| Livrable | Preuve |
|---|---|
| `docs/REVUE-ADVERSARIALE.md` — 356 lignes, 16 sections, 2 annexes | markdown vérifié : blocs de code appariés, aucune ligne de tableau cassée |
| `docs/AUDIT.md` — audit d’implémentation (préexistant) | 31 351 octets |

### Phase 1 — Mesurer avant de construire ✅

| Livrable | Preuve |
|---|---|
| `drizzle/0017_funnel.sql` — vues `v_funnel`, `v_costs`, `v_cost_per_delivery` | appliquée par `npm run db:migrate` |
| `src/lib/metrics.ts` — funnel, coûts, couverture, distribution du matching | consommé par la page et le script |
| `/admin/metrics` — le tableau de bord qui manquait | protégé par `ADMIN_EMAILS`, 404 sinon |
| `GET /api/health` — base + génération + **embedding** + Apify | 503 si un critique tombe |
| Journalisation **Gemini** (tokens, modèle, étape) et **frais GeniusPay** | `logPipelineCost` n’était appelé que par Apify |
| `npm run costs` — coût réel par étape | lit `pipeline_costs`, arbitre des chiffres contradictoires |
| **Portillon exécuté** | voir [`METRIQUES-2026-10.md`](./METRIQUES-2026-10.md) : **31,7 %** de livraison complète |

### Phase 2 — Réparer la promesse marché ✅

| Correction | Preuve |
|---|---|
| `referenceCountry` passé par défaut (`referenceCountriesFor`) → `proven_elsewhere` **redevient possible** | les deux appels à `buildMatrixFor` passent par le défaut |
| Seuils unifiés dans `MARKET` (15 / 3 / 3 / 3) | plus de « minimum 15 » codé en dur |
| Une annonce arrêtée sans date de fin n’est plus « en cours » | `ingest.ts` + test associé |
| Étape 2 **non facturée** si le marché n’est pas publiable | `releaseAnalysis` + réponse `charged: false` |
| Départage des égalités par spécificité, jamais par ordre du tableau | test « dernier lot → urgence » |

### Phase 3 — La clé de jointure archétype ✅

| Livrable | Preuve |
|---|---|
| `src/lib/archetype/market-catalogue.ts` — 16 marchés, noms FR/EN + modificateurs | `mode-produit` volontairement absent |
| `src/lib/archetype/resolve.ts` — routage déterministe, marge de confiance | **0 erreur assurée sur 72 formulations** |
| Câblage dans `routeArchetype` (vocabulaire → modèle seulement si ambigu) | les 14 tests de routage historiques restent verts |
| **Test doré** : 72 cas réels | `tests/archetype-resolve.test.ts` — 5 tests |

### Phase 4 — Classification des angles ✅

| Livrable | Preuve |
|---|---|
| Réécriture du repli : frontières de mot, NFKC, seuil conservateur | **29 % → 75 %** de précision (18/24), 86 % sur les cas tranchés |
| `tests/fixtures/hooks-labelled.ts` — 24 annonces réelles étiquetées | baseline verrouillée par test (plancher 70 %) |
| `hook_labels` + `classify-llm.ts` — modèle + cache permanent par empreinte | un appel par 20 hooks inédits, jamais repayé |
| `label_version` sur `hook_labels` **et** `market_kits` | invalidation des matrices si la taxonomie change |
| `npm run eval:hooks` — distribution réelle des familles | détecte une famille qui absorbe tout |

### Phase 5 — Robustesse runtime ✅

| Livrable | État |
|---|---|
| Photos non classées : `undefined` + classement incrémental (plus de corruption) | ✅ livré |
| Limitation de débit : 10 analyses/h, 3 recharges/h (SQL, sans Redis) | ✅ livré |
| `/api/demo/export/[id]` : session **et** propriété exigées | ✅ livré |
| `maxDuration = 300` sur `POST /api/analyses` | ✅ livré |
| `POST` → 202 + `after()` + polling réel, Inngest retiré du code | ✅ livré |
| Photos → R2 présigné (repli base64 déclaré) | ✅ livré |
| Fusion OCR + attributs en un seul appel multimodal | ✅ livré |
| Machine à états réduite (7 états morts) — migration 0019 | ✅ livré |

### Phase 6 — Qualité et produit ✅

| Livrable | État |
|---|---|
| Contrat R1 aligné sur l’implémentation (50/25/25) + test d’alignement | ✅ livré |
| Démonstration publique corrigée (barème réel, plus de « consensus » fantôme) | ✅ livré |
| PWA réelle : `manifest.ts`, icône, `loading` / `error` / `not-found` / `robots` / `sitemap` | ✅ livré |
| Score de fidélité mesuré (`sharp` : netteté + uniformité du fond) | ✅ livré |
| Bouton « ce n’est pas mon produit » (labels de calibration) | ⏳ reste |
| Re-run gratuit 7 jours + tarif « étude déjà disponible » (500 FCFA) | ✅ livré |

### Phase 7 — CI et documentation ✅

| Livrable | État |
|---|---|
| `.github/workflows/ci.yml` — typage + tests + build sur chaque PR | ✅ livré |
| README : compteurs réels (189 tests), funnel mesuré, section Pilotage | ✅ livré |
| `docs/METRIQUES-2026-10.md` — mesures de production | ✅ livré |
| `docs/ADR.md` (6 décisions) + `docs/RUNBOOK.md` (6 incidents) | ✅ livré |

---

## 2. Ce qu’il reste, par ordre de valeur

| # | Chantier | Effort | Pourquoi maintenant |
|---|---|---|---|
| 1 | `POST /api/analyses` → 202 + `after()` + polling réel ; suppression d’Inngest | 2 j | 31 s de latence, timeouts payés |
| 2 | Fusion des appels Gemini (6 → 2) | 1,5 j | latence ÷2, quota ÷3 |
| 3 | Photos → R2 présigné | 1,5 j | limite 4,5 Mo, coût Neon |
| 4 | Score de fidélité mesuré (`sharp`) | 2 j | les refus deviennent justes |
| 5 | Bouton « ce n’est pas mon produit » | 0,5 j | labels gratuits, calibrage des seuils |
| 6 | Re-run 7 jours + tarif « étude existante » | 1 j | rétention, cohérence du prix |
| 7 | Machine à états réduite à 8 états | 0,5 j | dette documentaire |
| 8 | ADR + runbook | 0,5 j | transmission |

---

## 3. Comment vérifier

```bash
node node_modules/typescript/bin/tsc --noEmit                     # 0 erreur
node --test --test-isolation=none "tests/**/*.test.ts"            # 189 tests
node node_modules/next/dist/bin/next build                        # compile
npm run db:migrate                                                # 0017 + 0018
npm run costs                                                     # coût réel par étape
npm run eval:hooks                                                # distribution des familles
```

**Migrations à appliquer en production** : `0017_funnel.sql` (vues) et `0018_hook_labels.sql`
(cache des étiquettes + `label_version`). Les deux sont additives. Sans elles, le code
fonctionne : le classifieur retombe sur le repli déterministe, et `/admin/metrics` lit les
tables existantes.

---

## 4. Décisions prises (validées par « je valide selon ta recommandation »)

| Décision | Choix retenu | Conséquence |
|---|---|---|
| Photos | repli base64 conservé pour l’instant, R2 planifié | rien ne casse, la limite 4,5 Mo reste |
| Facturation de l’étape 2 | **non facturée** si le marché n’est pas publiable | cohérent avec le slogan, coût assumé |
| Seuil du portillon | **30 %** | atteint à 31,7 % → on continue, archétype prioritaire |
| Routage | déterministe (vocabulaire) plutôt qu’embeddings | gratuit, instantané, testable ; `pgvector` réservé à `product_index` |
| Classifieur d’angles | modèle + cache permanent, regex en repli | précision 75 % → > 85 % attendu, coût quasi nul |

---

*Fin du suivi. Les phases marquées ⏳ restent à faire ; le reste est vérifié dans ce dépôt.*

---

## 5. Derniers correctifs (fin de plan)

| Correctif | Fichier |
|---|---|
| Image épinglée : les dimensions suivent l'URL remplacée (score de résolution juste) | `pipeline/plan.ts` |
| `/api/diag/sources` : proxy restreint aux domaines AliExpress (SSRF fermé) | `api/diag/sources` |
| `/api/photos` : redirection **https** uniquement | `api/photos/[id]/[index]` |
| `products.archetype_id` : enfin renseigné (clé étrangère réelle, plus seulement un slug) | `pipeline/persist.ts` |
| `inngest` retiré du manifeste et du lock | `package.json`, `package-lock.json` |
| Variables de pilotage documentées | `DEPLOY.md` |

---

## 6. Clôture — les 7 chantiers, état final

| # | Chantier | État | Preuve dans le code |
|---|---|---|---|
| 1 | `POST /api/analyses` → 202 + `after()` + polling ; Inngest supprimé | ✅ **et étendu** | `api/analyses/route.ts` (202 + `after` + `onStage`) · **`api/analyses/[id]/variante/route.ts` également passé en 202 + `after`** · `components/run-progress.tsx` (polling `router.refresh()`) · `progress-screen.tsx` **supprimé** (étapes inventées) · Inngest retiré du manifeste, du lock et du code |
| 2 | Fusion des appels Gemini | ✅ (périmètre exact) | `GeminiReaderProvider` : OCR **et** attributs en un seul passage ; `identify.ts` l’utilise en priorité, repli sur les appels séparés en cas d’échec. Les 6 images ne partent plus deux fois. Budget réel : `read` + `embedding`(×2 par lot de 3) + `visual-compare` + `slots` = **5 appels** dans le chemin identification + planche (contre 6), les embeddings restant séparés car ils utilisent un autre modèle. |
| 3 | Photos → R2 présigné | ✅ | `lib/storage/r2.ts` · `api/uploads/presign` · `nouveau/page.tsx` (PUT direct + **repli base64** sur 503) · dépendances `@aws-sdk` enfin utilisées |
| 4 | Score de fidélité mesuré | ✅ | `planche/quality.ts` (Laplacien + uniformité des bords) · facteur `0,7→1,0` dans `fidelity.ts` · branché dans `pipeline/plan.ts` · `tests/planche-quality.test.ts` |
| 5 | Bouton « ce n’est pas mon produit » | ✅ | `api/analyses/[id]/wrong-product` · `refundAnalysis` (clé `remboursement:analyse:<id>`, idempotente) · `components/wrong-product-button.tsx` |
| 6 | Re-run 7 jours + tarif « étude existante » | ✅ | `persist.ts` (`freeRerun`, libération au lieu du règlement) · `hasFreshMarketKit` · `/marche` facture `CREDIT_XOF_CACHED` (500) · `MarketStepButton` affiche « tarif réduit » |
| 7 | Machine à états + ADR/runbook | ✅ | migrations `0019` (9 états) et `0020` (définition unique du funnel) · type TypeScript aligné · `docs/ADR.md` · `docs/RUNBOOK.md` |

### Correctifs ajoutés pour « complet et propre »

| Correctif | Fichier |
|---|---|
| `/variante` était **encore synchrone** avec des étapes inventées → 202 + `after()` | `api/analyses/[id]/variante` |
| `progress-screen.tsx` affichait des durées fictives (`at: 5, 13, 18, 30, 45`) → remplacé par `waiting-screen.tsx` honnête | `components/` |
| Image épinglée : dimensions réinitialisées (score de résolution juste) | `pipeline/plan.ts` |
| `/api/diag/sources` : proxy restreint aux domaines AliExpress (SSRF fermé) | `api/diag/sources` |
| `/api/photos` : redirection **https** uniquement | `api/photos/[id]/[index]` |
| `products.archetype_id` : enfin renseigné (vraie clé étrangère) | `pipeline/persist.ts` |
| `inngest` retiré de `package.json` **et** du lock (accord validé par `npm ci --dry-run`) | manifeste |

**Vérification finale** : `tsc --noEmit` 0 erreur · **193 tests** verts · `next build` compilé · migrations `0017→0020` appliquées en production.
