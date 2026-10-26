/**
 * Un écran de chargement global : sans lui, une page lente affiche du blanc,
 * ce qui donne l'impression que l'application ne répond pas — le pire message
 * sur un forfait mobile.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center px-5">
      <p className="text-sm text-stone-500">Chargement…</p>
    </main>
  );
}
