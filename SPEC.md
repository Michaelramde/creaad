# Creaad — Spécification d'ingénierie v1

**Version** : 1.0 · **Statut** : approuvée · **Marché** : Afrique de l'Ouest · **Langue produit** : français

---

## 1. Objectif

> **Transformer les photos d'un produit en un kit de vente complet : tout ce qu'il faut pour montrer, convaincre et produire — afin de vendre le plus possible sur le marché visé.**

| Kit | Verbe | Question à laquelle il répond |
|---|---|---|
| **R1 — Kit matière** | MONTRER | De quoi ai-je besoin pour montrer ce produit correctement ? |
| **R2 — Kit argumentaire** | CONVAINCRE | Qu'est-ce qui fait acheter ici, et qu'est-ce qui bloque ? |
| **R3 — Kit production** | PRODUIRE | Que dois-je dire, avec quelle preuve, dans quel format ? |

### Principe fondateur

**La photo est une requête, pas une source de données.** Elle fournit : catégorie, forme, matière, couleur, marque, texte d'emballage (OCR), éventuellement un code-barres. Elle ne fournit **jamais** : le marché, les désirs, les objections, la concurrence, les dimensions absolues.

**Sans code-barres, on identifie un archétype, pas un SKU.** Les produits visés sont majoritairement des génériques fournisseurs revendus sous plusieurs noms. On cherche « sérum vitamine C 30 ml », pas une référence commerciale.

**70 % des planches seront bâties sur des images fournisseur.** Le sourcing web est le chemin principal ; la capture par le commerçant est le cas minoritaire (30 %).

---

## 2. Périmètre

### Inclus en v1

- Afrique de l'Ouest, **un pays par analyse**
- **Français** uniquement pour les rapports (hooks en registre local autorisés)
- Catégories : **beauté, cheveux, mode, gadgets**
- **Un produit, une variante précise**
- **Deux régimes** : produit en main / produit non détenu
- Briefs et prompts **exportables** (PDF, ZIP, blocs copiables)
- Wallet prépayé, minimum 5 000 FCFA

### Exclu de la v1

- Génération de créatives (images ou vidéos) dans l'app
- Prix fournisseur dans les rapports
- Multi-pays par analyse
- Langues locales dans les rapports
- Abonnements récurrents
- API de payout (indisponible chez GeniusPay)
- Comptes multi-utilisateurs / équipes

---

## 3. Glossaire

| Terme | Définition |
|---|---|
| **Archétype** | Type de produit générique + attributs distinctifs (« sérum vitamine C 30 ml »). Clé du cache marché. |
| **Planche** | Document structuré en 6 blocs (A→F) servant de référence de génération. |
| **Slot** | Emplacement de vue obligatoire pour une catégorie (ex. « dos », « macro label »). |
| **Provenance** | Origine d'une image : `utilisateur`, `fournisseur`, `marchand`, `concurrent`, `generee`. |
| **Source distincte** | Image dont le phash n'apparaît pas ailleurs. Seule une source distincte compte pour le consensus. |
| **Statut d'angle** | `proven_here`, `proven_elsewhere`, `rising`, `unobserved`. |
| **Régime** | `detenu` (produit en main) ou `non_detenu` (sourcing en cours). |

---

## 4. Parcours & machine à états

### 4.1 Écrans

```
/                      Démonstration publique (kit exemple) + CTA inscription
/auth/inscription      Email + mot de passe
/auth/verifier         Vérification email
/auth/reset            Réinitialisation
/wallet                Solde FCFA + crédits · recharge ≥ 5 000 FCFA
/nouveau               ① Capturer  ② Planche notée → Valider
/analyse/[id]          Progression (polling 2 s)
/analyse/[id]/kits     R1 · R2 · R3 + exports
/historique            Hors chemin critique
```

### 4.2 États du compte

```
cree → email_verifie → wallet_alimente (ACTIF) → suspendu
```

Seul un compte `wallet_alimente` peut créer une analyse.

### 4.3 États d'une analyse

```
cree → reservee → capture → ocr → appariement
  ├─ match_score < 70 → BLOQUEE_ARTICLE ──(confirmation utilisateur)──▶ appariement
  └─ match_score ≥ 70 → moisson → dedup → filtre_variante → classification
        → consensus → PLANCHE_PRETE → EN_ATTENTE_VALIDATION
              │(validation commerçant)
              ▼
        recherche_marche
  ├─ CACHE HIT  → marche_pret
  └─ CACHE MISS → fanout → portefeuille_angles → marche_pret
        → production → LIVREE (règlement)
  (tout état) → ECHOUEE (libération intégrale)
```

### 4.4 Les deux verrous

1. **Solde validé** avant toute analyse — péage A, aucune exception, aucun essai gratuit.
2. **Fiche produit validée** par le commerçant avant la recherche marché.

Le wallet est présenté comme un **dépôt**, pas un achat : *« tes crédits ne sont débités qu'à la livraison de tes kits »*.

---

## 5. Architecture

```
┌── PWA Next.js (Vercel) ─────────────────────────────┐
│  /nouveau · /wallet · /analyse/[id]/kits            │
└──────┬───────────────────────────────┬──────────────┘
       │ upload présigné               │ poll 2 s
       ▼                               ▼
┌── Cloudflare R2 ──┐          ┌── Neon (Postgres) ──┐
│ images brutes +   │          │ registre wallet,    │
│ assets planche    │          │ analyses, kits,     │
└───────────────────┘          │ cache marché        │
                               └──────────┬──────────┘
                                          │
                    ┌─────────────────────┴──────────────────┐
                    │  Inngest (workflow durable)            │
                    │  ocr → match → harvest → consensus →   │
                    │  planche → [humain] → marché → production │
                    └─────────────────────┬──────────────────┘
                                          │
        ┌─────────────┬───────────────┬───┴────────┬──────────────┐
        ▼             ▼               ▼            ▼              ▼
   Mistral OCR   Gemini Flash    Apify/HTTP   TikTok CC      GeniusPay
   (escalade)    + SigLIP        (sources)    + Meta Ads     (paiement)
```

### Choix techniques

| Couche | Choix | Justification |
|---|---|---|
| Front + API | Next.js 15 App Router, TypeScript, Tailwind, PWA (Serwist) | Un repo, installable, pas de store |
| DB | Neon + Drizzle | Pooling serverless, branches par preview |
| Auth | Better Auth (email + mot de passe) | Pas de SMS, zéro coût variable |
| Fichiers | Cloudflare R2, présigné | Egress gratuit |
| Workflow | Inngest | Étapes durables, retries, fan-out |
| Paiement | GeniusPay `geniuspay.ci` | Mobile money UEMOA, 1 % + 100 XOF |
| OCR | Tesseract → Mistral OCR | Escalade low-cost |
| Vision | Gemini 2.5 Flash + SigLIP ONNX (retrieval) | Coût maîtrisé, 2 étages |
| Synthèse | Modèle frontière, JSON validé Zod | Contrat strict |

### Règles non négociables

1. **Aucun fichier image ne traverse une fonction Vercel** — upload présigné direct vers R2.
2. **Aucun appel scraping/LLM dans un handler HTTP** — le handler crée un job, Inngest exécute.
3. **Vercel Hobby est non commercial** — plan Pro obligatoire.

---

## 6. Modèle de données

### 6.1 Registre wallet (append-only)

```sql
CREATE TABLE wallet_transactions (
  id                bigserial PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES users(id),
  type              text NOT NULL
                    CHECK (type IN ('recharge','reservation','reglement','liberation','remboursement','ajustement')),
  amount_xof        integer NOT NULL,           -- signé
  balance_after     integer NOT NULL,
  analysis_id       uuid REFERENCES analyses(id),
  topup_id          uuid REFERENCES topups(id),
  provider          text,                        -- 'geniuspay'
  provider_txn_id   text,                        -- référence MTX-...
  idempotency_key   text NOT NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_wtx_provider_txn ON wallet_transactions(provider, provider_txn_id)
  WHERE provider_txn_id IS NOT NULL;
CREATE UNIQUE INDEX ux_wtx_idem ON wallet_transactions(idempotency_key);
```

**Règles :**
- Le solde est **la somme du registre**. Aucun `UPDATE` d'un champ `balance`.
- Toute écriture porte une `idempotency_key`.
- Un crédit n'est posé qu'après vérification `status = 'completed'` **et** montant exact.

### 6.2 Tables métier

```sql
users(id, email UNIQUE, password_hash, email_verified_at, phone, created_at)
topups(id, user_id, amount_xof, reference, status, gateway, created_at, completed_at)
archetypes(id, slug UNIQUE, label, category, created_at)
products(id, user_id, archetype_id, name, category, regime, variant_label, created_at)
analyses(id, product_id, user_id, country, status, reserved_xof, settled_xof,
         failure_code, created_at, updated_at)
plans(id, analysis_id, version, fidelity_score, breakdown jsonb, gate_passed,
      gate_reason, quality_note, created_at)
plan_images(id, plan_id, slot, angle, url, provenance, width, height,
            phash, is_distinct_source, has_watermark, source_url)
source_listings(id, provider, external_id, url, title, payload jsonb, fetched_at,
                UNIQUE(provider, external_id))
market_kits(id, archetype_id, country, language, content jsonb, ads_found,
            confidence, created_at, expires_at, UNIQUE(archetype_id, country, language))
creative_kits(id, analysis_id, content jsonb, created_at)
pipeline_costs(id, analysis_id, step, provider, model, tokens_in, tokens_out,
               cost_usd numeric(10,6), duration_ms, created_at)
```

### 6.3 Cache

| Clé | Contenu | TTL |
|---|---|---|
| `archetype_id × country × language` | `market_kits.content` | 21 jours |
| `(provider, external_id)` | `source_listings.payload` | 14 jours |
| `phash` | dédup + détection faux consensus | permanent |
| `sha256(label_ocr_raw)` | résultat OCR | permanent |

---

## 7. Contrats d'API

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/auth/*` | Better Auth |
| POST | `/api/uploads/presign` | URL présignée R2 (max 6 images, 5 Mo) |
| GET | `/api/wallet` | Solde + crédits restants |
| POST | `/api/topups` | Initie un paiement GeniusPay |
| POST | `/api/webhooks/geniuspay` | Confirmation de paiement (signé) |
| POST | `/api/analyses` | Crée + réserve + déclenche Inngest |
| GET | `/api/analyses/:id` | État, progression, résultat |
| POST | `/api/analyses/:id/confirm-article` | Débloque après `BLOQUEE_ARTICLE` |
| POST | `/api/analyses/:id/validate-plan` | Verrou de vérité → lance le marché |
| GET | `/api/analyses/:id/kits` | R1 / R2 / R3 |
| GET | `/api/plans/:id/export.pdf` | Planche PDF |
| GET | `/api/plans/:id/export.zip` | Planche ZIP (images + md + json) |
| POST | `/api/inngest` | Handler Inngest |

Toutes les routes exigent une session valide sauf `webhooks/geniuspay` (signé) et la démonstration publique (statique).

---

## 8. Pipeline (Inngest)

| Step | Entrée | Sortie | Idempotent par |
|---|---|---|---|
| `ocr` | images utilisateur | texte + champs | `analysis_id` |
| `match` | texte + embeddings | `match_score`, candidats top-5 | `analysis_id` |
| `harvest` | listing retenu | images + specs | `listing_id` |
| `dedupe` | images | images uniques + `is_distinct_source` | `analysis_id` |
| `variant-filter` | images + variante | images retenues | `analysis_id` |
| `classify` | images | `slot`, `angle`, `has_watermark` | `phash` |
| `consensus` | specs multi-annonces | valeurs + confiance | `archetype_id` |
| `plan-build` | tout ci-dessus | `plans` + score | `analysis_id` |
| **⛔ humain** | — | `validated_at` | — |
| `market-lookup` | archetype × pays | HIT/MISS | clé de cache |
| `market-research` | MISS | `market_kits.content` | clé de cache |
| `creative` | R1 + R2 | `creative_kits.content` | `analysis_id` |
| `settle` | — | règlement ou libération | `analysis_id` |

**Politique de retry :** 3 tentatives, backoff exponentiel, sur toutes les étapes sauf `settle` (idempotent par construction). Toute erreur non récupérable → état `ECHOUEE` + libération intégrale.

---

## 9. Kit matière (R1)

### 9.1 Schéma

```ts
type Provenance = 'utilisateur' | 'fournisseur' | 'marchand' | 'concurrent' | 'generee';

interface ProductKit {
  source:   { listingUrl, title, supplierSku, matchScore, variant };
  identity: { archetype, brand, model, category, subcategory };
  specs:    { dimensions: { value, unit, sources[], confidence },
              weight, material, capacity, packContents };
  claims:   { text, source, verified }[];
  labelOcr: { raw, corrected, fields[] };
  variant:  { colorName, colorHex, size, capacity };
  images:   { id, url, angle, slot, provenance, width, height,
              hasWatermark, isDistinctSource }[];
  coverage: { requiredSlots[], filled[], missing[] };
  fidelity: { score, breakdown: { resolution, coverage, consistency, text, consensus },
              gatePassed };
  evidence: { sources[], conflicts[], consensusNote };
}
```

### 9.2 Slots obligatoires par catégorie

| Catégorie | Slots requis |
|---|---|
| **Beauté** | face · trois-quarts · dos · macro-label · macro-capuchon |
| **Cheveux** | face · profil · dos · sommet · macro-lace · longueur-étirée |
| **Mode** | à-plat · porté · macro-tissu · macro-couture |
| **Gadgets** | face · dos · tranches/ports · écran-allumé · échelle-en-main |

### 9.3 Score de correspondance annonce (`match_score`, 0-100)

| Composante | Poids | Mesure |
|---|---|---|
| Similarité visuelle du produit | **55** | jugement du modèle de vision, sinon cosinus d'embeddings |
| Correspondance OCR | **20** | recouvrement marque / label / mots-clés |
| Correspondance attributs | **15** | couleur, forme, catégorie, matériau |
| Cohérence de variante | **10** | couleur + taille + capacité |

> **Rebarémo du 26/10.** Avec 40/25/20/15, un produit sans nom saisi et sans
> étiquette lisible — un produit générique, cas majoritaire — plafonnait à
> **60/100** pour un seuil de 70 : le texte était devenu une condition
> obligatoire sans que ce soit écrit. Le visuel pèse désormais 55 : une
> correspondance jugée quasi certaine (≥ 0,85) avec attributs concordants
> atteint 70 et passe sans aucun texte. En dessous, on refuse toujours.

**Seuil = 70.** En dessous : analyse `BLOQUEE_ARTICLE`, **aucun débit**, l'utilisateur confirme ou ressaisit.
Le top-5 des candidats est obtenu par embeddings ; **seuls 5 candidats** passent au re-rank VLM.

**Deux règles de calcul, implémentées dans `src/lib/matching/score.ts` :**

1. **Normalisation sur les critères réellement comparables.** Chaque composante est
   ramenée à `[0, max]` sur les seuls critères disponibles des deux côtés. Un produit
   sans matière renseignée n'est pas pénalisé deux fois.
2. **Une information absente vaut 0 point, jamais un accord.** La composante est alors
   marquée `evidence: false` et n'entre pas dans la couverture.

```
couverture = Σ(max des composantes avec evidence) / 100
accepté     = score ≥ 70  ET  couverture ≥ 0,50
```

Conséquence recherchée : **l'OCR seul ne suffit jamais** (25 points, couverture 25 % → refus
pour `INSUFFICIENT_EVIDENCE`). Sans preuve visuelle, la plateforme **bloque** au lieu de
deviner. Le déblocage est possible, mais il est **humain** (`confirm-article`) et tracé.

### 9.4 Score de fidélité de la planche (0-100)

| Composante | Poids | Barème |
|---|---|---|
| Couverture | 50 | `50 × poids_slots_remplis / poids_slots_requis` |
| Résolution | 25 | 0 si < 512 px, 25 si ≥ 2048 px, linéaire en log2 entre les deux |
| Texte | 25 | confiance OCR du label × 0,5 si le macro-label est absent |

> **Recalibré le 24/10 après exécution réelle.** La version initiale prévoyait
> 30/20/20/15/15, dont **35 points** pour le « consensus » et la « cohérence »
> inter-vues. Ces deux mesures exigent un décodage d'image et plusieurs sources
> que le pipeline ne fournit pas encore : les points étaient distribués à partir
> d'une constante inventée (0,7). **On ne note désormais que ce qui est mesuré.**
> Le consensus inter-annonces reste calculé — mais dans le kit matière (specs),
> là où il a un sens.

**Vues requises selon le régime.** Un commerçant qui possède le produit peut
être envoyé photographier un macro de label ; celui qui ne l'a pas dépend des
photos fournisseur, qui n'en contiennent jamais. En `non_detenu`, les slots
marqués `macro` **ne sont plus obligatoires** — sinon le refus serait permanent.

**Seuil = 65.** En dessous : `gatePassed = false`, la production est refusée et
l'app indique **quels slots manquent**. Régime `non_detenu` : plafond à 80 et
`qualityNote` explicite.

### 9.5 Sélection par slot

Chaque slot est un **concours indépendant** entre images disponibles :
1. Éliminer : filigrane, texte incrusté, main, collage multi-produits, résolution < 512 px.
2. Filtrer : variante exacte (couleur dominante à ±ΔE, taille, capacité).
3. Classer : résolution, netteté, cadrage, fond neutre.
4. L'image utilisateur gagne à qualité égale.

### 9.6 Consensus inter-annonces

Une spec n'est retenue comme fiable que si elle est corroborée par **au moins 2 images/specs distinctes au sens du phash**. Trois annonces qui reprennent la même photo = **une** source.
Divergence → fourchette affichée + `confidence: 'low'`. **Jamais de valeur inventée.**

### 9.7 Exports

- `planche.pdf` — document structuré blocs A→F
- `planche.zip` — images renommées par slot + `planche.md` + `planche.json` + `prompts.txt`
- `sheet.png` — **image-récapitulatif** type character sheet, composée en grille déterministe (`sharp`), sans IA

---

## 10. Kit argumentaire (R2)

### 10.1 Schéma

```ts
interface MarketKit {
  market:        { country, language, currency, maturityStage };
  personas:      { name, profile, verbatims: { quote, sourceUrl, platform }[] }[];
  desires:       { level: 1|2|3|4|5, statement, evidence: string[] }[];
  objections:    { objection, frequency, evidence: string[], counterAngle }[];
  competitors:   { name, platform, url, offer, price, promise, angles: string[],
                   ads: { hook, startDate, daysRunning, url }[] }[];
  anglePortfolio:{ angleFamily, status, advertisersCount, medianDaysRunning,
                   markets: string[], evidenceUrls: string[], proofAvailable: string[],
                   objectionAddressed, priority }[];
  whiteSpaceImported: { angle, sourceMarket, whyTransferable }[];
  riskFlags:     { type: 'meta_policy'|'legal'|'category', severity, note }[];
  dataQuality:   { adsFound, coverageEstimate, confidence, gaps: string[] };
}
```

### 10.2 Moteur de saturation

```
proven_here       : advertisers_count ≥ 3  ET median_days_running > 45   (marché cible)
proven_elsewhere  : advertisers_count_local ≤ 1
                    ET advertisers_count_ref ≥ 3 ET median_days_ref > 45  (NG/GH/US)
rising            : freq_30j / freq_30j_precedents ≥ 1.5  ET advertisers_count ≥ 2
observed_unproven : présent, mais ni longévité suffisante ni accélération
unobserved        : 0 occurrence locale ET 0 preuve de référence
priorité          : proven_elsewhere > rising > proven_here > observed_unproven > unobserved
```

> `observed_unproven` a été **ajouté à l'implémentation**. La spécification d'origine
> prévoyait quatre cases, mais la majorité des angles réellement observés n'entrent
> dans aucune : ils sont visibles sans être prouvés. Les forcer dans une case
> existante aurait produit une affirmation fausse.

**La longévité juge, pas la fréquence.** Une annonce active depuis 60 jours a survécu à un test payé.

### 10.3 Garde-fous (codés en dur, non configurables)

1. Jamais « saturé » sans date de première observation ni durée médiane.
2. « Absent » s'affiche **« non observé »** — jamais « opportunité ».
3. `ads_found < 15` → **pas de matrice**, `confidence: 'insufficient'`.
4. Aucun angle sans URL source. Aucun verbatim reformulé.
5. Distinguer « beaucoup d'annonceurs » de « un gros annonceur ».
6. Un angle `proven_here` **n'est jamais écarté** : il est conservé avec une exécution différenciée.
7. `coverageEstimate` affiché à côté de la matrice (échantillon, pas recensement).

### 10.4 Sources

| Source | Voie | Mode de défaillance |
|---|---|---|
| AliExpress / Alibaba | API affiliée + HTTP | Repli Apify |
| Jumia (par pays) | HTTP + parse | Repli Apify |
| Meta Ad Library | endpoint JSON (pas de navigateur) | Repli Playwright |
| TikTok Creative Center | endpoint JSON | Déclaré indisponible |
| TikTok organique / commentaires | provider dédié | **Best-effort, dégradation déclarée** |
| Amazon / Reddit / YouTube | APIs | Proxy **étiqueté** dans le rapport |

Chaque `SourceAdapter` expose : `search()`, `fetchListing()`, `isAvailable()`. La défaillance d'une source dégrade le rapport **et l'écrit**, elle ne le remplit pas.

---

## 11. Kit production (R3)

```ts
interface CreativeKit {
  bigIdea: string;
  angles:  { id, insight, promise, mechanism, proof, objectionHandled,
             hook, awarenessLevel, sourceAngleRef }[];
  hooks:   { format: 'ugc'|'static'|'voiceover', text, durationS, variant }[];
  scripts: { format, durationS, scenes: { visual, text, voiceover }[] }[];
  visualDirection: { palette: string[], motifs: string[], do: string[], dont: string[] };
  imagePrompts: { slotRef, scene, prompt, negativePrompt, referenceImages: string[] }[];
}
```

Contraintes de sortie : vertical 15 s · **hook dans les 2 premières secondes** · chaque angle référence un `sourceAngleRef` du R2 (aucun angle inventé en R3).

---

## 12. Wallet & GeniusPay

### 12.1 Économie

**5 000 FCFA = 5 analyses.**

| Rail | Frais | Sur 5 000 | Net |
|---|---|---|---|
| Wave (CI) | 2,5 % + 100 | 225 | 4 775 |
| PawaPay / PAL | ~4,5 % + 100 | 325 | 4 675 |
| Carte / CinetPay | 6 % + 100 | 400 | 4 600 |

Net par analyse : **920-955 FCFA**. Coût de service : 60-330 FCFA (cache froid/chaud). Marge 64-93 %.

### 12.2 Flux d'une recharge

```
POST /api/topups
  → crée topups(status='pending')
  → GeniusPay POST /api/v1/merchant/payments
     { amount: 5000, currency:'XOF', payment_method:'wave',
       customer:{email,phone,country}, success_url, error_url,
       metadata:{ user_id, topup_id } }
  → renvoie checkout_url / payment_url
Utilisateur paie
  → webhook payment.success (signé) ─┐
  → polling de secours 30 s/10 min ───┴→ GET /payments/{reference}
                                          ├ status = completed
                                          ├ montant = attendu
                                          └ référence jamais créditée
                                            → wallet_transactions 'recharge'
                                            → topups.status = 'completed'
                                            → compte ACTIF
```

### 12.3 Règles

- **Forcer le gateway** (`payment_method: 'wave'` en CI, `pawapay` en repli). Le checkout par défaut laisse les frais varier de 2,5 % à 11 %.
- **Réservation** au lancement, **règlement à la livraison**, **libération intégrale** sur échec.
- **Idempotence portée par la base** — GeniusPay ne fournit pas de clé d'idempotence :
  index unique `(provider, provider_txn_id)` + crédit conditionnel.
- **Webhook** : HMAC-SHA256 sur `timestamp + "." + body_brut`. Lire `req.text()` **avant** tout parsing. Anti-rejeu 5 min.
- **Polling de secours** obligatoire : webhooks perdus = recharge non créditée = perte de client.
- **Réconciliation quotidienne** : `GET /payments?status=completed&from=J-1` vs registre.
- **Pas de payout API** → retraits manuels hebdomadaires.
- **Remboursement = crédit wallet**, jamais monétaire.
- **Re-run du même produit gratuit 7 jours.**

### 12.4 Variables d'environnement

```
DATABASE_URL                      # Neon, chaîne poolée
BETTER_AUTH_SECRET
RESEND_API_KEY
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
GP_BASE                           # à figer : geniuspay.ci ou pay.genius.ci
GP_PK / GP_SK / GP_WHSEC
INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY
GEMINI_API_KEY / MISTRAL_API_KEY / APIFY_TOKEN
APP_URL
```

---

## 13. Sécurité & plafonds

- Vérification de solde et réservation **exclusivement côté serveur**.
- `GP_SK` et `GP_WHSEC` jamais exposés au client.
- Plafonds durs par analyse : 5 listings candidats, 40 images moissonnées, 40 requêtes de recherche, 120 s d'OCR cumulé. Coupe-circuit au-delà → clôture propre + rapport partiel déclaré.
- Limite : 10 analyses/heure/utilisateur, 3 recharges/heure.
- Démonstration publique : contenu statique, aucun appel modèle.

---

## 14. Tests critiques

| # | Cas | Attendu |
|---|---|---|
| 1 | Webhook rejoué 3 fois | **Un seul crédit** |
| 2 | Montant webhook ≠ montant attendu | Refus, alerte, aucun crédit |
| 3 | Signature invalide / timestamp > 5 min | 401 / 400, aucun effet |
| 4 | Analyse échouée en cours de route | **Libération intégrale**, solde inchangé |
| 5 | `match_score = 62` | `BLOQUEE_ARTICLE`, aucun débit |
| 6 | 3 annonces, même image | **1 seule source**, consensus non validé |
| 7 | Catégorie beauté, label absent | Score texte = 0, gate < 65 → refus |
| 8 | `ads_found = 9` | Pas de matrice, `confidence: insufficient` |
| 9 | 2ᵉ analyse même archétype + pays | `CACHE HIT`, coût < 0,10 $ |
| 10 | Régime `non_detenu` | Score plafonné à 80 + `qualityNote` affichée |

---

## 15. Jalons

| Jalon | Livrable | Critère de sortie |
|---|---|---|
| **J0 — Socle** | Auth email, registre wallet, GeniusPay sandbox, démonstration publique | Recharge simulée → crédit posé → **solde correct après rejeu de webhook** |
| **J1 — Identification** | Capture présignée, OCR, archétype, matching, blocage dur | Sous le seuil → analyse stoppée, aucun débit |
| **J2 — Planche** | Moisson, dédup, variante, consensus, score, exports | **Faux consensus détecté** sur jeu de test |
| **J3 — Marché** | Verbatims, objections, concurrence, portefeuille d'angles, cache | 2ᵉ utilisateur même archétype → **coût < 0,10 $** |
| **J4 — Production** | Kit production, exports | **Kit complet livré de bout en bout** |
| **J5 — Exploitation** | Admin, réconciliation, plafonds, `pipeline_costs` | **Marge réelle mesurée** par analyse |

Chaque jalon est déployable et testable seul. **J0 avant tout le reste.**

---

## 16. Risques

| # | Risque | Parade |
|---|---|---|
| 1 | Mauvaise annonce / variante | `match_score` + **blocage dur** |
| 2 | Faux consensus | Détection phash |
| 3 | Texte de packshot déformé | OCR en clair + macro |
| 4 | Visuels en collage | Classifieur VLM + rejet |
| 5 | Hallucination désirs/objections | Sourçage obligatoire, « données insuffisantes » |
| 6 | TikTok organique fragile | Creative Center en socle, dégradation déclarée |
| 7 | Marché mince en avis | Emprunt étiqueté aux marchés mûrs |
| 8 | Catégories sensibles | `riskFlags` en tête de kit |
| 9 | Pas de payout API | Retraits manuels planifiés |
| 10 | Dérapage de coût | Plafonds + `pipeline_costs` |

---

## 17. Décisions ouvertes

1. ✅ **Domaine de production GeniusPay figé** : `https://geniuspay.ci/api/v1/merchant`.
2. **Accès clés live** : bouton → waitlist. Développement en sandbox ; onboarding à demander immédiatement.
3. **Comportement réel Orange/MTN en CI** : les docs mentionnent « via Wave & Paystack ». À vérifier en sandbox.
4. **Délai et minimum de règlement** : non documentés, à demander.
5. **Angles générés** pour compléter une planche : recommandation = marqués `generee`, jamais réinjectés comme référence.

---

## 18. État d'implémentation

| Jalon | Statut |
|---|---|
| J0 — Socle | ✅ Schéma appliqué sur Neon (16 tables), 9 tests unitaires + **15 vérifications d'intégration** contre la base réelle |
| J1 — Identification | ✅ Moteur d'appariement, archétype, fournisseurs injectables, blocage dur, déblocage manuel tracé. **34 tests unitaires** |
| J2 — Planche | 🟡 **Cœur livré** : slots, sélection par emplacement, dHash, faux consensus, score de fidélité, refus actionnable. Reste : moisson réelle, décodage d'images, exports PDF/ZIP |
| J3 — Marché | 🟡 **Cœur livré** : classification des hooks, matrice fréquence × longévité, 5 statuts, portefeuille priorisé, garde-fous et audit. Reste : collecte réelle (Meta/TikTok), verbatims |
| Contrats & cache | ✅ **Livré** : schémas Zod des trois kits avec vérifications croisées, politique de cache par archétype × pays, stockage Neon |
| J4 → J5 | À faire |

Deux points ouverts sur J1 : les fournisseurs réels (`Gemini`, `Mistral`, `SigLIP`) ne sont
pas encore instanciés faute de clés — les interfaces existent et le pipeline tourne avec
des fournisseurs « noop » qui **bloquent** au lieu d'inventer. La démonstration publique
et le parcours UI de J1 restent à construire.

La migration est écrite à la main (`drizzle/0000_init.sql`) pour garder la main sur
les contraintes `CHECK` et sur l'**index unique partiel** `(provider, provider_txn_id)
WHERE provider_txn_id IS NOT NULL`, qui porte l'idempotence du crédit.

---

## 19. Mise à jour du 25 octobre 2026 — écart SPEC ↔ code résorbé

> Cette section **corrige** les sections antérieures. Elle fait foi là où elle contredit le texte ci-dessus.

### Étapes du pipeline

La section §4.3 décrivait 16 états. **7 n'avaient ni producteur ni consommateur** :
`reservee`, `capture`, `moisson`, `en_attente_validation`, `recherche_marche`, `marche_pret`,
`production`. Ils sont retirés (migration `0019`). Les 9 états réels :

```
creee → ocr → appariement → variante_a_choisir ─┐
                        ├─ bloquee_article      │
                        ├─ planche_prete        │
                        └─ produit_pret ────────┴→ livree
                                    (tout état) → echouee
```

### Orchestration

§8 décrivait un pipeline Inngest en 14 étapes. En réalité : une fonction asynchrone, exécutée
dans `after()` après une réponse **202**, avec deux jalons de progression écrits en base
(`ocr`, `appariement`). Inngest n'est utilisé nulle part.

### Stockage des images

§5 imposait R2 présigné. C'est désormais le cas (`POST /api/uploads/presign`), avec repli base64
déclaré quand `R2_PUBLIC_URL` est absent.

### Facturation de l'étape 2

§12 ne le prévoyait pas : **l'étape 2 n'est pas débitée** si la matrice de marché n'est pas
publiable, et coûte **500 FCFA** (au lieu de 1 000) quand ce marché est déjà calculé.
Le re-run gratuit 7 jours (§12.3) est implémenté.

### Score de fidélité

§9.4 : 50 / 25 / 25 (couverture / résolution / texte) **et** un facteur de qualité mesurée
(netteté, uniformité du fond) borné à `0,7 → 1,0`, qui ne peut que baisser le score.

### Classification des angles

§10.2 supposait un classifieur fiable. Mesure sur 24 annonces réelles : **29 %** de précision
pour les règles de mots-clés. Le modèle étiquette désormais (cache permanent dans `hook_labels`),
les règles ne servant que de repli (75 %).

### État vérifié

| Élément | Valeur mesurée le 25/10 |
|---|---|
| Taux de livraison complète | **31,7 %** (19/60 analyses terminées) |
| Blocage article | 35 % |
| Planche refusée | 21,7 % |
| Tests unitaires | **193**, plus une CI bloquante |
| Coût réel par recherche d'image | 0,00895 $ (et non 0,02 $ ni 0,101 $) |
| Coût réel par fiche produit | 0,05000 $ |

Voir [`docs/METRIQUES-2026-10.md`](./docs/METRIQUES-2026-10.md) et [`docs/ADR.md`](./docs/ADR.md).
