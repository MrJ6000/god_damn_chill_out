"use client";

import { useEffect, useState } from "react";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { useDemo } from "@/components/DemoProvider";
import { StatCard } from "@/components/StatCard";
import { mockBlastRadius } from "@/lib/mockData";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

function secondsUntil(expiresAt: string, fallback: number): number {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) ? Math.max(0, Math.floor((expires - Date.now()) / 1000)) : fallback;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours} 小時 ${String(minutes).padStart(2, "0")} 分 ${String(remainingSeconds).padStart(2, "0")} 秒`;
}

export default function BlastRadiusPage() {
  const { busy, hydrated, refreshBlastRadius, state } = useDemo();
  const scene = state.blastRadius;
  const blastRadius = scene?.data ?? mockBlastRadius;
  const [remainingSeconds, setRemainingSeconds] = useState(() => secondsUntil(blastRadius.session_expires_at, blastRadius.session_remaining_seconds));

  useEffect(() => {
    if (hydrated && !scene && !busy) void refreshBlastRadius();
  }, [busy, hydrated, refreshBlastRadius, scene]);

  useEffect(() => {
    if (!hydrated) return;
    const update = () => setRemainingSeconds(secondsUntil(blastRadius.session_expires_at, blastRadius.session_remaining_seconds));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [blastRadius.session_expires_at, blastRadius.session_remaining_seconds, hydrated]);

  if (!hydrated) {
    return <main className="mx-auto w-[1120px] px-8 py-24 text-center text-lg text-muted">正在還原風險範圍資料…</main>;
  }

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-4">
      <header className="flex items-center justify-between border-b border-fail/40 pb-7">
        <div>
          <div className="flex items-center gap-3"><p className="text-sm font-bold tracking-[0.2em] text-fail">DEMO SCENARIO · AI 已遭入侵</p><DataSourceBadge source={scene?.source ?? "mock"} /></div>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI 完全被攻破時的風險上限</h1>
          <p className="mt-2 text-lg text-muted">畫面忠實顯示 API 回傳的權限範圍與資料來源。</p>
        </div>
        <div className="rounded-xl border border-fail/40 bg-fail/10 px-5 py-4 text-right"><p className="text-xs font-bold tracking-[0.16em] text-fail">假設情境</p><p className="mt-2 text-sm text-body">AI 操作金鑰已完全外洩</p></div>
      </header>

      {scene?.notice ? <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review"><strong>備援資料：</strong> {scene.notice.message}</div> : null}

      <section aria-label="直接攻擊結果" className="mt-6 flex items-center justify-center gap-4 rounded-2xl border border-line bg-surface px-6 py-4 text-sm font-semibold">
        <span className="flex items-center gap-2 text-fail"><AnimatedIcon className="h-5 w-5" name="unlock" />未授權收款地址</span><AnimatedIcon className="h-4 w-4 text-muted" name="arrow-right" /><span className="flex items-center gap-2"><AnimatedIcon className="h-5 w-5" name="shield" />權限限制</span><AnimatedIcon className="h-4 w-4 text-muted" name="arrow-right" /><span className="flex items-center gap-2 text-pass"><AnimatedIcon className="h-5 w-5" name="check" />曝險上限 ${formatAmount(blastRadius.unauthorized_recipient_exposure)}</span>
      </section>

      <section className="mt-5 grid grid-cols-[1fr_300px] gap-5">
        <div className="rounded-2xl border border-pass/50 bg-pass/10 px-8 py-9 text-center"><p className="text-sm font-bold tracking-[0.22em] text-pass">未授權收款地址曝險</p><p className="mt-5 text-[112px] font-black leading-none tracking-[-0.07em] text-pass">${formatAmount(blastRadius.unauthorized_recipient_exposure)}</p><p className="mt-5 text-base text-muted">此數字的來源標示於頁面下方。</p></div>
        <div className="space-y-5">
          <div className="rounded-2xl border border-line bg-surface p-6"><p className="text-xs font-semibold tracking-[0.16em] text-muted">可收款廠商</p><p className="mt-3 text-[48px] font-bold leading-none">{blastRadius.authorized_recipient_count}</p><p className="mt-3 text-sm text-muted">僅限已驗證廠商</p></div>
          <div className="rounded-2xl border border-line bg-surface p-6"><p className="text-xs font-semibold tracking-[0.16em] text-muted">AI 可操作範圍</p><p className="mt-3 font-mono text-sm text-body">{blastRadius.allowed_tokens.join(", ")}</p><p className="mt-2 text-sm text-body">{blastRadius.allowed_actions.join(", ")}</p></div>
        </div>
      </section>

      <section className="mt-5 grid grid-cols-4 gap-5">
        <StatCard label="金庫餘額" value={`$${formatAmount(blastRadius.treasury_balance_display)}`} detail="API 回傳值" />
        <StatCard label="單筆上限" value={`$${formatAmount(blastRadius.max_per_tx_display)}`} detail="每筆交易" />
        <StatCard label="每日上限" value={`$${formatAmount(blastRadius.max_per_24h_display)}`} detail="24 小時" />
        <StatCard label="今日剩餘" value={`$${formatAmount(blastRadius.remaining_24h_display)}`} detail="僅限已驗證地址" tone="review" />
      </section>

      <section className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-5">
        <div><p className="text-xs font-semibold tracking-[0.16em] text-muted">本次權限剩餘時間</p><p className="mt-2 font-mono text-2xl font-semibold">{formatDuration(remainingSeconds)}</p></div>
        <div className="text-right"><p className="text-xs font-semibold tracking-[0.16em] text-muted">風險數字的領域資料來源</p><p className={`mt-2 inline-flex rounded-full border px-3 py-1 text-sm font-bold ${blastRadius.source === "onchain" ? "border-pass/40 bg-pass/10 text-pass" : "border-review/40 bg-review/10 text-review"}`}>● {blastRadius.source === "onchain" ? "ON-CHAIN" : "CACHED / CONFIGURED"}</p><p className="mt-2 text-[10px] text-muted">API 傳輸來源與鏈上資料來源分開標示</p></div>
      </section>
    </main>
  );
}
