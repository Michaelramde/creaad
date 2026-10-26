# Revue adversariale — Creaad

**Version** : 1.0 · **Rédigée le 25 octobre 2026** · **Nature** : revue de **décisions d'architecture**, par opposition à [`AUDIT.md`](./AUDIT.md) qui traite des **défauts d'implémentation**.

> Ce document attaque les choix, pas les personnes. Il contient aussi l'attaque de l'audit précédent : un audit qui ne se corrige pas lui-même n'est qu'une brochure.
>
> **Méthode** : chaque affirmation porte un `fichier:ligne` ou une **sortie d'exécution reproductible**. Aucune opinion nue.

---

## Sommaire

0. [Atelier de preuve](#0-atelier-de-preuve)
1. [La promesse centrale n'a jamais été livrée](#1-attaque-n1--la-promesse-centrale-na-jamais-été-livrée-en-production)
2. [La clé de jointure est cassée](#2-attaque-n2--la-clé-de-jointure-est-cassée)
3. [Le livrable vedette est calculé sur du bruit](#3-attaque-n3--le-livrable-vedette-est-calculé-sur-du-bruit)
4. [La fonctionnalité différenciante est inatteignable](#4-attaque-n4--la-fonctionnalité-qui-vous-différencie-est-inatteignable)
5. [« Prouvé » est indéfendable](#5-attaque-n5--prouvé-est-un-mot-que-vous-ne-pouvez-pas-défendre)
6. [Le pipeline synchrone](#6-attaque-n6--le-pipeline-synchrone-nest-pas-un-choix-cest-un-pari-non-tenu)
7. [Le palier gratuit](#7-attaque-n7--gemini-gratuit-nest-pas-une-décision-technique)
8. [Le score de fidélité mesure la mauvaise chose](#8-attaque-n8--le-score-de-fidélité-mesure-la-mauvaise-chose)
9. [Corruption silencieuse des données](#9-attaque-n9--une-corruption-silencieuse-et-irréversible)
10. [La tarification contredit vos chiffres](#10-attaque-n10--la-tarification-contredit-vos-propres-chiffres)
11. [**Auto-critique de l'audit**](#11-mon-propre-audit-passé-à-lattaque)
12. [Ce qui survit à l'attaque](#12-ce-qui-survit-à-lattaque)
13. [Les meilleures solutions](#13-les-meilleures-solutions-classées-par-rapport-valeureffort)
14. [Si on repartait de zéro](#14-si-je-repartais-de-zéro-je-changerais-5-choses)
15. [La question sans réponse](#15-la-question-que-personne-ne-vous-posera)
16. [Annexes](#annexe-a--les-requêtes-qui-doivent-être-lues)

---

## 0. Atelier de preuve

Trois expériences exécutées sur le code du dépôt, non modifié.

| Expérience | Question | Résultat |
|---|---|---|
| `buildArchetype()` sur 12 titres réels | La clé de cache marché est-elle stable ? | **Non.** 4 échecs sur 12, dont un franc |
| `classifyHook()` sur 10 hooks + 300 hooks neutres | La classification mesure-t-elle quelque chose ? | **Non.** 66 % de bruit sur un corpus sans angle |
| Grep des sites d'appel | `proven_elsewhere` est-il atteignable en production ? | **Non. Jamais.** |
| Grep des call-sites de `saveAds` | Le P0-1 de l'audit était-il juste ? | **Non.** Il est inatteignable |

Commandes de reproduction en [Annexe B](#annexe-b--reproduire-les-expériences).

---

## 1. Attaque n°1 — la promesse centrale n'a jamais été livrée en production

`README.md`, « Limites connues » :

> « La livraison complète n'a pas encore été observée en production : il faut trois vues distinctes du même produit. »

Trois kits sont vendus. Deux n'ont jamais été livrés ensemble, à un vrai client, depuis la production.

**Conséquence** : tout le reste de ce document est secondaire. Le premier chantier n'est pas technique : c'est **une livraison complète avec un vrai commerçant, facturée, et relue avec lui**.

---

## 2. Attaque n°2 — la clé de jointure est cassée

L'économie entière repose sur : **marché indexé sur `archétype × pays`, pas sur le produit**. La clé est une chaîne produite par une heuristique, comparée à un vocabulaire écrit à la main dans `scripts/collector/seeds.json`.

### Preuve (`buildArchetype`, code inchangé)

| Titre réel | Slug produit | Slug collecté | Verdict |
|---|---|---|---|
| `Sérum Vitamine C 30 ml` | `beaute-serum-30ml` | `beaute-serum-30ml` | ✅ par coïncidence |
| `Sérum vitamine C 30ml éclaircissant` | **`beaute-eclaircissant-30ml`** | `beaute-serum-30ml` | ❌ même produit, autre clé |
| `Serum Vitamin C 30ml Whitening` | `beaute-serum-30ml` | `beaute-serum-30ml` | ✅ |
| `Sac Jeep 3 en 1` | `mode-sac` | `mode-sac` | ✅ |
| `Sac à main femme cuir PU 25 cm` | **`mode-sac-25cm`** | `mode-sac` | ❌ fragmenté par la contenance |
| `Messenger Bags Men Waterproof Shoulder Bag` | **`beaute-produit`** | *aucun* | ❌ **catégorie fausse** |
| `Écouteurs Bluetooth TWS 5.3…` | **`gadgets-ecouteur`** | `gadgets-ecouteur-bluetooth` | ❌ |
| `Perruque lace frontale 13x4… 20 pouces` | **`cheveux-perruque-20pouce`** | `cheveux-perruque-lace` | ❌ |
| `Robe wax longue taille 42` | **`mode-robe`** | `mode-robe-wax` | ❌ |
| `Ensemble 2 pièces pagne 3 pièces` | **`mode-ensemble-2pc`** | *aucun* | ❌ |

**Sur 16 slugs collectés, le générateur en retrouve 3 par coïncidence.** Le titre anglais « messenger bag » produit `beaute-produit` — exactement le mode de défaillance que le commentaire de `extract.ts` prétend avoir corrigé.

### Pourquoi c'est une décision et non un bug

Deux sources de vérité pour la même notion :

- `seeds.json` — 16 slugs écrits à la main, jamais validés par du code ;
- `extract.ts` — un générateur qui reconstruit le slug depuis du texte OCR bruité.

**Aucun test** ne prend les 16 produits réels et vérifie que `buildArchetype(x) ∈ catalogue`. Le routeur LLM (`archetype/route.ts`) est un pansement, et son échec est silencieux (`slug: null` → pas de marché).

### Coût réel

Un commerçant non routé reçoit un dossier produit **sans aucune section « Convaincre »**. Il a payé 1 000 FCFA. Un client perdu pour un `toLowerCase()` manquant.

---

## 3. Attaque n°3 — le livrable vedette est calculé sur du bruit

« Les angles qui marchent déjà, et ceux qui restent libres » repose sur `classifyHook()` : **12 règles regex** avec `text.includes(pattern)`.

### Faux positifs constatés

| Hook réel | Famille attribuée | Cause | Nature réelle |
|---|---|---|---|
| `Montre connectée homme, étanche, 7 jours d'autonomie` | **`temoignage`** | `"mon"` est un **sous-mot** de `"montre"` | descriptif produit |
| `Ma commande est arrivée en 48h à Abidjan` | **`urgence`** | `"48h"` | preuve logistique |
| `Il reste 3 pièces en stock, dernier lot` | **`prix-offre`** | `"lot"` (poids 2) à égalité avec `urgence`, départagé par **l'ordre du tableau** | urgence |
| `Vous avez déjà vu un sac aussi solide ?` | `preuve-sociale` | `"deja"` | accroche interrogative |

### Mesure du biais

300 hooks **sans aucun angle** (« mon sac est vraiment top, je recommande à toutes les femmes » et variantes) :

```
preuve-sociale : 198   ·   prix-offre : 72   ·   temoignage : 30
```

**66 % de bruit classé « preuve sociale ».** Cette famille sera donc *toujours* dominante, gonflera `advertisersCount`, et deviendra `proven_here`.

Puis en cascade : le portefeuille priorise sur ces chiffres ; `buildCreativeStep()` **interdit au rédacteur d'inventer un angle** et le contraint à rédiger sur une famille mal mesurée ; le contrat R3 valide consciencieusement cette référence fausse.

**Une chaîne de preuve rigoureuse sur une entrée non fiable. Une sortie qui paraît auditée.**

---

## 4. Attaque n°4 — la fonctionnalité qui vous différencie est inatteignable

`computeStatus()` sait produire `proven_elsewhere` (« importe cet angle prouvé sur un marché mûr »). C'est l'argument de vente : la démo publique l'affiche, les fixtures l'affichent, le contrat R2 le valide, le portefeuille le priorise.

```
run-analysis.ts  → buildMatrixFor(slug, country)              // pas de referenceCountry
marche/route.ts  → buildMatrixFor(slug, country)              // pas de referenceCountry
grep "referenceCountry" → uniquement src/lib/market/store.ts  // le paramètre existe, personne ne le passe
```

Donc `referenceAds = []`, `referenceMarkets = []`, `refProven = false`, **`proven_elsewhere` est mathématiquement impossible**. Le `whiteSpace` est toujours vide, et `auditPortfolio()` — le garde-fou — ne peut jamais se déclencher.

**Une fonctionnalité montrée publiquement que le moteur ne sait pas produire.**

---

## 5. Attaque n°5 — « prouvé » est un mot que vous ne pouvez pas défendre

| Ce que la donnée contient | Ce que vous en déduisez | Le trou |
|---|---|---|
| date de début, date de fin, actif | rentabilité | Meta ne publie pas la dépense ; une annonce peut tourner sans budget |
| 3 annonceurs, médiane 46 j | « prouvé ici » | 3 points, une médiane, aucune variance, aucun test |
| 45 annonces sur 1 archétype | « le marché » | échantillon de commodité, non aléatoire |

**Biais de survie structurel** : vous n'observez que des annonces encore diffusées ou récemment arrêtées. Les campagnes qui ont échoué ont disparu — le dénominateur est vide.

Et : `daysRunning` prend `now` quand `endDate` est `null`, y compris pour une annonce `isActive = false`. **Une annonce morte sans date de fin gonfle la longévité** et peut faire basculer une famille en `proven_here`.

**Ce n'est pas une raison d'abandonner la mesure** : c'est une raison de changer le mot et d'ajouter la réserve.

| Aujourd'hui | Devenir |
|---|---|
| « Prouvé ici » | « Installé et durable en CI » |
| « Prouvé ailleurs » | « Durable sur un marché mûr, absent ici » |
| (rien) | « durée observée ≠ rentabilité » (mention permanente) |

---

## 6. Attaque n°6 — le pipeline synchrone n'est pas un choix, c'est un pari non tenu

`README.md` : « le pipeline tient en quelques appels réseau, il tourne donc en synchrone ». Défendable **si** l'appel dure < 10 s. Mesure : **31 s**, jusqu'à 55 s.

- 6 appels Gemini qui **renvoient les mêmes images en base64** à chaque fois ;
- `maxDuration` absent sur la route la plus lourde ;
- Inngest installé (12,9 Mo) et jamais utilisé ;
- progression **inventée** côté client (`at: 5, 13, 20, 26, 32` en dur).

Pendant ce temps, `after()` est **déjà utilisé** dans deux routes, et la page **sait déjà** faire du polling.

**La bonne solution n'est pas Inngest** : `POST` → id en 300 ms, travail en `after()`, page en polling sur l'état réel, et suppression d'Inngest.

---

## 7. Attaque n°7 — « Gemini gratuit » n'est pas une décision technique

`providers/gemini.ts` l'écrit lui-même :

> « le palier gratuit peut réutiliser les données envoyées pour améliorer les modèles — à ne pas utiliser tel quel avec des photos sensibles en production ».

C'est **exactement le produit** : un commerçant envoie les photos d'un produit non encore lancé. Aucune mention, aucun consentement, aucune rétention nulle.

| Risque | Exposition | Parade |
|---|---|---|
| Confidentialité | photos produit non publiées | palier payant ZDR ou consentement explicite |
| Quota | ~4 appels/analyse, quota **par modèle** | 3 modèles de repli pour `generate`, **mais l'embedding n'en a aucun** |
| Coût invisible | `logPipelineCost` appelé **seulement** depuis `apify.ts` | 6 appels/analyse invisibles |

Identifiants de modèles **codés en dur dans trois fichiers** alors que Google les retire régulièrement. Si les trois tombent : attributs vides → `match` échoue → **100 % des analyses bloquées, remboursées, sans alerte**.

---

## 8. Attaque n°8 — le score de fidélité mesure la mauvaise chose

```
coverage   50  ← nombre de slots classés par le VLM
resolution 25  ← taille de l'image
text       25  ← confiance OCR (1 si du texte) × 0,5 sans macro
```

En `non_detenu` sans macro : maximum 87,5, plafonné à 80, seuil 65 ⇒ il faut ≈ 90 % des slots remplis. **Le score mesure le taux de réussite du classificateur de vues, pas la fidélité.**

- 4 photos **mal classées** mais 4 slots remplis → ~87, validée, débitée.
- 3 photos **parfaites** mais une vue manquante → ~62, refusée.

On récompense le mensonge du modèle et on punit l'honnêteté du commerçant.

**Composantes mesurables disponibles côté serveur** : netteté (variance du Laplacien), uniformité du fond, filigrane (densité de texte OCR), résolution, couverture, consensus phash (déjà calculé, jamais noté).

---

## 9. Attaque n°9 — une corruption silencieuse et irréversible

`products/enrich-images.ts` :

```ts
const verdict = verdicts.get(index);
if (!verdict) return { ...base, kind: "sans_produit" };   // l'absence de verdict devient un verdict
```

Un lot Gemini en échec (429, timeout) ⇒ les images non classées sont écrites **« sans produit »**, disparaissent de la galerie et de l'export. Et `hasClassification()` renvoie ensuite `true` : **le job ne repassera jamais**.

C'est l'exact contraire de la doctrine affichée (« bloqué plutôt qu'inventé »), et c'est irréversible sans SQL manuel.

---

## 10. Attaque n°10 — la tarification contredit vos propres chiffres

| Fait | Conséquence |
|---|---|
| Une analyse « chaude » coûte ~4 à 12 FCFA | facturée 1 000 : 80 à 250× le coût |
| Le marché est partagé par archétype | le 2ᵉ client paie autant pour un coût quasi nul |
| `5 000 FCFA = 5 analyses` | un kit complet = **2** analyses → la promesse dit « 5 », livre « 2,5 » |
| « Re-run gratuit 7 jours » (SPEC §12.3) | **non implémenté** (0 occurrence) |
| Aucun CAC, taux de refus, rétention modélisés | la « marge 64-93 % » ignore l'acquisition |

Et un point qui démente le slogan : `settleAnalysis` est appelé **même quand `matrix.publishable === false`**. Le client paie l'étape 2 pour recevoir « données insuffisantes ».

**Deux décisions à trancher** : facturer au résultat livré ; tarifer la valeur (étude existante moins chère) ; implémenter le re-run 7 jours.

---

## 11. Mon propre audit, passé à l'attaque

| Ce que j'ai affirmé dans `AUDIT.md` | Ce que la vérification dit | Correction |
|---|---|---|
| **P0-1** : « `saveAds` casse la collecte au 2ᵉ passage » | `saveAds` de `market/store.ts` **n'est appelé nulle part**. `product-market.ts` a son propre `saveAds` (sain), le collecteur écrit du SQL brut | **P0 → P2.** Bombe à retardement, pas panne. Impact mal évalué. |
| « Le marché produit s'affiche » | `buildMatrixForProduct` exige 5 annonces, `findProductAds` s'arrête à 3 → 3-4 annonces = rien affiché | confirmé, à unifier |
| Archétype non testé | 4 échecs sur 12 titres, dont une catégorie fausse | **omission majeure** |
| Classification non testée | 66 % de bruit sur corpus neutre | **omission majeure** |
| `proven_elsewhere` supposé fonctionnel | jamais atteignable | **omission majeure** |
| `kind: "sans_produit"` non vu | corruption irréversible | **omission majeure** |

**Leçon** : un audit qui n'exécute pas le code ne trouve que les fautes de frappe. Les défauts qui coûtent de l'argent sont dans les **invariants non testés entre deux modules**.

---

## 12. Ce qui survit à l'attaque

| Décision | Pourquoi elle est juste | Ne pas céder à |
|---|---|---|
| Registre wallet append-only + idempotence | mathématiquement correct, testé ; une seule erreur ici tue l'entreprise | un champ `balance` « pour aller plus vite » |
| Postgres pour tout (pas de Redis/S3/queue) | 3 fournisseurs en moins, une sauvegarde, une chose à surveiller | une brique par problème |
| Cœur pur + fournisseurs injectés | 177 tests sans clé API ; refactoriser coûte 10× moins | laisser fuir un SDK dans le métier |
| Migrations SQL à la main | 17 migrations, index partiel, 0 dérive constatée | `drizzle-kit push` |
| « Bloquer plutôt qu'inventer » | seul positionnement défendable face à un commerçant | adoucir le seuil pour les statistiques |
| ZIP maison | 90 lignes, zéro dépendance, format vérifiable | `archiver` |
| `after()` déjà présent | la bonne primitive est déjà là | un orchestrateur |

---

## 13. Les meilleures solutions, classées par rapport valeur/effort

| # | Décision à changer | Solution | Effort | Gain | Risque si rien |
|---|---|---|---|---|---|
| 1 | Clé de jointure archétype | catalogue scoré (lexique + bigrammes) + test doré 16 slugs | 1 j | rattachement > 90 %, mesuré | perte de clients silencieuse |
| 2 | `proven_elsewhere` mort | passer `referenceCountry` | 2 h | la promesse devient vraie | allégation non tenue |
| 3 | Classification des hooks | modèle + cache par hash, regex en repli, jeu étiqueté | 1,5 j | livrable crédible | on vend du bruit |
| 4 | `sans_produit` par défaut | `undefined` + retry | 0,5 h | fin d'une corruption | perte de données client |
| 5 | Pipeline synchrone | 202 + `after()` + polling ; supprimer Inngest | 2 j | 31 s → réponse immédiate | timeouts payés |
| 6 | 6 appels Gemini | 1 appel multimodal + embeddings | 1,5 j | latence ÷2, quota ÷3 | plafond gratuit atteint |
| 7 | Photos base64 en base | R2 présigné | 1,5 j | payload, coût Neon | 413 opaque, base saturée |
| 8 | Score de fidélité | netteté/fond/filigrane mesurés | 2 j | refus justes | clients floués |
| 9 | Facturation à l'étape | ne débiter que si publiable | 0,5 j | cohérence avec le slogan | litige |
| 10 | Rétention | re-run gratuit 7 jours | 1 j | LTV | acquisition à sens unique |
| 11 | Aucun funnel | 4 compteurs + page interne | 1 j | pilotage | navigation sans instruments |
| 12 | Test paiement qui scrape un HTML | stub provider en CI | 0,5 j | test stable | régression invisible |

---

## 14. Si je repartais de zéro, je changerais 5 choses

1. **Un `archetype_id` UUID, jamais un slug lisible comme clé.** Les slugs sont pour l'affichage.
2. **Aucune taxonomie de familles d'angles figée à la main.** Hook brut + regroupement par similarité ; les 13 familles sont une hypothèse qu'on impose au réel.
3. **Le marché ne dépendrait pas du produit.** « Quel type de produit » (gratuit, instantané) et « quelles photos » (payant, faillible) sont deux questions, deux chemins.
4. **Un seul appel modèle par analyse** pour lire les photos ; les embeddings ensuite.
5. **Le prix serait un pack de kits complets, jamais « une étape ».** Le client n'achète pas une étape, il achète un kit qui vend.

---

## 15. La question que personne ne vous posera

> **Quel pourcentage de commerçants qui photographient un produit réel obtiennent une livraison complète, aujourd'hui, en production ?**

Cette réponse n'existe pas dans le dépôt. Vous avez instrumenté le **coût** à 6 décimales et pas le **résultat**.

Recommandation : que ce chiffre soit affiché en permanence sur une page interne, et qu'aucune fonctionnalité ne soit développée sans qu'il soit connu.

---

## Annexe A — les requêtes qui doivent être lues

```sql
-- 1. Funnel (vue v_funnel en base, miroir de /admin/metrics)
SELECT status, count(*) FROM analyses GROUP BY status ORDER BY 2 DESC;

-- 2. Coût réel par étape — l'arbitre unique des 3 chiffres contradictoires
SELECT step, provider, count(*) AS appels,
       round(avg(cost_usd)::numeric, 5) AS cout_moyen_usd,
       round(sum(cost_usd)::numeric, 4) AS cout_total_usd,
       sum((estimated)::int)            AS estimees
FROM pipeline_costs
WHERE created_at > now() - interval '30 days'
GROUP BY step, provider ORDER BY cout_total_usd DESC;

-- 3. Couverture du catalogue : quels archétypes ont réellement des annonces ?
SELECT a.slug, count(o.id) AS annonces, count(DISTINCT o.advertiser_id) AS annonceurs
FROM archetypes a LEFT JOIN ad_observations o ON o.archetype_slug = a.slug
GROUP BY a.slug ORDER BY annonces DESC;

-- 4. Calibration du matching : distribution des scores réellement obtenus
SELECT CASE WHEN match_score >= 70 THEN 'accepté' ELSE 'bloqué' END AS verdict,
       count(*), round(avg(match_score), 1) AS score_moyen
FROM analyses WHERE match_score IS NOT NULL GROUP BY 1;
```

## Annexe B — reproduire les expériences

```bash
# 1. Stabilité de l'archétype
node -e "import('./src/lib/archetype/extract.ts').then(({buildArchetype}) => ['Sérum Vitamine C 30 ml','Sérum vitamine C 30ml éclaircissant','Messenger Bags Men Waterproof Shoulder Bag'].forEach(t => console.log(t, '→', buildArchetype({text:t, fallbackCategory:'beaute'}).slug)))"

# 2. Biais de classification
node -e "import('./src/lib/market/classify.ts').then(({classifyHook}) => ['Montre connectée homme','Il reste 3 pièces en stock, dernier lot'].forEach(h => console.log(h, '→', classifyHook(h).family)))"

# 3. Fonctionnalité morte
grep -rn "referenceCountry" src/   # un seul fichier : le paramètre existe, personne ne le passe
```

---

*Fin de la revue. Les références `fichier:ligne` correspondent à l'état du dépôt au 25/10/2026. Les correctifs associés sont suivis dans le plan d'exécution, phase par phase.*
