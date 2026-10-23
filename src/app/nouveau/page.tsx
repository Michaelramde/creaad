"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Card, Kicker } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { compressImage, formatBytes, type CompressedImage } from "@/lib/client/image";

const CATEGORIES = [
  { id: "beaute", label: "Beauté" },
  { id: "cheveux", label: "Cheveux" },
  { id: "mode", label: "Mode" },
  { id: "gadgets", label: "Gadgets" },
] as const;

const REGIMES = [
  { id: "detenu", label: "J'ai le produit en main" },
  { id: "non_detenu", label: "Je ne l'ai pas encore" },
] as const;

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

export default function NewAnalysisPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  const [category, setCategory] = useState<string>("beaute");
  const [regime, setRegime] = useState<string>("non_detenu");
  const [country, setCountry] = useState("CI");
  const [userText, setUserText] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [images, setImages] = useState<CompressedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsTopup, setNeedsTopup] = useState(false);

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
      setError("Ajoute au moins une photo du produit.");
      return;
    }
    setBusy(true);
    setError(null);
    setNeedsTopup(false);
    try {
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          regime,
          country,
          imageUrls: images.map((i) => i.dataUrl),
          variantLabel: variantLabel.trim() || undefined,
          userText: userText.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (res.status === 402) {
        setNeedsTopup(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "L'analyse a échoué.");

      router.push(`/analyses/${data.analysisId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue.");
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <Shell><p className="text-sm text-stone-500">Chargement…</p></Shell>;

  if (!session) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Connecte-toi d&apos;abord</h1>
        <p className="mt-2 text-sm text-stone-600">
          Un email suffit. Pas de SMS, pas de carte.
        </p>
        <Link
          href="/wallet"
          className="mt-6 block rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white"
        >
          Créer mon compte
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <Kicker>Nouvelle analyse</Kicker>
      <h1 className="mt-1 text-xl font-semibold">Photographie ton produit</h1>
      <p className="mt-1 text-sm leading-relaxed text-stone-600">
        {MAX_PHOTOS} photos maximum. Les images sont compressées sur ton téléphone avant
        l&apos;envoi.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2">
        {images.map((image, index) => (
          <div key={index} className="relative overflow-hidden rounded-xl border border-stone-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.dataUrl} alt={`Photo ${index + 1}`} className="aspect-square w-full object-cover" />
            <button
              type="button"
              onClick={() => setImages((prev) => prev.filter((_, i) => i !== index))}
              className="absolute right-1 top-1 rounded-full bg-stone-900/80 px-1.5 py-0.5 text-[10px] text-white"
              aria-label="Retirer cette photo"
            >
              ✕
            </button>
            <span className="absolute bottom-1 left-1 rounded bg-stone-900/70 px-1 text-[9px] text-white">
              {formatBytes(image.bytes)}
            </span>
          </div>
        ))}

        {images.length < MAX_PHOTOS && (
          <label className="flex aspect-square cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-stone-300 text-center text-[11px] text-stone-500">
            <span className="text-xl leading-none">+</span>
            <span className="mt-1 px-1">Ajouter</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
          </label>
        )}
      </div>

      <p className="mt-2 text-[11px] text-stone-400">
        En démonstration, les photos restent sur cet appareil et ne sont pas stockées.
      </p>

      <div className="mt-6 space-y-4">
        <Field label="Catégorie">
          <Chips options={CATEGORIES} value={category} onChange={setCategory} />
        </Field>

        <Field label="Le produit">
          <Chips options={REGIMES} value={regime} onChange={setRegime} />
        </Field>

        <Field label="Marché visé">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm"
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Nom du produit (optionnel)">
          <input
            value={userText}
            onChange={(e) => setUserText(e.target.value)}
            placeholder="Sérum vitamine C 30 ml"
            className="w-full rounded-xl border border-stone-300 px-3 py-3 text-sm"
          />
        </Field>

        <Field label="Variante (optionnel)">
          <input
            value={variantLabel}
            onChange={(e) => setVariantLabel(e.target.value)}
            placeholder="Jaune, 30 ml"
            className="w-full rounded-xl border border-stone-300 px-3 py-3 text-sm"
          />
          <p className="mt-1 text-[11px] text-stone-400">
            Une seule variante par analyse : c&apos;est ce qui garantit la fidélité de la planche.
          </p>
        </Field>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {needsTopup && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium">Solde insuffisant</p>
          <p className="mt-1 text-xs text-stone-700">
            Une analyse coûte 1 crédit. Recharge ton wallet pour lancer celle-ci.
          </p>
          <Link href="/wallet" className="mt-2 inline-block text-xs font-medium underline">
            Recharger
          </Link>
        </Card>
      )}

      <button
        type="button"
        disabled={busy || images.length === 0}
        onClick={() => void submit()}
        className="mt-6 w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white disabled:opacity-40"
      >
        {busy ? "Identification en cours…" : "Lancer l'analyse"}
      </button>

      <p className="mt-2 text-center text-[11px] text-stone-500">
        Le crédit n&apos;est débité qu&apos;à la livraison des kits.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-5 pb-16 pt-10">{children}</main>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-stone-700">{label}</p>
      {children}
    </div>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition ${
            value === option.id
              ? "bg-stone-900 text-white ring-stone-900"
              : "bg-white text-stone-600 ring-stone-300"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
