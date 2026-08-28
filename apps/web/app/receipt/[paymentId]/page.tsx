"use client";

import { useParams } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { VerdictBadge } from "@/components/VerdictBadge";
import { findMockReceipt } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function PolicyReceiptPage() {
  const { paymentId } = useParams<{ paymentId: string }>();
  const receipt = findMockReceipt(paymentId);
  const denied = receipt.policy_verdict === "DENY";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-center justify-between border-b border-line pb-7">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-pass">Immutable audit trail</p>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">Policy Receipt</h1>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold">{receipt.payment_id}</p>
          <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted">Mock receipt</p>
        </div>
      </header>

      <section className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <p className="text-sm text-muted">Invoice {receipt.invoice_id}</p>
            <h2 className="mt-1 text-2xl font-semibold">{receipt.vendor_name}</h2>
          </div>
          <VerdictBadge verdict={receipt.policy_verdict} />
        </div>

        <dl className="grid grid-cols-2">
          <div className="border-b border-r border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Input hash</dt>
            <dd className="mt-2 font-mono text-base">{receipt.input_hash}</dd>
          </div>
          <div className="border-b border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Amount</dt>
            <dd className="mt-2 font-mono text-base font-semibold">{formatAmount(receipt.amount_display)} USDC</dd>
          </div>
          <div className="border-b border-r border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Verified recipient</dt>
            <dd className="mt-2"><AddressChip address={receipt.verified_recipient} tone="pass" /></dd>
          </div>
          <div className="border-b border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Agent proposed</dt>
            <dd className="mt-2"><AddressChip address={receipt.agent_proposed_recipient} tone={denied ? "fail" : "default"} /></dd>
          </div>
          <div className="border-b border-r border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Policy version</dt>
            <dd className="mt-2 font-mono text-base">{receipt.policy_version}</dd>
          </div>
          <div className="border-b border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Session permission</dt>
            <dd className="mt-2 font-mono text-base">{receipt.session_permission_id}</dd>
          </div>
          <div className="border-r border-line px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Human approval</dt>
            <dd className="mt-2 text-base font-semibold">{receipt.human_approval.replaceAll("_", " ")}</dd>
          </div>
          <div className="px-6 py-5">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Transaction</dt>
            <dd className="mt-2 flex items-center gap-3">
              <span className="font-mono text-sm">{receipt.execution?.tx_hash ? `${receipt.execution.tx_hash.slice(0, 8)}…${receipt.execution.tx_hash.slice(-4)}` : "NOT SUBMITTED"}</span>
              {receipt.execution?.explorer_url ? (
                <a className="text-sm font-semibold text-pass underline underline-offset-4" href={receipt.execution.explorer_url} rel="noreferrer" target="_blank">View ↗</a>
              ) : (
                <span className="rounded border border-review/30 bg-review/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-review">Mock only</span>
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className={`mt-6 rounded-2xl border p-7 text-center ${denied ? "border-fail/50 bg-fail/10" : "border-pass/40 bg-pass/10"}`}>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Funds moved</p>
        <p className={`mt-2 text-[96px] font-black leading-none tracking-[-0.06em] ${denied ? "text-fail" : "text-pass"}`}>
          ${formatAmount(receipt.funds_moved_display)}
        </p>
      </section>
    </main>
  );
}
