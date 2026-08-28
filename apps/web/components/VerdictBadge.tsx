import type { PolicyVerdict } from "@pv/shared";
import { AnimatedIcon, type IconName } from "@/components/AnimatedIcon";

const verdictStyles: Record<PolicyVerdict, string> = {
  ALLOW: "border-pass/40 bg-pass/10 text-pass",
  REVIEW: "border-review/40 bg-review/10 text-review",
  DENY: "border-fail/40 bg-fail/10 text-fail",
};

const verdictLabels: Record<PolicyVerdict, string> = {
  ALLOW: "通過",
  REVIEW: "人工確認",
  DENY: "已攔截",
};

const verdictIcons: Record<PolicyVerdict, IconName> = {
  ALLOW: "check",
  REVIEW: "alert",
  DENY: "x",
};

export function VerdictBadge({ verdict }: { verdict: PolicyVerdict }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${verdictStyles[verdict]}`}>
      <AnimatedIcon className="h-3.5 w-3.5" name={verdictIcons[verdict]} />
      {verdictLabels[verdict]}
    </span>
  );
}
