"use client";

import { usePathname, useRouter } from "next/navigation";

const actions = [
  { label: "① Normal Payment", path: "/" },
  { label: "② Compromised AI", path: "/decision/PI-8821" },
  { label: "③ Direct Bypass", path: "/blast-radius" },
] as const;

export function DemoBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label="Demo controls" className="fixed inset-x-0 top-0 z-50 min-w-[1180px] border-b border-line bg-[#0a0a0b]/95">
      <div className="mx-auto flex h-[72px] w-[1120px] items-center justify-between px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-pass/40 bg-pass/10 font-mono text-sm font-bold text-pass">PV</div>
          <div>
            <p className="text-sm font-bold tracking-wide">DEMO CONTROL</p>
            <p className="text-xs text-muted">Mock data · one-click navigation</p>
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
                className={`rounded-lg border px-4 py-2.5 text-sm font-semibold ${
                  active
                    ? "border-body bg-body text-ink"
                    : "border-line bg-surface text-muted hover:border-[#4b4b54] hover:text-body"
                }`}
                onClick={() => router.push(action.path)}
                type="button"
              >
                {action.label}
              </button>
            );
          })}
          <button
            className="ml-2 rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-muted hover:border-fail/60 hover:text-fail"
            onClick={() => router.push("/")}
            type="button"
          >
            Reset
          </button>
        </div>
      </div>
    </nav>
  );
}
