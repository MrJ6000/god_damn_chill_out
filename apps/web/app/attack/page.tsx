"use client";

import { useRouter } from "next/navigation";
import { AddressChip } from "@/components/AddressChip";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { DataSourceBadge } from "@/components/DataSourceBadge";
import { useDemo } from "@/components/DemoProvider";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("zh-TW").format(value);
}

export default function DirectAttackPage() {
  const router = useRouter();
  const { busy, hydrated, runDirectBypassDemo, state } = useDemo();
  const attack = state.attack;

  if (!hydrated) {
    return <main className="mx-auto w-[1120px] px-8 py-24 text-center text-lg text-muted">正在還原直接攻擊情境…</main>;
  }

  if (!attack) {
    return (
      <main className="mx-auto w-[1120px] px-8 py-24 text-center">
        <p className="text-sm font-bold tracking-[0.2em] text-fail">DIRECT BYPASS DEMO</p>
        <h1 className="mt-4 text-[48px] font-bold">尚未送出直接攻擊請求</h1>
        <p className="mx-auto mt-4 max-w-[680px] text-lg leading-8 text-muted">此頁不會在載入時自動發送有副作用的 API。請明確按下按鈕後，才會呼叫 direct-bypass endpoint。</p>
        <button aria-busy={busy} disabled={busy} className="mt-8 rounded-xl bg-fail px-7 py-3.5 font-bold text-white disabled:opacity-60" onClick={() => void runDirectBypassDemo()} type="button">{busy ? "正在送出…" : "執行直接攻擊示範"}</button>
      </main>
    );
  }

  const { execution } = attack;
  const hasChainEvidence = Boolean(execution.tx_hash || execution.user_op_hash || execution.block_number || execution.explorer_url);
  const onchainRejected = attack.source === "api" && execution.status === "REJECTED" && hasChainEvidence && execution.error_code !== "MOCK_CHAIN";
  const mockMode = attack.source === "mock" || execution.error_code === "MOCK_CHAIN";
  const executed = execution.status === "EXECUTED";
  const pending = execution.status === "PENDING";
  const apiSkipped = attack.source === "api" && execution.status === "SKIPPED" && !mockMode;
  const confirmedNoLoss = onchainRejected || apiSkipped;
  const simulatedNoLoss = mockMode;
  const noLoss = confirmedNoLoss || simulatedNoLoss;
  const resultLabel = executed ? "EXECUTED — 安全異常" : pending ? "PENDING — 結果未定" : onchainRejected ? "REJECTED" : mockMode ? "NOT SUBMITTED" : `${execution.status} — 尚無鏈上證據`;
  const rejectedBy = onchainRejected ? "ON-CHAIN EVIDENCE" : mockMode ? (attack.source === "api" ? "API MOCK MODE" : "FRONTEND FALLBACK") : hasChainEvidence ? "CHAIN RESULT" : "NO CHAIN EVIDENCE";
  const fundsLost = executed ? `$${formatAmount(attack.amountDisplay)}` : noLoss ? "$0" : "未知";
  const resultTone = executed ? "text-fail" : simulatedNoLoss || pending || !confirmedNoLoss ? "text-review" : "text-pass";
  const outcomeTone = executed ? "border-fail/50 bg-fail/10" : simulatedNoLoss || pending || !confirmedNoLoss ? "border-review/50 bg-review/10" : "border-pass/50 bg-pass/10";
  const amountTone = executed ? "text-fail" : simulatedNoLoss || pending || !confirmedNoLoss ? "text-review" : "text-pass";

  return (
    <main className="mx-auto w-[1120px] px-8 pb-16 pt-4">
      <header className="flex items-center justify-between border-b border-fail/50 pb-7">
        <div>
          <div className="flex items-center gap-3"><p className="text-sm font-bold tracking-[0.2em] text-fail">DEMO SCENARIO · DIRECT BYPASS</p><DataSourceBadge source={attack.source} /></div>
          <h1 className="mt-3 text-[44px] font-bold tracking-[-0.03em]">AI 金鑰遭竊後的直接攻擊</h1>
          <p className="mt-2 text-lg text-muted">結果完全依 API 狀態與證據呈現，不把 HTTP 失敗或 mock 說成鏈上拒絕。</p>
        </div>
        <div className="rounded-xl border border-fail/40 bg-fail/10 px-5 py-4 text-right"><p className="text-xs font-bold tracking-[0.16em] text-fail">假設情境</p><p className="mt-2 text-sm text-body">AI COMPROMISED · SESSION ACTIVE</p></div>
      </header>

      {attack.notice ? <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review"><strong>備援情境：</strong> {attack.notice.message} 本次沒有取得鏈上拒絕證據。</div> : null}
      {execution.error_code === "MOCK_CHAIN" && attack.source === "api" ? <div className="mt-5 rounded-xl border border-review/40 bg-review/10 px-5 py-3 text-sm text-review"><strong>API MOCK MODE：</strong> API 已回應，但明確表示沒有送出鏈上交易。</div> : null}

      <section className="mt-7 grid grid-cols-[1fr_360px] gap-6">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-6 py-5"><p className="text-xs font-bold tracking-[0.16em] text-muted">ATTACKER REQUEST</p><p className="mt-3 text-[40px] font-bold">{formatAmount(attack.amountDisplay)} USDC</p><div className="mt-3"><AddressChip address={attack.recipient} tone="fail" /></div></div>
          <dl className="grid grid-cols-[190px_1fr] text-sm">
            <dt className="border-b border-r border-line px-5 py-4 text-muted">RESULT</dt><dd className={`border-b border-line px-5 py-4 font-bold ${resultTone}`}>{resultLabel}</dd>
            <dt className="border-b border-r border-line px-5 py-4 text-muted">RESULT SOURCE</dt><dd className="border-b border-line px-5 py-4 font-mono">{rejectedBy}</dd>
            <dt className="border-b border-r border-line px-5 py-4 text-muted">ERROR CODE</dt><dd className="border-b border-line px-5 py-4 font-mono">{execution.error_code ?? "—"}</dd>
            <dt className="border-b border-r border-line px-5 py-4 text-muted">TX / USER OP</dt><dd className="border-b border-line px-5 py-4 font-mono text-xs">{execution.tx_hash ?? execution.user_op_hash ?? "未提供"}</dd>
            <dt className="border-r border-line px-5 py-4 text-muted">DETAIL</dt><dd className="px-5 py-4 text-muted">{execution.error_message || "API 未提供補充訊息。"}</dd>
          </dl>
        </div>

        <div className={`flex flex-col justify-between rounded-2xl border p-7 text-center ${outcomeTone}`}>
          <div><p className="text-xs font-bold tracking-[0.2em] text-muted">{simulatedNoLoss ? "CACHED DEMO · FUNDS LOST" : "FUNDS LOST"}</p><p className={`mt-6 text-[96px] font-black leading-none tracking-[-0.07em] ${amountTone}`}>{fundsLost}</p><p className="mt-5 text-sm leading-6 text-muted">{onchainRejected ? "鏈上證據顯示攻擊遭拒。" : mockMode ? "這是明示的 mock／備援示意 $0，不是鏈上安全證明。" : apiSkipped ? "API 明確表示沒有送出交易。" : pending ? "交易已廣播但尚未有最終結果。" : executed ? "警告：API 顯示未授權交易已執行。" : "依 API 回傳狀態顯示。"}</p></div>
          <div className="mt-8 space-y-3">
            {execution.explorer_url ? <a className="block rounded-xl border border-pass/40 bg-pass/10 px-4 py-3 font-semibold text-pass" href={execution.explorer_url} rel="noreferrer" target="_blank">查看鏈上證據 ↗</a> : null}
            <button className="group inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-3 font-semibold" onClick={() => router.push("/blast-radius")} type="button"><AnimatedIcon className="h-4 w-4" name="shield" />查看 Blast Radius</button>
          </div>
        </div>
      </section>
    </main>
  );
}
