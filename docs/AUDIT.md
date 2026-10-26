# Audit d'ingénierie — Creaad

**Version** : 1.0 · **Audit réalisé les 24 et 25 octobre 2026** · **Périmètre** : `Creaad` (Next.js 16 · Neon/Postgres · Drizzle) · **Méthode** : lecture intégrale du code (110 fichiers source, ~14 600 lignes), exécution des vérifications, confrontation SPEC ↔ implémentation.

> Ce document est un constat, pas une feuille de route validée. Les priorités proposées (§14) engagent l'auteur de l'audit, pas le produit.

---

## Sommaire

1. [Verdict en une page](#1-verdict-en-une-page)
2. [Ce qui a été réellement exécuté](#2-ce-qui-a-été-réellement-exécuté-preuves)
3. [Le produit, tel qu'il est vraiment](#3-le-produit-tel-quil-est-vraiment)
4. [Cartographie technique](#4-cartographie-technique)
5. [Ce qui est excellent](#5-ce-qui-est-excellent--et-quil-faut-protéger)
6. [Anomalies classées par gravité](#6-anomalies--classées-par-gravité)
7. [Sécurité](#7-sécurité--synthèse)
8. [Économie unitaire](#8-économie-unitaire--le-modèle-tient-il-)
9. [Base de données](#9-base-de-données)
10. [Front, UX, accessibilité](#10-front--ux--accessibilité)
11. [Tests, CI, observabilité](#11-tests-ci-observabilité)
12. [Code mort et dépendances inutiles](#12-code-mort--dépendances-inutiles)
13. [Écarts documentation ↔ réalité](#13-écarts-documentation--réalité)
14. [Plan d'action](#14-plan-daction)
15. [Métriques cibles](#15-métriques-cibles-pour-piloter)
16. [Annexe A — chiffres de coût cités dans le dépôt](#annexe-a--chiffres-de-coût-cités-dans-le-dépôt)
17. [Annexe B — reproduire cet audit](#annexe-b--reproduire-cet-audit)

---

## 1. Verdict en une page

**Creaad n'est pas un prototype. C'est un produit en production partielle, avec une discipline d'ingénierie très au-dessus de la moyenne** — et un écart structurel entre ce qui est *écrit* (SPEC/README) et ce qui est *branché*.

| Dimension | Note | Commentaire |
|---|---|---|
| Ambition & cadrage produit | **A** | Un problème réel, un modèle économique chiffré, des garde-fous éthiques codés en dur |
| Conception du domaine | **A−** | Scoring, saturation, wallet : logique pure, testée, auditable |
| Qualité du code applicatif | **B+** | Très lisible, commenté avec des *pourquoi*, typé strictement |
| Vérifications automatiques | **B** | 177 tests unitaires verts, `tsc` propre — mais **zéro CI de test** |
| Architecture runtime | **C+** | Pipeline synchrone dans un handler HTTP, photos en base64 en Postgres |
| Écarts SPEC ↔ réel | **C** | 8 états morts, Inngest/R2/PWA déclarés mais absents, contrats R1/R2 non branchés |
| Sécurité | **C+** | Webhook et wallet solides, mais route d'export publique + aucune limitation de débit |
| Exploitabilité (ops) | **C** | Coûts tracés (excellent) mais pas d'alertes, pas de supervision, pas de SLO |

**Le point qui résume tout :** le code est meilleur que la documentation, sauf sur trois sujets où la documentation est meilleure que le code — **la persistance des images, l'orchestration asynchrone, et la validation contractuelle des kits R1/R2**.

---

## 2. Ce qui a été réellement exécuté (preuves)

| Vérification | Commande | Résultat |
|---|---|---|
| Typage strict | `tsc --noEmit` (TS 5.9, `strict` + `noUncheckedIndexedAccess`) | ✅ **0 erreur** |
| Suite unitaire | `node --test "tests/**/*.test.ts"` | ✅ **177 tests / 177 passés** (435 ms) |
| Build production | `next build` (Turbopack) | ✅ **compilation OK en 14,9 s** (l'étape `Running TypeScript` n'a pas pu spawner son worker : restriction sandbox de la machine, pas un défaut projet) |
| Dérive migrations ↔ schéma Drizzle | analyse croisée des 17 migrations SQL vs `schema.ts` | ✅ **0 dérive** : 20 tables, toutes les colonnes du schéma existent en base |
| Dépendances inutilisées | grep d'usage réel | ⚠️ `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `inngest` : **importés nulle part** |
| Limitations de débit | grep `rate|limiter|throttle` sur `src/` | ❌ **0 occurrence** |

C'est un socle sain. Les problèmes qui suivent sont des problèmes de **câblage et de finition**, pas de conception.

---

## 3. Le produit, tel qu'il est vraiment

**Promesse** : photo produit → 3 kits (Montrer / Convaincre / Produire), en deux demandes facturées 1 000 FCFA chacune.

**Parcours réel** (`/nouveau` → `POST /api/analyses`) :

```
Photos (data URL base64, compressées client 1280px/0.72)
  → reserveForAnalysis (débit 1 000, clé d'idempotence)
  → identifyArticle   : OCR Gemini ‖ attributs ‖ embeddings ‖ sources AliExpress  (en parallèle)
  → identifyProduct   : recherche inversée Apify → fiche → description A+ → avis → dimensions OCR
  → choix du coloris ? → statut variante_a_choisir (0 débit, 0 perte)
  → buildPlanStep     : classement des vues (Gemini) → sélection par slot → score fidélité
  → buildMatrixFor    : saturation de l'archétype (annonces déjà collectées)
  → settleAnalysis    : règlement 1 crédit (ou libération intégrale si refus)
  → [bouton explicite] POST /marche → 2ᵉ crédit → matrice produit → after() : créas + enrichissement
```

**Ce qui est remarquable dans ce flux** : la réservation est posée **avant** l'appel payant, la libération est garantie sur exception, et chaque écriture wallet porte une clé d'idempotence déterministe. C'est exactement ce que 95 % des projets de cette taille ratent.

---

## 4. Cartographie technique

| Couche | Volume | Fichiers phares |
|---|---|---|
| Providers (Apify, Gemini, AliExpress, Meta) | 1 984 l. | `providers/apify.ts`, `gemini.ts`, `aliexpress-http.ts` |
| Marché (saturation, portefeuille, enrichissement) | 1 653 l. | `market/saturation.ts`, `portfolio.ts` |
| Pipeline (identification, planche, persistance) | 1 417 l. | `pipeline/run-analysis.ts`, `persist.ts` |
| Routes API | 1 362 l. | `api/analyses/**`, `api/webhooks/geniuspay` |
| Produits (fiche, faits, variantes) | 1 139 l. | `products/normalize.ts`, `corroborate.ts` |
| Planche (slots, phash, fidélité) | 668 l. | `planche/fidelity.ts` |
| Contrats Zod | 593 l. | `contracts/kits.ts` |
| Wallet | 380 l. | `wallet/core.ts` (pur), `repo.ts` |
| Front (7 pages + 8 composants) | ~1 500 l. | `analyses/[id]/page.tsx` (32 Ko) |

**Dépendances runtime** : 11 seulement (Next, React, Drizzle, Better Auth, Zod, Neon, Resend, Inngest, AWS SDK). C'est un choix de sobriété assumé — sauf que 3 sur 11 ne servent pas (§12).

---

## 5. Ce qui est excellent — et qu'il faut protéger

1. **Le wallet est un vrai registre append-only.** `balance = Σ amount`. Aucun `UPDATE balance`. Verrou consultatif `pg_advisory_xact_lock(hashtext(user_id))`, validation du lot **avant** écriture (`applyEntries` refuse tout passage en négatif), unicité portée par `(provider, provider_txn_id) WHERE NOT NULL`. C'est du niveau fintech.
2. **Les clés d'idempotence sont déterministes et versionnées par étape** (`reservation:{id}`, `…:etape2`, `…:settle`). Un rejeu de webhook, un retry, un double-clic : aucun double débit. Testé.
3. **Le webhook est exemplaire** : corps brut lu avant parsing, HMAC-SHA256 sur `timestamp + "." + body`, anti-rejeu 5 min, comparaison en temps constant, **puis re-vérification du statut et du montant par appel API** — le payload n'est jamais cru sur parole.
4. **La philosophie « bloquer plutôt qu'inventer »** est appliquée partout, pas seulement affichée : `InsufficientFundsError`, `NO_CANDIDATE`, `bad_signature`, `confidence: insufficient`, fournisseurs `noop` qui bloquent au lieu de deviner.
5. **Le moteur de saturation a une thèse, et il la tient** : « la longévité juge, pas la fréquence ». Le statut `observed_unproven` a été **ajouté contre la SPEC** parce que forcer la réalité dans 4 cases produisait un mensonge. C'est le signe d'une équipe qui pense.
6. **Le score de fidélité a été recalibré en supprimant 35 points non mesurés.** Ce genre d'honnêteté est rare : la plupart des projets gardent les points pour flatter le chiffre.
7. **Détection de faux consensus par dHash** (`phash.ts`) : 3 annonces qui recopient la même photo comptent pour **1** source. Le risque n°2 de la SPEC est traité au niveau algorithmique.
8. **`corroborate.ts`** : un fait n'est « corroboré » que par ≥ 2 sources indépendantes à 5 % de tolérance, avec gestion de permutation des dimensions. Contradiction → `contradictoire`, jamais une moyenne.
9. **Traçabilité des coûts réelle** : `pipeline_costs` écrit à chaque appel Apify avec `usageTotalUsd` (le prix *facturé*, pas le prix annoncé) + `externalId` pour réconciliation + marquage `estimated`. Rare et précieux.
10. **Factorisation Providers** : le pipeline ne connaît aucun SDK, seulement des interfaces. Conséquence mesurable : tout le cœur tourne et se teste **hors ligne, sans aucune clé**.
11. **Les commentaires expliquent les décisions, pas le code** (« Mesuré : cet appel coûte 0,101 $ […] on ne le déclenche donc que lorsqu'il apporte quelque chose »). C'est de la documentation d'ingénierie, pas du bruit.
12. **Migration `0007`** : quelqu'un a compris qu'il y avait *deux* contraintes de statut en base (`analyses_status_check` + `ck_analysis_states`) et les a alignées toutes les deux. Détail qui trahit du debug réel.

---

## 6. Anomalies — classées par gravité

### 🔴 P0 — à corriger avant toute nouvelle fonctionnalité

| # | Anomalie | Où | Impact | Correctif |
|---|---|---|---|---|
| P0-1 | **`saveAds` génère du SQL invalide** : dans l'`ON CONFLICT DO UPDATE`, la colonne `hook` reçoit la chaîne littérale `sql.COALESCE(excluded.hook, …)`. Le préfixe `sql.` est écrit **dans** la chaîne, et Drizzle l'envoie telle quelle à Postgres | `market/store.ts:76` | Toute insertion d'annonce en conflit (`ON CONFLICT DO UPDATE`) échoue. Le collecteur casse dès qu'il revoit une annonce connue — c'est-à-dire **au 2ᵉ passage**, donc en production silencieusement | `COALESCE(excluded.hook, ${adObservations.hook})` |
| P0-2 | **`/api/demo/export/[id]` n'exige aucune authentification** | `api/demo/export/[id]/route.ts:23` | N'importe qui liste un `productId` AliExpress et télécharge la fiche complète (titre, prix, specs, avis, 37 images). Énumérable, coûteux (fetch d'images serveur), et fuite de données fournisseur | Session + `analyses.userId`, ou suppression de la route |
| P0-3 | **Le pipeline complet tourne dans le handler HTTP `POST /api/analyses`, sans `maxDuration`** | `api/analyses/route.ts:98` | 30-60 s de latence dans une fonction Vercel. Si le timeout tombe : réservation rendue (bien), mais **expérience cassée et 100 % des appels Apify déjà payés perdus**. Contredit frontalement la règle SPEC §5 « aucun appel scraping/LLM dans un handler HTTP » | `export const maxDuration = 300` **immédiatement** ; puis passage à `after()`/Inngest |
| P0-4 | **Aucune limitation de débit** malgré SPEC §13 (10 analyses/h, 3 recharges/h) | `src/` entier (0 occurrence) | Un compte crédité à 5 000 FCFA peut créer 5 analyses… puis, en cas de bug de solde, boucler. `/api/topups` peut créer des paiements en série chez GeniusPay | Compteur Redis/SQL par `user_id` + fenêtre glissante, ou `@upstash/ratelimit` |

### 🟠 P1 — correction dans le mois

| # | Anomalie | Où | Impact |
|---|---|---|---|
| P1-1 | **Les photos sont stockées en base64 dans `analyses.photos` (jsonb)** — 6 images × ~300 Ko base64 = ~1,8 Mo par ligne, envoyées **dans le corps de la requête** | `api/analyses/route.ts:22`, `schema.ts:218` | Violation de la règle « aucun fichier image ne traverse une fonction Vercel » (SPEC §5). Limite Vercel 4,5 Mo de payload : un utilisateur avec 6 photos lourdes prend un 413 opaque. Gonfle Neon, ralentit chaque `SELECT` de la page résultat |
| P1-2 | **`reserveForAnalysis` appelé hors du `try`** dans l'étape 2 | `api/analyses/[id]/marche/route.ts:64` vs `try {` ligne 75 | Solde insuffisant → `InsufficientFundsError` non capturée → **500 générique** au lieu de `402 INSUFFICIENT_FUNDS` + CTA recharge. Le client affiche « l'étude a échoué » alors que rien n'a échoué |
| P1-3 | **`confirm-article` est un cul-de-sac.** Il passe le statut à `appariement` et répond `next: "BUILD_PLAN"` — mais **aucun code ne consomme ce statut**. Le cron `reconcile` le classe « abandonnée » au bout de 30 min et rend le crédit | `confirm-article/route.ts:62` | Le commerçant clique « C'est bien ce produit » : rien ne se passe, puis l'analyse meurt. La promesse du déblocage manuel tracé **n'est pas tenue**. De plus le commentaire (« on ne libère pas la réservation ») est faux : `persist.ts` l'a déjà libérée |
| P1-4 | **Ordre débit-puis-restitution sur planche refusée** : `settleAnalysis` (débit) est appelé ligne 169 **avant** `releaseAnalysis` ligne 204 | `pipeline/persist.ts:169/204` | Le solde net est correct, mais **si le process meurt entre les deux, le commerçant est débité pour une planche refusée**. Et l'audit montre un `reglement` de 1 000 sur une analyse déclarée `settled_xof = 0` : les deux vérités divergent |
| P1-5 | **Les contrats R1 et R2 ne sont jamais appelés en production.** `parseProductKit` / `parseMarketKit` : 0 usage hors `contracts/index.ts`. Seul R3 est validé | `contracts/index.ts` | La « barrière entre un modèle qui répond et un livrable publiable » ne protège que 1 kit sur 3. Le jour où R1/R2 seront branchés, ça cassera : voir P1-6 |
| P1-6 | **Le contrat R1 contredit l'implémentation.** `productKitSchema.breakdown` exige 5 clés (`resolution, coverage, consistency, text, consensus`) et les poids 30/20/15/15/20 — alors que `computeFidelity` produit 3 clés (`coverage, resolution, text`) en 50/25/25 | `contracts/kits.ts` vs `planche/fidelity.ts` | `parseProductKit(sortie réelle)` **échouerait toujours**. La recalibration du 24/10 n'a pas été propagée au contrat, ni au démo public (`demo/page.tsx` affiche encore « Cohérence inter-vues » et « Sources distinctes ») |
| P1-7 | **Aucun job de CI n'exécute les tests.** Les 3 workflows ne font que collecter, cron-er et un smoke `echo` | `.github/workflows/` | 177 tests verts sur la machine du développeur. Rien ne garantit qu'ils le soient demain. C'est, à lui seul, le risque de régression n°1 |
| P1-8 | **Pas de `maxDuration` sur `POST /api/analyses` alors que les 4 autres routes lourdes déclarent 300** | `api/analyses/route.ts` | Incohérence de configuration = comportement dépendant de la plateforme, pas du code |

### 🟡 P2 — dette à planifier

| # | Anomalie | Où | Impact |
|---|---|---|---|
| P2-1 | `product_index` : similarité cosinus calculée **en mémoire** sur jusqu'à 600 lignes JSONB par analyse | `providers/visual-index.ts` | O(n) avec désérialisation de 3072 flottants × 600 = ~10 Mo par requête. Ça marche à 600 produits, ça meurt à 50 000. Migration cible : `pgvector` |
| P2-2 | **Seuils incohérents** : `findProductAds` valide à 3 annonces (`MIN_ADS = 3`), `buildMatrixForProduct` exige `minAds: 5`, et le message d'erreur affiche « minimum 15 » codé en dur | `product-market.ts:19`, `market/store.ts:167`, `portfolio.ts:84` | Un produit avec 3-4 annonces affiche « pas de marché » alors qu'on vient de le déclarer marché. Trois vérités pour un même seuil |
| P2-3 | **`manifest: "/manifest.webmanifest"` pointe vers un fichier inexistant.** Aucun `public/`, aucun `icon.png`, aucun service worker | `layout.tsx:9` | 404 en prod sur chaque page ; l'app n'est pas installable. La promesse « PWA (Serwist) » de la SPEC n'existe pas |
| P2-4 | `images.remotePatterns: [{ hostname: "**" }]` | `next.config.ts:9` | L'optimiseur d'images Next devient un proxy ouvert pour n'importe quelle URL distante (abus de bande passante/SSRF applicatif). Inutile ici : le code utilise `<img>` partout |
| P2-5 | **8 états d'analyse morts** sur 16 : `creee, reservee, capture, moisson, en_attente_validation, recherche_marche, marche_pret, production` | `schema.ts` | La machine à états de la SPEC §4.3 est un décor. Un nouvel arrivant lira la SPEC et cherchera un code qui n'existe pas |
| P2-6 | `products.archetypeId` jamais renseigné (toujours `null`) | `api/analyses/route.ts` | Colonne + FK mortes ; l'archétype est en réalité porté par `analyses.archetypeSlug` |
| P2-7 | **Création d'analyse non idempotente** | `api/analyses/route.ts` | Double soumission réseau = 2 analyses + 2 réservations. Le `busy` côté client protège le clic, pas la latence mobile ouest-africaine |
| P2-8 | `input.listingImages` et `input.consistency` acceptés puis ignorés | `pipeline/plan.ts:29`, `planche/build.ts:29` | Paramètres fantômes : on croit brancher les visuels fournisseur sur les slots manquants, ce n'est pas ce qui se passe |
| P2-9 | `ensurePinnedImage` remplace l'URL mais **garde la largeur/hauteur de l'image remplacée** | `pipeline/plan.ts:80` | Score de résolution faux pour l'image épinglée |
| P2-10 | `getBalance` ouvre une transaction pour un simple `SELECT SUM` | `wallet/repo.ts` | Coût de connexion inutile sur Neon à chaque appel de `/api/wallet` |
| P2-11 | `/api/photos/[id]/[index]` sert les photos **sans session** (UUID comme capacité) et **redirige vers n'importe quelle URL** stockée | `api/photos/.../route.ts` | Redirection ouverte de faible portée + photos commerçant lisibles par quiconque connaît l'UUID. Acceptable, mais à documenter comme choix |
| P2-12 | `/api/diag/sources` est un **proxy HTTP arbitraire** protégé par une clé statique | `api/diag/sources/route.ts` | Si `DIAG_KEY` fuit, SSRF. À supprimer en production ou restreindre aux domaines AliExpress |

---

## 7. Sécurité — synthèse

**Solide** : wallet serveur-only, `GP_SK` jamais exposé, webhook HMAC + anti-rejeu + re-vérification API, secrets hors dépôt (`.env.local`, `.secrets/` gitignorés, `.vercelignore` correct), ownership vérifié par `and(eq(id), eq(userId))` sur toutes les routes authentifiées, transactions atomiques sur le registre.

**À corriger** : P0-2 (export public), P0-4 (pas de rate limit), P2-4 (proxy d'images), P2-12 (proxy diag), P1-1 (payload images).

**Note :** `GP_SK` est **absent de `.env.local`** — le client fonctionne avec `GP_PK` seul (constaté en sandbox), mais `verifyPayment` en production risque d'exiger le secret. À vérifier avant le prochain encaissement réel.

---

## 8. Économie unitaire — le modèle tient-il ?

| Poste | Mesure dans le code | Verdict |
|---|---|---|
| Crédit | 1 000 FCFA | ✅ |
| Net par analyse (Wave) | ~920-955 FCFA | ✅ conforme SPEC §12.1 |
| Coût fiche produit | 0,05 $ Apify, **cachée 30 j** (`product_records`) | ✅ excellent |
| Recherche par image | 60 items, **cachée 7 j** sur hash SHA-256 de la photo | ✅ excellent |
| Corroboration 1688 | 0,101 $ — **conditionnée** à l'absence de dimensions | ✅ la décision la plus rentable du code |
| Plafond Apify 24 h | `APIFY_DAILY_CAP_USD` (défaut **1 $**) vérifié avant chaque appel | ⚠️ 1 $ = ~20 fiches/jour. En production, ce plafond coupera le service **avant** d'être un problème de marge. À relever explicitement |
| Marché d'archétype | Amorti par pays (cache 14-30 j) | ✅ |
| Traçabilité | `pipeline_costs` + `estimated` + `externalId` + cron `reconcile-costs` | ✅ niveau sérieux |

**Le trou économique non couvert** : `POST /api/topups` n'a aucune limite. Un utilisateur (ou un bug) peut créer 10 000 paiements pending chez GeniusPay. Coût direct : nul, coût réputationnel : réel.

**Détail de l'Annexe A** : trois chiffres différents coexistent dans le dépôt pour la même paire d'appels Apify (0,02 $ / 0,101 $ pour la recherche par image ; 0,0049 $ / 0,101 $ pour les fournisseurs). La vérité est en base, dans `pipeline_costs` — tant qu'elle n'en est pas extraite, le modèle de marge repose sur des commentaires.

---

## 9. Base de données

**Très bon** : 17 migrations **écrites à la main**, idempotentes (`IF NOT EXISTS`), transactionnelles, versionnées dans `_migrations` ; **zéro dérive** constatée entre SQL et Drizzle ; index unique partiel `(provider, provider_txn_id) WHERE NOT NULL` correctement posé ; contraintes `CHECK` sur statuts, types wallet, score 0-100 ; `ON DELETE CASCADE` / `RESTRICT` réfléchis (`wallet.user_id → RESTRICT` : on ne supprime pas un client qui a un historique financier).

**À surveiller** : `analyses.photos` et `product_records.images/reviews` en JSONB sans compression (P1-1) ; `product_index.embedding` en JSONB au lieu de `pgvector` (P2-1) ; aucune purge programmée de `pipeline_costs` ni de `ad_observations` (croissance non bornée) ; `purgeExpired()` existe dans `products/records.ts` mais **n'est appelé par aucun cron**.

---

## 10. Front / UX / accessibilité

**Ce qui fonctionne** : mobile-first cohérent (max-w-md partout), design system minimal et tenu (`ui.tsx` : Badge/Card/Kicker/ScoreBar), progression **honnête** pendant l'attente (étapes réelles, pas un spinner), messages d'échec **actionnables** (« il manque le dos, reprends ces photos »), galerie produit avec tri par nature, correction manuelle du coloris qui **prime sur le modèle** — c'est de l'UX de niveau produit, pas de démo.

**Ce qui manque** :
- **Aucune gestion d'erreur de chargement** sur `/analyses/[id]` : si Neon est lent, l'utilisateur voit une page blanche.
- **Aucun `loading.tsx` / `error.tsx` / `not-found.tsx`** dans l'app router.
- **Pas de focus visible**, pas d'`aria-live` sur les changements de statut, contrastes `text-stone-400` sur `stone-50` sous le seuil AA.
- **Pas de `metadata` par page** (titre unique par analyse) → SEO faible sur un produit qui a une landing.
- **`/wallet` code le pays en dur à `CI`** alors que 7 pays sont proposés à la création d'analyse.
- **Pas de bouton de déconnexion** visible.
- Aucun favicon/icône (P2-3) : l'onglet navigateur est vide.

---

## 11. Tests, CI, observabilité

| | État |
|---|---|
| Tests unitaires | **177**, tous verts, très bien ciblés (wallet, fidélité, consensus, contrats, saturation, matching, parsing) |
| Tests d'intégration | **16 vérifications** contre Neon réel, avec nettoyage et utilisateur isolé — bons |
| E2E | 2 scripts (paiement sandbox, webhook signé) — dépendants d'un serveur lancé à la main |
| CI | ❌ **aucun job de test**. Les workflows ne couvrent que la collecte et les crons |
| Observabilité | `pipeline_costs` excellent ; `console.warn` partout mais **aucun agrégateur, aucune alerte**, aucun Sentry/OTel, aucun SLO |
| Qualité de code | ❌ **aucun linter** (`eslint` absent des devDeps, pas de script `lint`), aucun Prettier, aucun hook pre-commit |

**Trou de couverture le plus grave** : aucune route API n'est testée (ni auth, ni webhook en unitaire, ni `/marche`, ni l'export). Les 177 tests couvrent le **cœur pur** ; les 1 362 lignes de routes — là où se trouvent les bugs P1-2, P1-3 — ne sont couvertes par rien.

---

## 12. Code mort & dépendances inutiles

| Élément | Statut |
|---|---|
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | ❌ jamais importés (~15 Mo de `node_modules` pour rien) |
| `inngest` + `src/lib/inngest/client.ts` | ❌ client instancié, **aucune fonction déclarée**, aucun handler `/api/inngest` |
| `R2_*` (env) | ❌ déclarées, validées, jamais utilisées |
| `products.archetypeId`, 8 états d'analyse | ❌ morts |
| `EmptySourceAdapter`, `FixtureSourceAdapter` | utilisés par les tests uniquement (légitime) |
| `plan.ts: listingImages`, `build.ts: consistency` | ❌ paramètres fantômes |
| ~75 scripts jetables dans `.tmp/` (4,3 Mo de logs, mocks, PNG) | gitignorés, mais signe d'une **archéologie non rangée** : à promouvoir en `scripts/` documentés ou à supprimer |

---

## 13. Écarts documentation ↔ réalité

| Affirmation | Réalité |
|---|---|
| README : « 116 tests unitaires » | **177** (la doc sous-vend ; à corriger aussi dans le tableau « État vérifié ») |
| README : « PWA mobile-first » / SPEC : Serwist | ❌ manifest 404, pas d'icônes, pas de SW |
| SPEC §5 : « upload présigné direct vers R2, aucun fichier ne traverse Vercel » | ❌ base64 dans le JSON, stocké en Postgres |
| SPEC §5 : « aucun appel scraping/LLM dans un handler HTTP » | ❌ tout le pipeline est dans `POST /api/analyses` |
| SPEC §8 : pipeline en 14 étapes Inngest | ❌ une fonction synchrone, zéro Inngest |
| SPEC §7 : `GET /api/analyses/:id/kits`, `export.{pdf,zip}`, `/api/uploads/presign` | ❌ n'existent pas. Exports = 1 ZIP markdown+images, pas de PDF |
| SPEC §9.7 : `sheet.png` (planche image) | ❌ absent |
| README : « Verbatims clients : les avis ne sont pas encore extraits » | ✅ exact — et le code va plus loin (avis collectés, cités, utilisés pour objections) |
| README : « exports : copie texte uniquement » | ⚠️ inexact : un ZIP existe (`/api/analyses/[id]/export`) |

**Ne pas corriger le code pour coller à la doc** : corriger la doc pour décrire le code, puis décider, sujet par sujet, si l'écart est une dette ou un abandon assumé.

---

## 14. Plan d'action

### Sprint 0 — cette semaine (≈ 1,5 j)
1. **P0-1** `sql.COALESCE` → 2 minutes. Puis test de non-régression sur `saveAds`.
2. **P0-3 / P1-8** `export const maxDuration = 300` sur `api/analyses/route.ts`.
3. **P0-2** fermer `/api/demo/export/[id]` (session + ownership, ou suppression).
4. **P1-2** déplacer `reserveForAnalysis` dans le `try` + `catch (InsufficientFundsError)` → 402.
5. **P1-7** job CI `test` + `typecheck` + `lint` sur chaque PR (~30 lignes de YAML).
6. **P0-4** limitation de débit : 10 analyses/h et 3 recharges/h par `user_id`, en SQL (pas besoin de Redis).

### Sprint 1 — 2 semaines
7. **P1-3** boucler `confirm-article` : soit il relance réellement le pipeline, soit on **supprime** le bouton. Un cul-de-sac est pire que pas de bouton.
8. **P1-4** refondre l'ordre : `if (blocked) release() else settle()`.
9. **P1-5 / P1-6** aligner `productKitSchema.breakdown` sur 50/25/25, puis **brancher** `parseProductKit` et `parseMarketKit` dans `persist.ts` (écriture refusée si le contrat casse). C'est ce qui rend la promesse « mieux vaut pas de rapport qu'un rapport inventé » vraie sur les 3 kits.
10. Corriger `demo/fixtures.ts` et `demo/page.tsx` (poids obsolètes affichés publiquement).
11. **P1-1** migrer les photos vers R2 (les 2 dépendances AWS déjà présentes servent enfin) ou, a minima, réduire à 4 photos × 720px et sortir le base64 du chemin `SELECT`.
12. **P2-3** `app/manifest.ts` + icônes + `theme-color`. 1 h, gros gain perçu.

### Sprint 2 — 4 semaines
13. Déporter le pipeline lourd vers `after()` (déjà utilisé dans `/marche`) : la réponse rend l'`analysisId` immédiatement, la page poll `/api/analyses/:id` (déjà en place). Le client a déjà son écran de progression.
14. `pgvector` pour `product_index` + index HNSW.
15. Unifier les seuils marché en **une constante exportée** (P2-2).
16. Purger `pipeline_costs` > 90 j et `ad_observations` inactives > 180 j via le cron existant ; brancher `purgeExpired()`.
17. Tracer les états réellement utilisés (supprimer les 8 morts de la SPEC **et** du schéma) ou les implémenter.
18. Sentry (ou OTel) + 3 alertes : webhook en échec, `PIPELINE_FAILED` > 5 %, budget Apify > 80 %.

### Au-delà — ce qui ferait passer de « bon » à « best in class »
- **Test de propriété (property-based)** sur le wallet : générer aléatoirement des séquences crédit/réservation/règlement/libération et vérifier l'invariant `balance = Σ` + jamais négatif + idempotence. Le cœur est pur : c'est gratuit et ça vaut mille tests d'exemple.
- **Test de rejeu réel** : 3 webhooks identiques + 1 cron simultané sur la même référence, contre une base réelle, en CI nocturne.
- **Rapport de marge par analyse** (SPEC §15, J5) : `sum(pipeline_costs.cost_usd)` × taux vs `settled_xof`. Le code a *toutes* les données. Il manque la page.
- **Un runbook** : que fait-on quand GeniusPay ne répond plus, quand Gemini est en 429 depuis 6 h, quand Neon sature ?

---

## 15. Métriques cibles (pour piloter)

| Métrique | Aujourd'hui | Cible 90 j |
|---|---|---|
| p95 latence `POST /api/analyses` | ~31-55 s (mesuré README) | < 3 s (réponse) + polling |
| Taux de blocage `bloque_article` | inconnu (non instrumenté) | instrumenté, < 20 % |
| Coût moyen / analyse | ~0,05-0,10 $ (estimé) | mesuré, < 0,12 $ · marge > 80 % |
| Couverture de tests des routes API | **0 %** | > 60 % |
| Double débit possible | **non** (registre) | non — invariant testé en property-based |
| Régression détectée en CI | **non** (pas de CI) | oui, < 10 min |

---

## Annexe A — chiffres de coût cités dans le dépôt

Chaque chiffre ci-dessous est **une affirmation du code**, pas une vérification indépendante. Les conversions supposent 1 USD ≈ 600 FCFA (XOF arrimé à l'euro à 655,957 ; à ajuster selon le cours).

| Source | Fichier:ligne | Chiffre affirmé | Conversion indicative |
|---|---|---|---|
| Recherche par image | `products/records.ts:16` | 0,02 $ / recherche | ~12 FCFA |
| Recherche par image | `providers/suppliers.ts:6` | 0,101 $ / exécution | ~61 FCFA |
| Fiche produit | `providers/product-detail.ts:4` | 0,05 $ / produit | ~30 FCFA |
| Avis joints | `providers/product-detail.ts:119` | ~0,0015 $ / avis (max 30) | ~0,9 FCFA / avis |
| Fournisseurs 1688 | `providers/suppliers.ts:6` | 0,0049 $ / 20 fiches | ~3 FCFA |
| Fournisseurs (bis) | `pipeline/identify-product.ts:143` | 0,101 $ / appel | ~61 FCFA |
| Annonces Meta | `README.md:55` | ~0,007 $ / archétype | ~4 FCFA |
| Gemini (OCR, vision, embeddings, rédaction) | `README.md:53` | 0 € (palier gratuit) | 0 |
| AliExpress HTTP | `README.md:54` | 0 € | 0 |

**Incohérences à trancher** : la recherche par image est annoncée à la fois 0,02 $ et 0,101 $ ; l'appel « fournisseurs » à la fois 0,0049 $ et 0,101 $. Les deux paires ne peuvent pas être vraies.

**Arbitre unique — la table `pipeline_costs`** :

```sql
SELECT step,
       count(*)                          AS appels,
       round(avg(cost_usd)::numeric, 5)  AS cout_moyen_usd,
       round(sum(cost_usd)::numeric, 4)  AS cout_total_usd,
       sum((estimated)::int)             AS lignes_estimees
FROM pipeline_costs
WHERE created_at > now() - interval '30 days'
GROUP BY step
ORDER BY cout_total_usd DESC;
```

Tant que cette requête n'a pas été lue, **la marge est une opinion**.

---

## Annexe B — reproduire cet audit

```bash
node node_modules/typescript/bin/tsc --noEmit                        # typage
node --test --test-isolation=none "tests/**/*.test.ts"               # 177 tests
node node_modules/next/dist/bin/next build                           # build production
npm run test:integration                                             # 16 vérifications Neon
grep -rnE "rate|limiter|throttle" src/ | wc -l                      # 0 → pas de rate limit
grep -rnE "@aws-sdk|from .inngest." src/ | wc -l                   # 0 → deps mortes
```

---

*Fin du rapport. Les références `fichier:ligne` correspondent à l'état du dépôt au 25/10/2026.*
