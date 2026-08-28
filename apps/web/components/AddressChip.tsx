"use client";

import { useState, type MouseEvent } from "react";

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AddressChip({ address, tone = "default" }: { address: string; tone?: "default" | "pass" | "fail" }) {
  const [copied, setCopied] = useState(false);
  const toneClass = tone === "pass" ? "text-pass" : tone === "fail" ? "text-fail" : "text-body";

  async function copyAddress(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      aria-label={`Copy address ${address}`}
      className={`inline-flex items-center gap-2 rounded-lg border border-line bg-ink px-3 py-1.5 font-mono text-sm ${toneClass}`}
      onClick={copyAddress}
      title={address}
      type="button"
    >
      {shortenAddress(address)}
      <span className="font-sans text-[10px] uppercase tracking-wider text-muted">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
