"use client";

import { useState } from "react";

/** Bouton de copie — indispensable pour emporter un kit dans un autre outil. */
export function CopyButton({ text, label = "Copier" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 active:scale-[0.98]"
    >
      {copied ? "Copié ✓" : label}
    </button>
  );
}
