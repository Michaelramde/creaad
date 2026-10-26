# Runbook — Creaad

> Six incidents possibles, et quoi faire. Chaque entrée : symptôme → diagnostic → action → prévention.

---

## 1. Les analyses bloquent toutes (taux de blocage > 50 %)

**Symptôme.** `/admin/metrics` : `taux_blocage` élevé, `bloquee_article` majoritaire.

**Diagnostic.**
```
curl -s https://creaad.site/api/health | jq .checks
```
· `gemini.ok = false` → modèles retirés ou clé invalide : **toutes** les analyses échouent proprement
  (attributs vides → `match` échoue → remboursement). Vérifier la liste des modèles.
· `apify.ok = false` → jeton expiré : la recherche inversée est morte, le repli archétype prend le relais.

**Action.** Si un modèle a disparu : `GEMINI_MODEL` vers un modèle listé dans la réponse de `/api/health`,
redéployer. Le repli `flash-lite` est automatique sur 429/404.

**Prévention.** `/api/health` toutes les 15 min ; alerte si `gemini.ok` devient faux.

---

## 2. GeniusPay ne répond plus

**Symptôme.** `/api/topups` répond 502, `topups.status = failed`.

**Diagnostic.** `curl -s -H "X-API-Key: $GP_PK" https://geniuspay.ci/api/v1/merchant/payments?per_page=1`

**Action.** Aucune perte : aucun crédit n'est posé sans `status = completed` vérifié côté API.
Le cron `reconcile` (toutes les 2 min) créditera rétroactivement les paiements confirmés.

**Prévention.** Le cron est le filet obligatoire : ne jamais le désactiver, même en maintenance.

---

## 3. Webhooks perdus

**Symptôme.** Un client a payé, `topups.status` reste `pending`.

**Diagnostic.** `npm run costs` ne suffit pas ; vérifier `pendingTopupsOlderThan(60)` : le cron les
reprend toutes les 2 minutes et appelle l'API pour vérifier l'état réel.

**Action.** Rien à faire manuellement : `syncTopup` est idempotent. Si le cron ne tourne plus,
`curl -H "Authorization: Bearer $CRON_SECRET" https://creaad.site/api/cron/reconcile`.

**Prévention.** `vercel.json` déclare le cron ; sa suppression est une panne silencieuse.

---

## 4. Neon saturé / requêtes lentes

**Symptôme.** Pages lentes, `analyses` volumineux.

**Diagnostic.** `SELECT pg_size_pretty(pg_total_relation_size('analyses'))` — si `photos` domine,
R2 n'est pas configuré (`R2_PUBLIC_URL` absent) et les data URL reviennent.

**Action.** Configurer R2, puis purger les anciennes photos :
```sql
UPDATE analyses SET photos = '[]'::jsonb WHERE created_at < now() - interval '30 days';
```
Le cron purge déjà `product_records` et `image_queries` expirés.

**Prévention.** Surveiller `analyses` vs le quota Neon (0,5 Go en gratuit).

---

## 5. Budget Apify dépassé

**Symptôme.** Avertissement `Plafond Apify atteint` dans les warnings d'analyse, `image-search` renvoie 0.

**Diagnostic.** `npm run costs` → colonne `total` par étape.

**Action.** Relever `APIFY_DAILY_CAP_USD` **en connaissance de cause** : le plafond protège d'une
boucle, pas d'une croissance. Coût réel mesuré : ~0,009 $ par recherche, ~0,05 $ par fiche.

**Prévention.** Alerte à 80 % du plafond.

---

## 6. Un commerçant conteste le produit identifié

**Symptôme.** « Ce n'est pas mon produit. »

**Action.** Le bouton de la page d'analyse rembourse automatiquement (idempotent) et marque
`failure_code = WRONG_PRODUCT`. Aucune action manuelle. Le clic **est** l'étiquette de calibration
qui manquait au seuil d'appariement.

**Prévention.** `SELECT count(*) FROM analyses WHERE failure_code = 'WRONG_PRODUCT'` : au-delà de
5 % des livraisons, le seuil de 70 est trop bas.
