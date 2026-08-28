"use client";

import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { StatCard } from "@/components/StatCard";
import { mockInvoices } from "@/lib/mockData";

const totalAmount = mockInvoices.reduce((total, invoice) => total + invoice.amount, 0);

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function TreasuryInboxPage() {
  const router = useRouter();

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-start justify-between border-b border-line pb-8">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-[0.22em] text-pass">
              PolicyVault Sentinel
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-pass/30 bg-pass/10 px-3 py-1 text-xs font-semibold text-pass">
              <span className="h-2 w-2 rounded-full bg-pass" /> Live
            </span>
          </div>
          <h1 className="text-[44px] font-bold leading-tight tracking-[-0.03em]">Treasury Inbox</h1>
          <p className="mt-3 text-lg text-muted">
            Assume the AI is compromised. Prove the money is still safe.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-5 py-4 text-right">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Session policy</p>
          <p className="mt-2 font-mono text-sm text-body">V18 · ACTIVE</p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-5" aria-label="Payment totals">
        <StatCard label="Pending payments" value={String(mockInvoices.length)} detail="Due this cycle" />
        <StatCard label="Total value" value={`$${formatAmount(totalAmount)}`} detail="USDC requested" />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold">Today&apos;s payments</h2>
            <p className="mt-1 text-sm text-muted">18 invoices awaiting policy evaluation</p>
          </div>
          <span className="rounded-full border border-review/30 bg-review/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-review">
            Pending
          </span>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-[#101012] text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th className="px-6 py-3 font-semibold">Invoice</th>
                <th className="px-4 py-3 font-semibold">Vendor</th>
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold">Due</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-6 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {mockInvoices.map((invoice) => (
                <tr key={invoice.invoice_id} className="border-t border-line/70">
                  <td className="px-6 py-4 font-mono text-sm text-body">{invoice.invoice_id}</td>
                  <td className="px-4 py-4 font-medium">{invoice.vendor}</td>
                  <td className="px-4 py-4"><AddressChip address={invoice.payment_address} /></td>
                  <td className="px-4 py-4 text-sm text-muted">{invoice.due_date}</td>
                  <td className="px-4 py-4">
                    <span className="rounded-full border border-review/30 bg-review/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-review">
                      PENDING
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right font-mono font-semibold">
                    {formatAmount(invoice.amount)} USDC
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#202025] text-xl">✦</div>
        <label className="sr-only" htmlFor="agent-instruction">Agent instruction</label>
        <input
          id="agent-instruction"
          className="h-12 flex-1 rounded-xl border border-line bg-ink px-4 text-base text-body"
          defaultValue="Process today's approved payments."
        />
        <button
          className="h-12 rounded-xl bg-body px-7 text-sm font-bold text-ink hover:bg-white"
          onClick={() => router.push("/plan")}
          type="button"
        >
          Run Agent →
        </button>
      </section>
    </main>
  );
}
