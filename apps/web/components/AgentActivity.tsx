interface AgentActivityProps {
  className?: string;
  detail: string;
  label: string;
  mode: "executing" | "thinking";
}

export function AgentActivity({ className = "", detail, label, mode }: AgentActivityProps) {
  const isThinking = mode === "thinking";

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={`agent-activity flex min-h-14 items-center gap-4 overflow-hidden rounded-xl border bg-[#101012] px-4 py-3 ${
        isThinking ? "border-body/20" : "border-pass/30"
      } ${className}`}
      role="status"
    >
      {isThinking ? (
        <span aria-hidden="true" className="agent-orb shrink-0">
          <span className="agent-orb__ring" />
          <span className="agent-orb__core" />
        </span>
      ) : (
        <span aria-hidden="true" className="agent-flow shrink-0" />
      )}

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-body">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{detail}</span>
      </span>

      <span
        className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] ${
          isThinking
            ? "border-body/20 bg-body/5 text-body"
            : "border-pass/30 bg-pass/10 text-pass"
        }`}
      >
        {isThinking ? "AI 思考中" : "處理中"}
      </span>
    </div>
  );
}
