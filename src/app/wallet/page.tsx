"use client";

import { useCallback, useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";

interface Wallet {
  balanceXof: number;
  creditXof: number;
  remaining: number;
  minTopupXof: number;
  canLaunch: boolean;
}

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(n);

export default function WalletPage() {
  const { data: session, isPending } = authClient.useSession();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/wallet", { cache: "no-store" });
    if (!res.ok) return;
    setWallet((await res.json()) as Wallet);
  }, []);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function topUp(amountXof: number) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/topups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountXof, country: "CI" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Échec de l'initiation");
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      throw new Error("Aucune URL de paiement retournée");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setLoading(false);
    }
  }

  if (isPending) {
    return <Shell>Chargement…</Shell>;
  }

  if (!session) {
    return <AuthForm />;
  }

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">Wallet</p>

      <div className="mt-4 rounded-2xl bg-stone-900 p-6 text-white">
        <p className="text-sm text-stone-400">Solde</p>
        <p className="mt-1 text-3xl font-semibold">
          {wallet ? `${fmt(wallet.balanceXof)} FCFA` : "—"}
        </p>
        <p className="mt-3 text-sm text-stone-400">
          {wallet ? `${wallet.remaining} analyse${wallet.remaining > 1 ? "s" : ""} disponible${wallet.remaining > 1 ? "s" : ""}` : ""}
        </p>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-stone-600">
        Tes crédits ne sont débités qu&apos;à la livraison de tes kits. Une analyse échouée est
        intégralement restituée.
      </p>

      {wallet?.canLaunch && (
        <a
          href="/nouveau"
          className="mt-6 block w-full rounded-2xl bg-stone-900 px-5 py-4 text-center text-[15px] font-medium text-white"
        >
          Lancer une analyse
        </a>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={() => void topUp(wallet?.minTopupXof ?? 5000)}
        className={`w-full rounded-2xl px-5 py-4 text-[15px] font-medium disabled:opacity-50 ${
          wallet?.canLaunch
            ? "mt-3 border border-stone-300 text-stone-900"
            : "mt-6 bg-stone-900 text-white"
        }`}
      >
        {loading ? "Ouverture du paiement…" : `Recharger ${fmt(wallet?.minTopupXof ?? 5000)} FCFA`}
      </button>

      <p className="mt-2 text-center text-xs text-stone-500">
        Wave · Orange Money · MTN — validation sur ton téléphone
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-5 pb-16 pt-10">{children}</main>;
}

function AuthForm() {
  const [mode, setMode] = useState<"in" | "up">("up");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "up") {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0] ?? "Commerçant",
        });
        if (error) throw new Error(error.message);
        setMessage("Compte créé. Vérifie ton email pour l'activer.");
      } else {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) throw new Error(error.message);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Erreur inconnue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h1 className="text-2xl font-semibold">
        {mode === "up" ? "Créer un compte" : "Se connecter"}
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        Un email suffit. Pas de SMS, pas de carte à l&apos;inscription.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-stone-300 px-4 py-3 text-[15px]"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Mot de passe (8 caractères min.)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-stone-300 px-4 py-3 text-[15px]"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-2xl bg-stone-900 px-5 py-4 text-[15px] font-medium text-white disabled:opacity-50"
        >
          {busy ? "…" : mode === "up" ? "Créer mon compte" : "Se connecter"}
        </button>
      </form>

      {message && <p className="mt-4 text-sm text-stone-700">{message}</p>}

      <button
        type="button"
        onClick={() => setMode(mode === "up" ? "in" : "up")}
        className="mt-6 text-sm text-stone-500 underline"
      >
        {mode === "up" ? "J'ai déjà un compte" : "Créer un compte"}
      </button>
    </Shell>
  );
}
