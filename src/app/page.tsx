import Link from "next/link";

const KITS = [
  {
    verb: "MONTRER",
    title: "Kit matière",
    body: "La fiche factuelle du produit et sa planche visuelle : vues multi-angles, dimensions, texte du label, score de fidélité.",
  },
  {
    verb: "CONVAINCRE",
    title: "Kit argumentaire",
    body: "Ce qui fait acheter sur le marché visé : désirs, objections réelles, concurrence, angles déjà prouvés.",
  },
  {
    verb: "PRODUIRE",
    title: "Kit production",
    body: "Angles, hooks, scripts verticaux 15 s et prompts d'image — prêts à emporter dans ton outil de création.",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-md px-5 pb-16 pt-10">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
        Afrique de l&apos;Ouest
      </p>
      <h1 className="mt-3 text-3xl font-semibold leading-tight">
        De la photo produit au&nbsp;kit de vente.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-stone-600">
        Photographie ton produit. Creaad identifie l&apos;article, construit sa planche visuelle,
        puis sort les arguments et les angles publicitaires qui font vendre.
      </p>

      <Link
        href="/demo"
        className="mt-8 block rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white active:scale-[0.99]"
      >
        Voir un kit complet (exemple)
      </Link>
      <p className="mt-2 text-center text-xs text-stone-500">
        Gratuit, sans compte — un vrai kit, trois rapports
      </p>

      <Link
        href="/wallet"
        className="mt-3 block rounded-2xl border border-stone-300 px-5 py-4 text-center text-[15px] font-medium text-stone-900"
      >
        Recharger et lancer une analyse
      </Link>
      <p className="mt-2 text-center text-xs text-stone-500">
        5 000 FCFA · 5 analyses · tes crédits ne sont débités qu&apos;à la livraison
      </p>

      <section className="mt-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
          Comment ça marche
        </p>
        <ol className="mt-3 space-y-3">
          {[
            ["Photographie ton produit", "3 à 6 photos suffisent, prises au téléphone."],
            ["Reçois tes 3 kits", "La planche visuelle, les angles du marché, les créas à tourner."],
            ["Emporte et produis", "Copie le kit, génère tes visuels, lance ta campagne."],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-white">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs leading-relaxed text-stone-500">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 space-y-3">
        {KITS.map((kit) => (
          <article key={kit.title} className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-[11px] font-semibold tracking-[0.15em] text-stone-400">
              {kit.verb}
            </p>
            <h2 className="mt-1 text-base font-semibold">{kit.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">{kit.body}</p>
          </article>
        ))}
      </section>

      <p className="mt-10 text-xs leading-relaxed text-stone-400">
        Chaque kit est sourcé, et rejeté s&apos;il ne respecte pas le contrat — mieux vaut
        pas de rapport qu&apos;un rapport inventé.
      </p>
    </main>
  );
}
