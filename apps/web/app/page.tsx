"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AgentActivity } from "@/components/AgentActivity";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { StatCard } from "@/components/StatCard";
import { mockInvoices } from "@/lib/mockData";

const totalAmount = mockInvoices.reduce((total, invoice) => total + invoice.amount, 0);

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function TreasuryInboxPage() {
  const router = useRouter();
  const [isThinking, setIsThinking] = useState(false);
  const navigationTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (navigationTimer.current !== null) {
        window.clearTimeout(navigationTimer.current);
      }
    };
  }, []);

  function handleGeneratePlan() {
    if (isThinking) return;

    setIsThinking(true);
    navigationTimer.current = window.setTimeout(() => router.push("/plan"), 1000);
  }

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-start justify-between border-b border-line pb-8">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-[0.22em] text-pass">
              PolicyVault Sentinel
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-pass/30 bg-pass/10 px-3 py-1 text-xs font-semibold text-pass">
              <span className="h-2 w-2 rounded-full bg-pass" /> 運作中
            </span>
          </div>
          <h1 className="text-[44px] font-bold leading-tight tracking-[-0.03em]">待付款清單</h1>
          <p className="mt-3 text-lg text-muted">
            即使 AI 遭入侵，資金仍受安全規則保護。
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-5 py-4 text-right">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted">本次安全規則</p>
          <p className="mt-2 font-mono text-sm text-pass">V18 · 啟用中</p>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-5" aria-label="付款統計">
        <StatCard label="待付款" value={String(mockInvoices.length)} detail="本期應付帳單" />
        <StatCard label="待付總額" value={`$${formatAmount(totalAmount)}`} detail="申請支付的 USDC" />
      </section>

      <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold">今日待付款</h2>
            <p className="mt-1 text-sm text-muted">18 筆帳單等待安全規則檢查</p>
          </div>
          <span className="rounded-full border border-review/30 bg-review/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-review">
            待處理
          </span>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-[#101012] text-xs uppercase tracking-[0.12em] text-muted">
              <tr>
                <th className="px-6 py-3 font-semibold">帳單編號</th>
                <th className="px-4 py-3 font-semibold">廠商</th>
                <th className="px-4 py-3 font-semibold">收款地址</th>
                <th className="px-4 py-3 font-semibold">到期日</th>
                <th className="px-4 py-3 font-semibold">狀態</th>
                <th className="px-6 py-3 text-right font-semibold">金額</th>
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
                      待處理
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
        {isThinking ? (
          <AgentActivity
            className="flex-1"
            detail="即將進入安全規則檢查"
            label="AI 正在整理 18 筆付款提案"
            mode="thinking"
          />
        ) : (
          <>
            <div className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#202025] text-body">
              <AnimatedIcon className="h-6 w-6" morphTo="arrow-right" name="sparkles" />
            </div>
            <label className="sr-only" htmlFor="agent-instruction">AI 操作指令</label>
            <input
              id="agent-instruction"
              className="h-12 flex-1 rounded-xl border border-line bg-ink px-4 text-base text-body"
              defaultValue="處理今日已核准的付款。"
            />
          </>
        )}
        <button
          aria-busy={isThinking}
          aria-disabled={isThinking}
          className={`group inline-flex h-12 min-w-[174px] items-center justify-center gap-2 rounded-xl px-7 text-sm font-bold text-ink ${
            isThinking ? "cursor-wait bg-[#b9b9be]" : "bg-body hover:bg-white"
          }`}
          onClick={handleGeneratePlan}
          type="button"
        >
          {isThinking ? "正在整理…" : "產生付款計畫"}
          <AnimatedIcon active={isThinking} className="h-4 w-4" morphTo="check" name="arrow-right" />
        </button>
      </section>
    </main>
  );
}
