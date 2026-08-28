import type { PolicyVerdict } from "@pv/shared";

const verdictStyles: Record<PolicyVerdict, string> = {
  ALLOW: "border-pass/40 bg-pass/10 text-pass",
  REVIEW: "border-review/40 bg-review/10 text-review",
  DENY: "border-fail/40 bg-fail/10 text-fail",
};

export function VerdictBadge({ verdict }: { verdict: PolicyVerdict }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold tracking-[0.12em] ${verdictStyles[verdict]}`}>
      {verdict}
    </span>
  );
}
