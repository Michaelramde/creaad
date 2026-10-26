# Creaad

> Photographie un produit. Reçois tout ce qu'il faut pour le vendre.

Application web mobile-first qui transforme les photos d'un produit en **trois kits** :

| Kit | Question à laquelle il répond |
|---|---|
| **Montrer** | La planche visuelle et les faits vérifiés du produit |
| **Convaincre** | Les angles qui marchent déjà sur le marché visé, et ceux qui restent libres |
| **Produire** | Les angles créatifs, hooks, scripts et prompts d'image |

**En ligne : [creaad.site](https://creaad.site)** · Démonstration libre : [/demo](https://creaad.site/demo)

---

## Deux étapes, deux demandes, 1 crédit chacune

| Étape | Contenu | Coût |
|---|---|---|
| **1 · Le produit** | ~37 images (galerie + description A+ + avis), spécifications, dimensions mesurées, coloris, faits corroborés, avis clients | **1 000 FCFA** |
| **2 · Le marché** | concurrents et leurs annonces, désirs de masse, objections (avis ≤ 3 ★ + annonces), angles, espace blanc, risques Meta, kit production | **1 000 FCFA** |

L'étape 1 se suffit à elle-même : le dossier produit est livré et consultable seul. L'étape 2 est un bouton explicite — on ne dépense jamais le second crédit par surprise.

---

## Comment ça marche

```
photos → OCR + attributs (Gemini)     ─┐
      → archétype                     │ identification
      → recherche AliExpress (HTTP)   │  score /100, seuil 70
      → comparaison visuelle + texte  ─┘
      → planche (emplacements classés, score de fidélité /100, seuil 65)
      → marché (annonces Meta déjà collectées, cache 30 j)
      → kit production (rédaction contrainte par le portefeuille d'angles)
```

Deux verrous, volontaires :

1. **Article non reconnu** → aucun débit, le commerçant confirme ou reprend.
2. **Planche incomplète** → aucun débit, l'app dit quelles photos manquent.

Le crédit n'est débité qu'à la livraison des kits.

---

## Les trois sources, et pourquoi

| Besoin | Source retenue | Coût |
|---|---|---|
| Lecture des étiquettes, attributs, comparaison visuelle | **Gemini** (palier gratuit) | 0 € |
| Produits de référence | **AliExpress en HTTP simple** (`og:title`, `og:image`) | 0 € |
| Annonces concurrentes | **Acteur Apify** `jmlp/meta-ad-library-scraper` | ~0,007 $ / archétype |

Meta Ad Library **refuse l'automatisation** : notre navigateur reçoit une page `_fb_noscript`, et la librairie open source échoue (identifiant GraphQL périmé). L'acteur Apify passe par des proxys résidentiels — c'est la seule voie gratuite qui fonctionne, vérifiée sur 118 annonces réelles à Abidjan.

La collecte tourne **seule toutes les 6 heures** (GitHub Actions) et écrit dans `ad_observations`. Comme le kit marché dépend de l'**archétype × pays** et non du produit, le volume est borné par le catalogue : mille clients ne coûtent pas plus cher que dix.

---

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · Neon (Postgres) · Drizzle · Better Auth · GeniusPay · Vercel · GitHub Actions

Pas d'orchestrateur distribué : le pipeline tient en quelques appels réseau et deux calculs purs, il tourne donc en synchrone.

---

## Démarrer

```bash
cp .env.example .env.local     # DATABASE_URL, BETTER_AUTH_SECRET, GEMINI_API_KEY…
npm install --ignore-scripts
npm run db:migrate
npm run dev
```

| Commande | Rôle |
|---|---|
| `npm test` | 193 tests unitaires |
| `npm run test:integration` | 16 vérifications contre Neon |
| `npm run test:e2e` | paiement GeniusPay sandbox de bout en bout |
| `npm run test:e2e:webhook` | webhook signé contre la production |
| `npm run collect:meta` | collecte des annonces Meta (Apify) |
| `npm run collect:aliexpress` | enrichissement produit |
| `npm run typecheck` | `tsc --noEmit` |

---

## État vérifié

**En production (`creaad.site`), le 24/10 :**

| Étape | Résultat |
|---|---|
| Inscription → session → accès wallet | ✅ sans vérification email |
| Étape 1 · dossier produit | ✅ `produit_pret` en 31 s · planche 74/100 · **1 crédit** |
| Étape 2 · étude de marché | ✅ `livree` en 3 s · 45 annonces · **1 crédit** |
| Enrichissement (after) | ✅ 4 concurrents · 3 désirs · 2 objections · créas |
| Fiche produit | ✅ **37 images** (dont 24 de description) · 4 avis · dimensions 18×7×32 cm |

**En local, avec fournisseurs déterministes :** planche 80/100 validée → 50 annonces de marché → kit production rédigé → **livraison complète**.

| | |
|---|---|
| Tests | **193** unitaires · 16 intégration · 2 e2e · **CI bloquante** (typage + tests + build) |
| Collecte marché | 118 annonces réelles, 4 archétypes, automatique toutes les 6 h |
| **Taux de livraison mesuré** | **31,7 %** des analyses terminées (19 livrées / 60) · blocage article **35 %** · planche refusée **21,7 %** · échecs techniques **11,7 %** |
| Paiement | recharge → webhook signé → crédit → kits (validé en production) |

---

## Limites connues

- **La livraison complète n'a pas encore été observée en production** : il faut trois vues distinctes du même produit. AliExpress n'en expose qu'une par annonce, et son classement varie selon l'IP — ce jeu de photos ne peut venir que d'un vrai commerçant.
- **Quota Gemini gratuit** : ~4 appels par analyse, et les quotas sont **par modèle** — une chaîne de repli (`flash-lite`) prend le relais quand le principal est saturé.
- **AliExpress** : la page *produit* est bloquée depuis les IP datacenter ; seuls les résultats de la page de *recherche* sont lisibles (titre, image, prix). C'est suffisant pour l'appariement, pas pour un enrichissement profond.
- **Verbatims clients** : les avis ne sont pas encore extraits.
- **Exports** : copie texte + un ZIP (fiche Markdown + images). Pas de PDF ni de planche-image.
- **PWA** : le manifeste annoncé n'existe pas encore (404) — l'app n'est pas installable.
- **TikTok** : non branché — l'écosystème open source est trop ancien.

---

## Pilotage (août–octobre 2026)

Le produit mesure désormais ce qu'il livre, pas seulement ce qu'il dépense.

| Outil | Rôle |
|---|---|
| `/admin/metrics` | funnel, taux de livraison, coût par livraison, couverture des archétypes (protégé par `ADMIN_EMAILS`) |
| `GET /api/health` | sonde : base, modèle de génération, **modèle d'embedding** (sans repli), jeton Apify |
| `npm run costs` | coût réel par étape, lu dans `pipeline_costs` — l'arbitre des chiffres contradictoires |
| `npm run eval:hooks` | distribution des familles d'angles sur les annonces réellement collectées |
| `v_funnel`, `v_costs`, `v_cost_per_delivery` | les mêmes agrégats en SQL, pour le runbook (migration 0017) |

`pipeline_costs` journalise maintenant **Gemini** (tokens + modèle) et les **frais GeniusPay**, pas seulement Apify.

## Documentation

- [`docs/ADR.md`](./docs/ADR.md) — six décisions d'architecture, et ce qui a été écarté
- [`docs/RUNBOOK.md`](./docs/RUNBOOK.md) — six incidents, et quoi faire

- [`SPEC.md`](./SPEC.md) — spécification complète (contrats, scoring, saturation, wallet)
- [`DEPLOY.md`](./DEPLOY.md) — GitHub → Vercel → `creaad.site`
