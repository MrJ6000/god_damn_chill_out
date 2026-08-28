"use client";

import { useEffect, useState } from "react";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { StatCard } from "@/components/StatCard";
import { mockBlastRadius } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours} 小時 ${String(minutes).padStart(2, "0")} 分 ${String(remainingSeconds).padStart(2, "0")} 秒`;
}

export default function BlastRadiusPage() {
  const [remainingSeconds, setRemainingSeconds] = useState(mockBlastRadius.session_remaining_seconds);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-10">
      <header className="flex items-center justify-between border-b border-fail/40 pb-7">
        <div>
          <p className="text-sm font-bold tracking-[0.2em] text-fail">AI 狀態 · 已遭入侵</p>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">最壞情況：AI 完全被攻破</h1>
          <p className="mt-2 text-lg text-muted">攻擊者直接呼叫智慧帳戶，合約仍會拒絕未授權地址。</p>
        </div>
        <div className="rounded-xl border border-fail/40 bg-fail/10 px-5 py-4 text-right">
          <p className="text-xs font-bold tracking-[0.16em] text-fail">最壞情境</p>
          <p className="mt-2 text-sm text-body">AI 操作金鑰已完全外洩</p>
        </div>
      </header>

      <section aria-label="直接攻擊結果" className="mt-6 flex items-center justify-center gap-4 rounded-2xl border border-line bg-surface px-6 py-4 text-sm font-semibold">
        <span className="flex items-center gap-2 text-fail"><AnimatedIcon className="h-5 w-5" name="unlock" />直接攻擊</span>
        <AnimatedIcon className="h-4 w-4 text-muted" name="arrow-right" />
        <span className="flex items-center gap-2"><AnimatedIcon className="h-5 w-5" name="shield" />合約強制檢查</span>
        <AnimatedIcon className="h-4 w-4 text-muted" name="arrow-right" />
        <span className="flex items-center gap-2 text-pass"><AnimatedIcon className="h-5 w-5" name="check" />攻擊者可得 $0</span>
      </section>

      <section className="mt-5 grid grid-cols-[1fr_300px] gap-5">
        <div className="rounded-2xl border border-pass/50 bg-pass/10 px-8 py-9 text-center">
          <p className="text-sm font-bold tracking-[0.22em] text-pass">攻擊者最多能偷走</p>
          <p className="mt-5 text-[112px] font-black leading-none tracking-[-0.07em] text-pass">
            ${formatAmount(mockBlastRadius.unauthorized_recipient_exposure)}
          </p>
          <p className="mt-5 text-base text-muted">非白名單地址無法收到任何資金。</p>
        </div>

        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted">可收款廠商</p>
            <p className="mt-3 text-[48px] font-bold leading-none">{mockBlastRadius.authorized_recipient_count}</p>
            <p className="mt-3 text-sm text-muted">僅限已驗證廠商</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-xs font-semibold tracking-[0.16em] text-muted">AI 可操作範圍</p>
            <p className="mt-3 font-mono text-sm text-body">{mockBlastRadius.allowed_tokens.join(", ")}</p>
            <p className="mt-2 text-sm text-body">僅可執行 USDC 轉帳</p>
          </div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-3 gap-5">
        <StatCard label="金庫餘額" value={`$${formatAmount(mockBlastRadius.treasury_balance_display)}`} detail="扣除已核准付款後" />
        <StatCard label="單筆付款上限" value={`$${formatAmount(mockBlastRadius.max_per_tx_display)}`} detail="無法繞過的權限上限" />
        <StatCard label="合規廠商今日仍可支付" value={`$${formatAmount(mockBlastRadius.remaining_24h_display)}`} detail="僅限已驗證收款地址" tone="review" />
      </section>

      <section className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-5">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted">本次權限剩餘時間</p>
          <p className="mt-2 font-mono text-2xl font-semibold">{formatDuration(remainingSeconds)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted">權限資料來源</p>
          <p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-bold ${mockBlastRadius.source === "onchain" ? "border-pass/40 bg-pass/10 text-pass" : "border-review/40 bg-review/10 text-review"}`}>
            ● {mockBlastRadius.source === "onchain" ? "鏈上即時資料" : "快取備援資料"}
          </p>
        </div>
      </section>
    </main>
  );
}
