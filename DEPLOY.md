# Déploiement — GitHub → Vercel → creaad.site

> Ordre important : **GitHub d'abord**, puis Vercel (l'import se fait depuis le repo),
> puis le domaine (pour que `APP_URL` soit correct dès le premier déploiement).

---

## 1. GitHub

Le dépôt local est prêt (`git init` fait, premier commit `97d3dca`, 84 fichiers).
`.env.local`, `node_modules/`, `.npm-cache/` et `.tmp/` sont ignorés.

```bash
# Créer un dépôt VIDE sur github.com (sans README, sans .gitignore)
git remote add origin https://github.com/<ton-compte>/creaad.git
git push -u origin main
```

> L'auteur des commits est réglé localement sur `Creaad Dev <dev@creaad.site>`.
> Pour le mettre à ton nom :
> `git config user.name "Ton Nom" && git config user.email "ton@email"`
> puis `git commit --amend --reset-author --no-edit`.

---

## 2. Vercel

1. **vercel.com/new** → importe le repo `creaad`
2. Framework détecté : **Next.js** — ne rien changer (build `next build`, output `.next`)
3. **Settings → Environment Variables** : ajoute la liste ci-dessous
4. Deploy

### Variables d'environnement

| Variable | Valeur |
|---|---|
| `DATABASE_URL` | chaîne **pooled** Neon |
| `DATABASE_URL_UNPOOLED` | chaîne directe Neon (migrations) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `APP_URL` | `https://creaad.site` |
| `RESEND_API_KEY` | `re_...` |
| `EMAIL_FROM` | `Creaad <no-reply@creaad.site>` |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` | Cloudflare R2 |
| `GP_BASE` | `https://geniuspay.ci/api/v1/merchant` |
| `GP_PK` / `GP_SK` / `GP_WHSEC` | GeniusPay |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | Inngest |
| `GEMINI_API_KEY` | Google AI Studio |
| `MISTRAL_API_KEY` | optionnel (OCR payant, plus dense) |
| `APIFY_TOKEN` | optionnel (sources) |
| `NEXT_PUBLIC_CREDIT_XOF` | `1000` |
| `MIN_TOPUP_XOF` | `5000` |

⚠️ **`APP_URL` doit correspondre exactement** au domaine servi (schéma et sous-domaine
compris). Sinon Better Auth émet des cookies pour un autre domaine et les sessions ne
tiennent pas.

⚠️ **Plan Pro obligatoire** : Hobby est non commercial, et le cron `/api/cron/reconcile`
(toutes les 2 minutes) n'est pas disponible en Hobby.

---

## 3. Domaine `creaad.site`

### Dans Vercel
**Project → Settings → Domains** → ajoute :
- `creaad.site`
- `www.creaad.site`

Vercel affiche alors les enregistrements à créer.

### Chez le registrar (là où `creaad.site` a été acheté)

| Type | Nom | Valeur |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

> Alternative plus simple si le registrar le permet : remplacer les serveurs de noms par
> `ns1.vercel-dns.com` et `ns2.vercel-dns.com`. Vercel gère alors tout, y compris les
> renouvellements de certificat.

HTTPS est provisionné automatiquement (Let's Encrypt) dès que le DNS répond.

### Une fois le domaine actif — 4 choses à recoller

1. **Vercel** : `APP_URL=https://creaad.site`, puis **Redeploy**
2. **Cloudflare R2 → CORS** : ajouter `https://creaad.site` aux `AllowedOrigins`
3. **GeniusPay → Webhooks** : URL `https://creaad.site/api/webhooks/geniuspay`,
   événement `payment.success`
4. **Resend** : ajouter et vérifier le domaine `creaad.site` (SPF + DKIM), sinon les
   emails de vérification partent en spam ou sont refusés

---

## 4. Vérifications après déploiement

```bash
curl -s https://creaad.site/api/wallet          # doit répondre 401 UNAUTHENTICATED
curl -s -X POST https://creaad.site/api/webhooks/geniuspay -d '{}'   # doit répondre 401
```

- `https://creaad.site/` → page d'accueil
- `https://creaad.site/demo` → kit de démonstration
- Inscription → email de vérification reçu
- Recharge test en sandbox GeniusPay → solde crédité

---

## 5. Base de données

Les migrations sont **versionnées en SQL** et appliquées par le script :

```bash
npm run db:migrate        # en local, avec .env.local
```

Depuis Vercel, lance-les en local pointant sur la base de production, ou ajoute un job
dédié plus tard. Ne les mets pas dans le build : un build ne doit pas modifier le schéma.
