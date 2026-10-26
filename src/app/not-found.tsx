import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-5 pb-20 pt-10">
      <h1 className="text-xl font-semibold">Page introuvable</h1>
      <p className="mt-2 text-sm leading-relaxed text-stone-600">
        Cette page n&apos;existe pas, ou elle ne t&apos;appartient pas.
      </p>
      <Link
        href="/"
        className="mt-6 block rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white"
      >
        Revenir à l&apos;accueil
      </Link>
    </main>
  );
}
