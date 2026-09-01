"use client";

import { usePathname } from "next/navigation";
import { AnimatedIcon } from "@/components/AnimatedIcon";
import { useDemo } from "@/components/DemoProvider";

export function DemoBar() {
  const pathname = usePathname();
  const {
    busy,
    error,
    latestNotice,
    phase,
    resetDemo,
    runCompromisedDemo,
    runDirectBypassDemo,
    runNormalDemo,
  } = useDemo();

  const actions = [
    {
      active: pathname === "/" || pathname === "/plan" || pathname.startsWith("/receipt"),
      icon: "receipt" as const,
      label: "① 正常付款",
      morphTo: "check" as const,
      run: runNormalDemo,
    },
    {
      active: pathname.startsWith("/decision"),
      icon: "bot" as const,
      label: "② AI 遭入侵",
      morphTo: "alert" as const,
      run: runCompromisedDemo,
    },
    {
      active: pathname === "/attack",
      icon: "unlock" as const,
      label: "③ 直接攻擊",
      morphTo: "shield" as const,
      run: runDirectBypassDemo,
    },
  ];

  const statusText = error
    ? error
    : latestNotice
      ? `${latestNotice.message} · ${latestNotice.code}`
      : phase;

  return (
    <nav aria-label="示範情境操作" className="fixed inset-x-0 top-0 z-50 min-w-[1180px] border-b border-line bg-[#0a0a0b]/95">
      <div className="mx-auto flex h-[72px] w-[1120px] items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <div className="group flex h-9 w-9 items-center justify-center rounded-lg border border-pass/40 bg-pass/10 text-pass">
            <AnimatedIcon active={busy} className="h-6 w-6" morphTo="check" name="shield" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">示範情境操作</p>
            <p className="text-xs text-muted">每個按鈕都會實際呼叫 API；失敗時明示備援</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actions.map((action) => (
            <button
              aria-busy={busy}
              disabled={busy}
              key={action.label}
              className={`group inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold disabled:cursor-wait disabled:opacity-60 ${
                action.active
                  ? "border-body bg-body text-ink"
                  : "border-line bg-surface text-muted hover:border-[#4b4b54] hover:text-body"
              }`}
              onClick={() => void action.run()}
              type="button"
            >
              <AnimatedIcon active={busy || action.active} className="h-4 w-4" morphTo={action.morphTo} name={action.icon} />
              {action.label}
            </button>
          ))}
          <button
            disabled={busy}
            className="group ml-1 inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2.5 text-sm font-semibold text-muted hover:border-fail/60 hover:text-fail disabled:cursor-not-allowed disabled:opacity-50"
            onClick={resetDemo}
            type="button"
          >
            <AnimatedIcon className="h-4 w-4" morphTo="home" name="reset" />
            重設畫面
          </button>
        </div>
      </div>
      <div
        aria-live="polite"
        className={`mx-auto flex h-8 w-[1056px] items-center justify-between border-t px-1 text-xs ${
          error ? "border-fail/40 text-fail" : latestNotice ? "border-review/40 text-review" : "border-line text-muted"
        }`}
        role="status"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? "animate-pulse bg-review" : error ? "bg-fail" : latestNotice ? "bg-review" : "bg-pass"}`} />
          <span className="truncate">{statusText}</span>
        </span>
        <span className="ml-4 shrink-0">重設只會清除前端畫面，不會刪除後端付款紀錄</span>
      </div>
    </nav>
  );
}
