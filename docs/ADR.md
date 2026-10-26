# Décisions d'architecture (ADR) — Creaad

> Six décisions prises le 25/10/2026 après la [revue adversariale](./REVUE-ADVERSARIALE.md).
> Format : contexte → décision → conséquences → alternatives écartées.

---

## ADR-001 — Routage produit → marché déterministe, sans embeddings

**Contexte.** La clé de jointure entre les photos d'un commerçant et les annonces collectées était
un slug produit par heuristique, comparé à un vocabulaire écrit à la main. Mesure : **3 slugs
retrouvés sur 16** ; un titre anglais produisait `beaute-produit`, un sérum « éclaircissant »
produisait une autre clé que le même sérum sans ce mot.

**Décision.** Un catalogue explicite (`market-catalogue.ts`) déclare, par marché, les mots qui
désignent le type de produit (FR + EN) et ceux qui le distinguent. `resolve.ts` note par
recouvrement de vocabulaire, exige une **marge** entre le premier et le second candidat, et
renvoie `ambiguous` plutôt qu'un mauvais slug. Le modèle n'intervient qu'en arbitre.

**Conséquences.** 72 formulations réelles : **0 erreur assurée**, résolution ≥ 90 %, test doré de
non-régression. Coût 0, latence 0, testable hors ligne.

**Écarté.** Embeddings du libellé : pour un catalogue de 16 entrées, un vecteur ajoute un appel
réseau, une latence, une dépendance et un coût pour un problème que 16 listes de mots résolvent
mieux. `pgvector` reste la bonne réponse pour `product_index` (des milliers d'images).

---

## ADR-002 — Classification des angles par modèle, cache permanent

**Contexte.** 12 règles regex mesuraient **29 %** d'exactitude sur 24 annonces ivoiriennes réelles,
et classaient **66 % d'un corpus neutre** en « preuve sociale ». Toute la matrice de saturation —
le livrable vedette — reposait dessus.

**Décision.** Le modèle étiquette les hooks par lots de 20 ; le résultat est stocké dans
`hook_labels` par empreinte du texte (**jamais repayé**, stable dans le temps). Le déterministe
devient un repli (75 % de précision, 86 % sur les cas tranchés) et **s'abstient** quand il doute :
`non-classe` sort de la matrice au lieu de la polluer.

**Conséquences.** `label_version` permet d'invalider les matrices calculées avec une ancienne
taxonomie. Coût : un appel par 20 hooks inédits, gratuit au palier actuel.

---

## ADR-003 — Pipeline asynchrone via `after()`, sans orchestrateur

**Contexte.** Le pipeline complet (30-55 s) vivait dans le handler HTTP de `POST /api/analyses`,
sans `maxDuration`. Un timeout coupait la fonction au milieu d'un appel Apify déjà payé. Inngest
était installé (12,9 Mo) et **jamais utilisé**.

**Décision.** La route répond **202 en moins d'une seconde** avec l'identifiant ; le pipeline
s'exécute dans `after()`, écrit sa progression réelle (`ocr` → `appariement`) et persiste le
résultat. La page de résultat lit l'état en base et se rafraîchit toutes les 2,5 s.

**Conséquences.** Plus de timeout payé, plus d'écran figé, progression honnête (les étapes
inventées `at: 5, 13, 20…` ont disparu). Un échec dans `after()` libère le crédit et marque
`echouee`.

**Écarté.** Inngest / file de messages : une primitive native suffit, et chaque fournisseur en
moins est une panne en moins.

---

## ADR-004 — Photos envoyées directement vers R2

**Contexte.** Six photos en base64 traversaient la fonction Vercel et finissaient dans
`analyses.photos` (jsonb, ~1,8 Mo par ligne). La limite de payload (4,5 Mo) et la saturation de
Neon (~275 analyses) étaient des échéances, pas des risques. Les dépendances `@aws-sdk/*` étaient
installées et jamais importées.

**Décision.** `POST /api/uploads/presign` renvoie des URL présignées ; le navigateur envoie les
octets ; l'API ne reçoit que des URL.

**Révision du 26/10** : exiger `R2_PUBLIC_URL` faisait dépendre tout l'upload d'un réglage de
tableau de bord (activer le sous-domaine `r2.dev` ou brancher un domaine). Le bucket peut rester
**privé** : la route `/api/storage/[...key]` sert l'objet, et la clé contient un UUID — donc elle
est aussi peu devinable qu'une URL signée, sans expiration. `R2_PUBLIC_URL` devient une simple
optimisation (le navigateur lit directement), plus une condition.

**Conséquences.** L'octet ne traverse plus la fonction (SPEC §5 respecté), la base ne grossit plus
avec des images, la limite de payload disparaît. Dépendances enfin justifiées.

---

## ADR-005 — Score de fidélité mesuré, facteur plafonné

**Contexte.** Les 50 points de « couverture » mesuraient la réussite du classificateur de vues :
quatre photos mal classées passaient à 87, trois photos parfaites avec une vue manquante
tombaient à 62.

**Décision.** On mesure les pixels (`sharp`, fourni par Next) : netteté par variance du Laplacien,
uniformité du fond par écart-type des bords. La qualité mesurée entre comme **facteur** `0,7 → 1,0`.

**Conséquences.** Une mesure ne peut que **baisser** un score, jamais l'augmenter — sinon ce serait
un bonus, pas une mesure. Si `sharp` est indisponible, le score reste inchangé (dégradation
déclarée).

---

## ADR-006 — Machine à états réduite à ce qui existe

**Contexte.** La SPEC décrit 16 états ; **7 n'étaient ni écrits ni lus** (`reservee`, `capture`,
`moisson`, `en_attente_validation`, `recherche_marche`, `marche_pret`, `production`). Un nouveau
venu cherchait un flux qui n'existait pas.

**Décision.** Migration `0019` : contrainte limitée aux 9 états réellement utilisés, type TypeScript
aligné. Le compilateur a immédiatement signalé un consommateur oublié (le cron de récupération).

**Conséquences.** La documentation et le code disent la même chose ; toute réintroduction d'un
état devra être justifiée par un écrivain ET un lecteur.

---

*Ces décisions sont réversibles, mais chacune est accompagnée d'un test qui empêche de les défaire
par accident.*
