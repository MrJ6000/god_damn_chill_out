"use client";

import { usePathname, useRouter } from "next/navigation";
import { AnimatedIcon } from "@/components/AnimatedIcon";

const actions = [
  { icon: "receipt", label: "① 正常付款", morphTo: "check", path: "/" },
  { icon: "bot", label: "② AI 遭入侵", morphTo: "alert", path: "/decision/PI-8821" },
  { icon: "unlock", label: "③ 直接攻擊仍被擋下", morphTo: "shield", path: "/blast-radius" },
] as const;

export function DemoBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label="示範情境操作" className="fixed inset-x-0 top-0 z-50 min-w-[1180px] border-b border-line bg-[#0a0a0b]/95">
      <div className="mx-auto flex h-[72px] w-[1120px] items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <div className="group flex h-9 w-9 items-center justify-center rounded-lg border border-pass/40 bg-pass/10 text-pass">
            <AnimatedIcon className="h-6 w-6" morphTo="check" name="shield" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">示範情境操作</p>
            <p className="text-xs text-muted">模擬資料 · 一鍵切換情境</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actions.map((action) => {
            const active = action.path === "/"
              ? pathname === "/" || pathname === "/plan" || pathname.startsWith("/receipt")
              : pathname === action.path;

            return (
              <button
                key={action.label}
                className={`group inline-flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm font-semibold ${
                  active
                    ? "border-body bg-body text-ink"
                    : "border-line bg-surface text-muted hover:border-[#4b4b54] hover:text-body"
                }`}
                onClick={() => router.push(action.path)}
                type="button"
              >
                <AnimatedIcon active={active} className="h-4 w-4" morphTo={action.morphTo} name={action.icon} />
                {action.label}
              </button>
            );
          })}
          <button
            className="group ml-1 inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2.5 text-sm font-semibold text-muted hover:border-fail/60 hover:text-fail"
            onClick={() => router.push("/")}
            type="button"
          >
            <AnimatedIcon className="h-4 w-4" morphTo="home" name="reset" />
            重新開始
          </button>
        </div>
      </div>
    </nav>
  );
}
