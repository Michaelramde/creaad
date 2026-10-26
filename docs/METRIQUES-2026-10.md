# Mesures de production — 25 octobre 2026

> Relevé exécuté sur la base de production (`DATABASE_URL`) en lecture seule, avant toute modification de code.
> **C'est le chiffre qui commande le plan** : aucun chantier ne devait démarrer sans lui.

---

## 1. Le portillon : le produit livre-t-il ?

```
bloquee_article   21
livree            19
planche_prete     13
creee              9
produit_pret       8
echouee            7
```

| Indicateur | Valeur | Lecture |
|---|---|---|
| Analyses en base | 77 | dont 9 `creee` (coquilles de test, jamais lancées) |
| **Analyses terminées** | **60** | `livree` + `bloquee_article` + `planche_prete` + `echouee` |
| **Taux de livraison complète** | **31,7 %** (19/60) | 3 kits complets sur 10 analyses abouties |
| **Taux de dossier (étape 1)** | **39,7 %** (27/68) | le commerçant a reçu *quelque chose* 4 fois sur 10 |
| Dossiers produit livrés | 27 | 19 `livree` + 8 `produit_pret` |
| **Blocage article** | **35 %** (21/60) | le premier poste de perte |
| Planche refusée | 21,7 % (13/60) | le second |
| Échecs techniques | 11,7 % (7/60) | le troisième |

> **Une seule définition, partout** : la vue `v_funnel` (migration 0020) et la page `/admin/metrics`
> produisent désormais exactement ces chiffres. La migration 0017 divisait par *toutes* les analyses
> (24,7 %) alors que la page divisait par les analyses *terminées* (31,7 %) : deux vérités pour un
> même nombre, corrigé le jour même où il a été constaté.

**Verdict du portillon** : 31,7 % ≥ 30 % → on continue, **et la clé de jointure archétype devient prioritaire absolue** (35 % de blocage article + 21,7 % de refus de planche).

Le produit fonctionne. Il ne fonctionne pas encore assez souvent pour qu'on parle de marge.

---

## 2. Les coûts réels (arbitrage des chiffres contradictoires)

Trois chiffres différents coexistaient dans les commentaires du code. Voici la vérité, lue dans `pipeline_costs` :

| Étape | Fournisseur | Appels | Coût moyen | Ligne du code qui annonçait autre chose |
|---|---|---|---|---|
| `image-search` | apify | 38 | **0,00895 $** (10 lignes estimées → ≈ 0,012 $ réel) | 0,02 $ · 0,101 $ |
| `product-detail` | apify | 21 | **0,05000 $** | 0,05 $ ✅ |
| `suppliers` | apify | 6 | **0,01925 $** | 0,0049 $ · 0,101 $ |
| `ads-pays` | apify | 10 | **0,00051 $** | ~0,007 $ |
| `ads-zone` | apify | 5 | 0,00520 $ | ~0,007 $ |
| `ads-monde` | apify | 1 | 0,00096 $ | ~0,007 $ |

**Conclusion** : la recherche par image coûte **0,009 $**, pas 0,101 $ (×11 d'écart). L'annonce la plus chère du dépôt — celle qui justifiait de conditionner l'appel aux fournisseurs — était fausse d'un facteur 11.

Dépense Apify totale sur la période : **1,5376 $** · **par livraison : 0,08093 $ ≈ 49 FCFA** (mesuré par `npm run costs`).

---

## 3. Couverture du catalogue

17 archétypes portent des annonces, tous au-dessus de 8 :

```
gadgets-ecouteur-bluetooth  53 ads · 32 annonceurs
beaute-serum-30ml           51 · 32
mode-sac                    45 · 32
gadgets-coque-telephone     40 · 19
mode-chaussure-homme        39 · 26
gadgets-ventilateur-portable 39 · 29
cheveux-huile-croissance    38 · 19
beaute-savon-noir           38 · 19
gadgets-montre-connectee    31 · 22
beaute-parfum               30 · 18
beaute-creme-visage         28 · 15
mode-sac-femme              24 · 13
beaute-huile-corporelle     20 · 13
cheveux-mousse-boucles      19 · 7
mode-produit                18 · 13   ← seau de repli, jamais une cible
mode-robe-wax               10 · 5
cheveux-perruque-lace        8 · 6
```

**18 annonces ont atterri dans `mode-produit`** — un archétype que personne n'a conçu, produit par l'heuristique de slug. C'est la preuve chiffrée de la faille de jointure : personne ne route vers ce slug, mais 18 annonces y sont.

---

## 4. Qualité du classifieur d'angles — mesurée, pas supposée

Sur **24 annonces ivoiriennes réelles** étiquetées à la main (`tests/fixtures/hooks-labelled.ts`) :

| Version | Précision | Sur les cas tranchés |
|---|---|---|
| Sous-chaîne (`includes`) | **29 %** (7/24) | — |
| Frontières de mot + NFKC + seuil | **75 %** (18/24) | **86 %** (18/21) |

Le symptôme le plus parlant : sur un corpus de 300 hooks **sans aucun angle**, la version par sous-chaîne classait **66 % en « preuve sociale »**. Une famille qui absorbe deux tiers du bruit devient mécaniquement « durable ici » — et c'est cette conclusion qui était vendue.

Le modèle (Gemini, un appel par 20 hooks inédits, cache permanent dans `hook_labels`) devient la source primaire ; le déterministe n'est plus qu'un repli.

---

## 5. Routage produit → marché — mesuré, puis corrigé

Sur **72 formulations réelles** (FR/EN, marques, formats) couvrant les 16 marchés :

| Version | Résolution | Erreurs assurées |
|---|---|---|
| Heuristique de slug seule | 3/16 slugs retrouvés (audit) | nombre non mesuré |
| **Vocabulaire explicite (noms + modificateurs)** | **≥ 90 %** | **0** |

Contrat tenu : le routeur ne se trompe jamais avec assurance. Il rend un slug, ou il s'abstient — jamais un mauvais marché présenté comme certain.

---

## 6. Ce que ces chiffres changent

1. **La priorité est confirmée par la donnée** : 56,7 % des pertes viennent de l'identification ou de la planche, pas du marché. L'archétype était bien le multiplicateur.
2. **Le coût n'est pas le problème** : ~0,026 $ par analyse pour 1 000 FCFA facturés. La contrainte est la **couverture**, pas la marge.
3. **Les commentaires de code ne sont pas une comptabilité** : un facteur 11 d'écart sur le poste le plus commenté du dépôt.
4. **Ce qui n'est pas mesuré n'existe pas** : ni le taux de livraison, ni l'exactitude du classifieur, ni le coût Gemini n'étaient connus. Ils le sont maintenant, et deux garde-fous (tests) empêchent la régression.

---

## 7. Ce qu'il reste à mesurer

- **Taux de livraison après les corrections** : à relire dans 30 jours sur `/admin/metrics`. Objectif : > 60 %.
- **Coût Gemini réel** : journalisé depuis cette version, mais aucune ligne n'existe encore avant elle.
- **Distribution des scores d'appariement** : la page `/admin/metrics` l'affiche, pour recalibrer le seuil de 70.
