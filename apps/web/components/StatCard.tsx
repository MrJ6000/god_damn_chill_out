type Tone = "default" | "pass" | "fail" | "review";

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  tone?: Tone;
}

const toneClasses: Record<Tone, string> = {
  default: "text-body",
  pass: "text-pass",
  fail: "text-fail",
  review: "text-review",
};

export function StatCard({ label, value, detail, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">{label}</p>
      <p className={`mt-3 text-[48px] font-bold leading-none tracking-[-0.04em] ${toneClasses[tone]}`}>{value}</p>
      {detail ? <p className="mt-3 text-sm text-muted">{detail}</p> : null}
    </div>
  );
}
