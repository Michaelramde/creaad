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
| `npm test` | 116 tests unitaires |
| `npm run test:integration` | 16 vérifications contre Neon |
| `npm run test:e2e` | paiement GeniusPay sandbox de bout en bout |
| `npm run test:e2e:webhook` | webhook signé contre la production |
| `npm run collect:meta` | collecte des annonces Meta (Apify) |
| `npm run collect:aliexpress` | enrichissement produit |
| `npm run typecheck` | `tsc --noEmit` |

---

## État vérifié

| | |
|---|---|
| Identification réelle | **85/100** (visuel 40/40, texte 25/25, attributs 20/20) |
| Planche, chemin complet | **72/100**, 5 vues sur 5, validée |
| Marché | 118 annonces réelles, 4 archétypes, cache 30 j |
| Paiement | recharge → webhook signé → crédit → kits, validé en production |
| Tests | 116 unitaires · 16 intégration · 2 e2e |

---

## Limites connues

- **Quota Gemini gratuit** : ~4 appels par analyse. Le palier gratuit s'épuise vite en développement ; les erreurs 429/503 sont réessayées puis remontées proprement (aucun débit).
- **TikTok** : non branché. Les projets open source existants sont anciens et le Creative Center exige une signature.
- **Verbatims clients** : les avis AliExpress ne sont pas encore extraits — seuls titre et image le sont.
- **Exports** : copie texte uniquement (pas de PDF/ZIP).
- **Historique** : pas d'écran de liste ; chaque analyse a son URL.

---

## Documentation

- [`SPEC.md`](./SPEC.md) — spécification complète (contrats, scoring, saturation, wallet)
- [`DEPLOY.md`](./DEPLOY.md) — GitHub → Vercel → `creaad.site`
