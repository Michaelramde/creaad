"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Kicker } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { compressImage, type CompressedImage } from "@/lib/client/image";

const COUNTRIES = [
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SN", label: "Sénégal" },
  { code: "BJ", label: "Bénin" },
  { code: "TG", label: "Togo" },
  { code: "ML", label: "Mali" },
  { code: "BF", label: "Burkina Faso" },
  { code: "CM", label: "Cameroun" },
];

const MAX_PHOTOS = 6;

/** Étapes du pipeline, dans l'ordre réel de leur exécution. */
const STAGES = [
  { at: 0, label: "Lecture des photos" },
  { at: 5, label: "Recherche du produit" },
  { at: 13, label: "Comparaison des annonces" },
  { at: 20, label: "Construction de la planche" },
  { at: 26, label: "Analyse du marché" },
  { at: 32, label: "Rédaction des créas" },
];

export default function NewAnalysisPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const [country, setCountry] = useState("CI");
  const [userText, setUserText] = useState("");
  const [images, setImages] = useState<CompressedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [needsTopup, setNeedsTopup] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [busy]);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    const room = MAX_PHOTOS - images.length;
    const picked = [...files].slice(0, Math.max(0, room));
    try {
      const compressed = await Promise.all(picked.map((f) => compressImage(f)));
      setImages((prev) => [...prev, ...compressed]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de lire ces images.");
    }
  }

  async function submit() {
    if (images.length === 0) {
      setError("Ajoute une photo du produit.");
      return;
    }
    setBusy(true);
    setElapsed(0);
    setError(null);
    setNeedsTopup(false);
    try {
      // La catégorie et le mode sont déduits par le moteur : le commerçant
      // n'a rien à décider, il montre son produit.
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country,
          images: images.map((i) => ({ url: i.dataUrl, width: i.width, height: i.height })),
          userText: userText.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setNeedsTopup(true);
        return;
      }
      if (!res.ok) throw new Error(data.message ?? data.error ?? "L'analyse a échoué.");

      router.push(`/analyses/${data.analysisId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <p className="px-5 pt-10 text-sm text-stone-500">Chargement…</p>;

  if (!session) {
    return (
      <main className="mx-auto max-w-md px-5 pb-20 pt-10">
        <h1 className="text-xl font-semibold">Connecte-toi d&apos;abord</h1>
        <p className="mt-2 text-sm text-stone-600">Un email suffit. Pas de SMS, pas de carte.</p>
        <Link
          href="/wallet"
          className="mt-6 block rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white"
        >
          Créer mon compte
        </Link>
      </main>
    );
  }

  if (busy) return <Progress elapsed={elapsed} />;

  return (
    <main className="mx-auto max-w-md px-5 pb-24 pt-10">
      <Kicker>Nouveau</Kicker>
      <h1 className="mt-1 text-xl font-semibold">Montre ton produit</h1>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">
        Une photo suffit pour commencer. Ajoute-en d&apos;autres (face, dos, étiquette) pour une
        planche plus fidèle.
      </p>

      {/* Photos : une grande zone quand c'est vide, une grille ensuite */}
      {images.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-5 flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-stone-300 bg-white px-6 py-10 active:scale-[0.99]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-900 text-xl text-white">
            +
          </span>
          <span className="mt-3 text-sm font-medium">Ajoute une photo</span>
          <span className="mt-1 text-xs text-stone-500">Prends-la maintenant ou choisis dans ta galerie</span>
        </button>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-2">
          {images.map((image, index) => (
            <div key={index} className="relative overflow-hidden rounded-xl border border-stone-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image.dataUrl} alt="" className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
                className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/60 text-xs text-white"
                aria-label="Retirer"
              >
                ×
              </button>
            </div>
          ))}

          {images.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-stone-300 bg-white text-stone-400 active:scale-[0.98]"
            >
              <span className="text-2xl leading-none">+</span>
              <span className="mt-1 text-[10px]">Ajouter</span>
            </button>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void onFiles(event.target.files)}
      />

      {/* Nom du produit — le seul champ qui améliore vraiment le résultat */}
      <label className="mt-5 block">
        <span className="text-xs font-medium text-stone-600">Nom du produit</span>
        <input
          value={userText}
          onChange={(event) => setUserText(event.target.value)}
          placeholder="ex. Sac Jeep 3 en 1"
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm outline-none focus:border-stone-900"
        />
        <span className="mt-1 block text-[11px] text-stone-400">
          Facultatif, mais c&apos;est ce qui aide le plus à trouver le bon modèle.
        </span>
      </label>

      <label className="mt-4 block">
        <span className="text-xs font-medium text-stone-600">Où tu vends</span>
        <select
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm outline-none focus:border-stone-900"
        >
          {COUNTRIES.map((item) => (
            <option key={item.code} value={item.code}>
              {item.label}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {needsTopup && (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium">Il te faut une analyse pour lancer celle-ci.</p>
          <Link href="/wallet" className="mt-2 block text-sm font-medium text-amber-900 underline">
            Recharger mon wallet
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={images.length === 0}
        className="mt-6 w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white disabled:opacity-40"
      >
        Lancer l&apos;analyse
      </button>

      <p className="mt-3 text-center text-[11px] text-stone-400">
        Aucun débit si le produit n&apos;est pas reconnu.
      </p>
    </main>
  );
}

function Progress({ elapsed }: { elapsed: number }) {
  const current = STAGES.reduce((acc, stage, index) => (elapsed >= stage.at ? index : acc), 0);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="relative flex h-9 w-9 items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stone-900 opacity-20" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-stone-900" />
        </span>
        <div>
          <p className="text-sm font-medium">Analyse en cours</p>
          <p className="text-xs tabular-nums text-stone-500">{elapsed} s</p>
        </div>
      </div>

      <ol className="mt-8 space-y-3">
        {STAGES.map((stage, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={stage.label} className="flex items-center gap-3">
              <span
                className={
                  done
                    ? "flex h-5 w-5 items-center justify-center rounded-full bg-stone-900 text-[10px] text-white"
                    : active
                      ? "flex h-5 w-5 items-center justify-center rounded-full border-2 border-stone-900"
                      : "flex h-5 w-5 items-center justify-center rounded-full border border-stone-300"
                }
              >
                {done ? "✓" : ""}
              </span>
              <span
                className={
                  done
                    ? "text-sm text-stone-400 line-through"
                    : active
                      ? "text-sm font-medium text-stone-900"
                      : "text-sm text-stone-400"
                }
              >
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="mt-8 text-xs leading-relaxed text-stone-400">
        Les photos sont lues, le produit comparé aux annonces, puis la planche et les angles sont
        construits. Compte une trentaine de secondes.
      </p>
    </main>
  );
}
