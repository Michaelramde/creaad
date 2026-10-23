# Creaad

> De la photo produit au kit de vente : **montrer**, **convaincre**, **produire**.

Application mobile-first (PWA) qui transforme les photos d'un produit en trois kits exportables — matière, argumentaire, production — pour vendre sur un marché d'Afrique de l'Ouest.

- **Spécification complète** : [`SPEC.md`](./SPEC.md)
- **Déploiement** : [`DEPLOY.md`](./DEPLOY.md) — GitHub → Vercel → `creaad.site`
- **État** : J0 (socle), J1 (identification), cœurs de J2/J3, contrats + cache, écrans.

---

## Stack

| Couche | Choix |
|---|---|
| Front + API | Next.js 16 (App Router), TypeScript, Tailwind v4 |
| DB | Neon + Drizzle |
| Auth | Better Auth (email + mot de passe, aucun SMS) |
| Fichiers | Cloudflare R2 (présigné) — J1 |
| Workflow | Inngest — J1 |
| Paiement | GeniusPay (`geniuspay.ci`) |

---

## Démarrage

```bash
cp .env.example .env.local     # puis renseigner DATABASE_URL, DATABASE_URL_UNPOOLED, BETTER_AUTH_SECRET…
npm install --ignore-scripts
npm run db:migrate             # applique drizzle/*.sql sur Neon
npm run dev
```

> `--ignore-scripts` est nécessaire dans les environnements où l'exécution de
> scripts npm est restreinte. Sur une machine classique, `npm install` suffit.

### Vérifications

```bash
npm run typecheck        # tsc --noEmit
npm test                 # 99 tests unitaires (purs, sans base)
npm run test:integration # 16 vérifications contre la vraie base Neon
```

`npm run test:integration` crée un utilisateur de test, exerce réellement le registre
(crédit, rejeu de webhook, réservation, libération, règlement, concurrence), vérifie
le cache marché (upsert, refus des données insuffisantes, expiration, invalidation)
puis supprime toutes ses données.

### Migrations

Le schéma est versionné en SQL brut dans `drizzle/` et appliqué par
`scripts/migrate.mjs` (table `_migrations`, une transaction par fichier).
Écrit à la main plutôt que généré : les contraintes `CHECK` et l'**index unique
partiel** qui porte l'idempotence du crédit ne doivent pas dépendre d'un générateur.

---

## Ce que fait J0

```
src/
├─ lib/
│  ├─ env.ts                 variables validées au boot (échec explicite)
│  ├─ db/
│  │  ├─ schema.ts           registre wallet, analyses, planches, cache marché
│  │  └─ index.ts            pool Neon partagé
│  ├─ wallet/
│  │  ├─ core.ts             PUR — soldes, idempotence, réservation/règlement
│  │  └─ repo.ts             écritures transactionnelles + verrou par utilisateur
│  ├─ geniuspay/
│  │  ├─ client.ts           initiation, vérification, réconciliation
│  │  └─ webhook.ts          HMAC-SHA256 + anti-rejeu 5 min
│  ├─ payments/settle.ts     application d'un paiement vérifié (webhook ET cron)
│  └─ auth.ts                email + mot de passe, vérification par email
├─ app/
│  ├─ page.tsx               démonstration publique
│  ├─ wallet/page.tsx        inscription, solde, recharge
│  └─ api/
│     ├─ auth/[...all]       Better Auth
│     ├─ wallet              solde + crédits restants
│     ├─ topups              initiation de recharge (≥ 5 000 FCFA)
│     ├─ webhooks/geniuspay  confirmation signée
│     └─ cron/reconcile      filet de sécurité webhooks perdus
├─ drizzle/0000_init.sql     schéma initial (DDL versionnée)
├─ scripts/
│  ├─ migrate.mjs            application des migrations + table _migrations
│  └─ integration.mjs        bundle esbuild + exécution du test d'intégration
└─ tests/
   ├─ wallet-core.test.ts    9 invariants (purs, sans base)
   └─ integration.ts         14 vérifications contre Neon
```

---

## Ce que fait J1 — identification

```
photos → OCR → archétype → candidats fournisseurs → appariement → DÉCISION
                                                                     │
                                        score ≥ 70 ET couverture ≥ 50 % ?
                                                        │
                                        oui ────────────┴──────────── non
                                          │                          │
                                   appariement                bloquee_article
                                          │                          │
                                   crédit réservé         réservation restituée
                                                                │
                                                     déblocage manuel tracé
```

| Fichier | Rôle |
|---|---|
| `lib/matching/score.ts` | `match_score` : visuel 40 · OCR 25 · attributs 20 · variante 15 |
| `lib/matching/text.ts` | normalisation, Jaccard, cosinus, centroïde |
| `lib/matching/variant.ts` | lecture couleur / taille / contenance d'un libellé libre |
| `lib/archetype/extract.ts` | archétype déterministe (« sérum vitamine C 30 ml ») |
| `lib/providers/*` | interfaces OCR / attributs / embeddings / sources + implémentations |
| `lib/pipeline/identify.ts` | l'étape, sans HTTP ni Inngest — donc testable hors ligne |
| `app/api/analyses` | création + réservation + identification |
| `app/api/analyses/[id]/confirm-article` | déblocage humain, tracé, sans libérer le crédit |

**La règle qui compte : une information absente ne vaut jamais un accord.** Chaque
composante déclare si elle avait une preuve. Sans preuve : 0 point, et la couverture
baisse. L'OCR seul plafonne à 25 points — il ne peut pas faire accepter un article.

Sans clé API, les fournisseurs par défaut ne devinent rien : l'analyse se **bloque**
proprement (`NO_CANDIDATE`). C'est le comportement voulu.

### Lire les photos sans budget

L'ordre de sélection est dans `lib/providers/index.ts` :

| Priorité | Fournisseur | Coût | Quand |
|---|---|---|---|
| 1 | **Mistral OCR** | ~1 $ / 1 000 pages | si `MISTRAL_API_KEY` — meilleur sur du texte dense |
| 2 | **Gemini 2.5 Flash** | **gratuit** (palier AI Studio) | si `GEMINI_API_KEY` — OCR + attributs dans le même modèle |
| 3 | Local (dev) | gratuit | aucun texte, aucune invention |

Gemini accepte aussi les images en `data:` — le parcours de capture fonctionne donc
**sans R2**. Paliers gratuits : attention aux quotas et à la réutilisation des données.

---

## Ce que fait J3 — moteur de saturation

| Fichier | Rôle |
|---|---|
| `market/classify.ts` | hooks → familles d'angles, par motifs auditable |
| `market/saturation.ts` | durée de diffusion, médiane, accélération, statuts, qualité des données |
| `market/portfolio.ts` | portefeuille priorisé, espace blanc importé, `auditPortfolio()` |

**Les trois règles qui empêchent le produit de mentir :**

1. **La longévité juge, pas la fréquence.** Une annonce vivante 60 jours a survécu à un
   test payé ; une annonce vue trois fois cette semaine ne prouve rien.
2. **« Non observé » n'est jamais « opportunité ».** L'angle inconnu est marqué
   `recommended: false` et sa justification dit littéralement qu'on ne sait pas.
3. **Un angle prouvé et omniprésent n'est pas écarté** : on garde l'angle, on change
   l'exécution. Le portefeuille le dit en clair.

**Le 5ᵉ statut.** La spécification prévoyait quatre cases, mais la plupart des angles
observés n'en remplissent aucune : visibles, sans longévité ni accélération. J'ai ajouté
`observed_unproven` plutôt que de les forcer dans une case qui aurait menti.

`auditPortfolio()` vérifie mécaniquement qu'aucune sortie ne contient d'affirmation non
sourcée, d'angle « importé » sans preuve de longévité, ou d'angle inconnu présenté comme
recommandé.

---

## Écrans

| Route | Rôle |
|---|---|
| `/` | Accueil : promesse, accès à la démo et au wallet |
| `/demo` | **Kit complet de démonstration** — les trois rapports rendus, consultables sans compte |
| `/wallet` | Inscription, solde, recharge GeniusPay, accès au lancement |
| `/nouveau` | Capture : photos compressées sur l'appareil, catégorie, régime, marché, variante |
| `/analyses/[id]` | Décision d'appariement : score décomposé, motif de blocage, déblocage manuel |
| `/historique` | *à faire* |

```bash
npm run dev
# http://localhost:3000/demo
```

### La démonstration est un livrable, pas une maquette

`src/lib/demo/fixtures.ts` contient trois kits **validés par les contrats de production**
(`tests/fixtures.test.ts`). Si un champ requis disparaît, si une allégation perd sa source,
si un script décale son hook au-delà de 2 secondes, **les tests cassent**. La démo ne peut
pas dériver vers des données que la production refuserait.

C'est aussi la démonstration publique prévue en SPEC §4.1 : montrer la valeur avant tout
paiement, sans rien offrir de gratuit côté moteur.

---

## Contrats & cache

**`contracts/`** — les trois kits sont validés par des schémas Zod qui refusent :
une affirmation sans source ni marque `hypothesis`, une planche déclarée valide sous 65,
une planche valide avec un slot manquant, un angle affirmé sans URL, un angle « prouvé »
sans 3 annonceurs ni 45 jours, un échantillon < 15 annonces déclaré autrement
qu'`insufficient`, un hook de plus de 2 secondes, un premier plan qui ne démarre pas à 0 s,
un angle créatif qui ne référence pas un angle du kit argumentaire.

**Un kit n'est jamais réparé : il est rejeté avec la liste de ses manquements.**

**`cache/`** — politique par niveau de confiance : 30 j (`high`), 21 j (`medium`),
14 j (`low`), **0 j (`insufficient`)**. On ne grave jamais une absence de données.
`store.ts` fait l'upsert sur l'index unique `(archetype_id, country, language)`.

C'est le levier économique n°1 : R2 dépend de l'**archétype × pays**, pas du produit.
Cinquante commerçants sur « sérum vitamine C 30 ml » en Côte d'Ivoire = une seule recherche.

---

## Les invariants du wallet (ce qui est testé)

1. **Le solde est la somme signée du registre.** Aucun `UPDATE` d'un champ balance.
2. **Aucune écriture ne peut rendre le solde négatif** — lot validé avant écriture.
3. **Idempotence par la base** : clé unique + index unique `(provider, provider_txn_id)`.
   GeniusPay n'expose pas de clé d'idempotence, on la porte côté serveur.
4. **Réservation au lancement, règlement à la livraison, libération intégrale sur échec.**
   Le wallet est un dépôt : aucun crédit consommé si rien n'est livré.
5. **Verrou consultatif par utilisateur** (`pg_advisory_xact_lock`) — les écritures
   concurrentes sont sérialisées sans bloquer les autres comptes.

---

## GeniusPay — points d'attention

- **Le corps brut est lu avant tout parsing** dans le webhook : re-sérialiser casse la signature.
- **On ne crédite jamais sur la foi du payload** : `verifyPayment()` revérifie statut et montant.
- **Le gateway est forcé** (`wave` en CI, `pawapay` en repli). Le checkout par défaut laisse
  les frais varier de 2,5 % à 11 %.
- **Webhooks perdus** : `/api/cron/reconcile` (toutes les 2 min, `CRON_SECRET`) reprend
  les recharges en attente depuis > 60 s.
- **Pas de payout API** chez GeniusPay → retraits manuels.

### Tester en sandbox

1. Créer un compte sur `geniuspay.ci` (le bouton « Obtenir ma clé API » mène à une waitlist).
2. Renseigner `GP_PK` / `GP_SK` / `GP_WHSEC` (secret webhook affiché **une seule fois**).
3. Enregistrer un webhook vers `{APP_URL}/api/webhooks/geniuspay`, événement `payment.success`.
4. `POST /api/topups` → redirection vers la page de paiement simulée.

---

## Limite connue de l'environnement de développement

`next build` compile et type-check correctement, mais la dernière phase du build
(collecte des pages) échoue ici avec `spawn EPERM` : le bac à sable interdit
l'ouverture de pipes nommés entre processus. Sur Vercel ou en local, le build
passe normalement.

---

## Suite

| Jalon | Contenu |
|---|---|
| **J1** ✅ | Capture, OCR, archétype, appariement, blocage dur — *reste : UI de capture et branchement des fournisseurs réels* |
| **J2** 🟡 | Slots, sélection par emplacement, dHash + faux consensus, score de fidélité, refus actionnable — *reste : moisson réelle, décodage d'images, exports* |
| **J3** 🟡 | Classification des hooks, matrice fréquence × longévité, portefeuille priorisé, garde-fous + audit — *reste : collecte Meta/TikTok, verbatims* |
| **Contrats & cache** ✅ | Schémas Zod des trois kits, vérifications croisées, cache par archétype × pays |
| **J3** | Marché : verbatims, objections, concurrence, portefeuille d'angles, cache |
| **J4** | Kit production + exports PDF/ZIP |
| **J5** | Admin, réconciliation complète, plafonds, `pipeline_costs` |
