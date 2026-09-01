import type { DemoProvenance } from "@/lib/demoWorkflow";

const sourceStyles: Record<DemoProvenance, string> = {
  api: "border-pass/40 bg-pass/10 text-pass",
  mixed: "border-review/40 bg-review/10 text-review",
  mock: "border-review/40 bg-review/10 text-review",
};

const sourceLabels: Record<DemoProvenance, string> = {
  api: "API 回應",
  mixed: "API＋備援混合",
  mock: "前端備援資料",
};

export function DataSourceBadge({ source }: { source: DemoProvenance }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.12em] ${sourceStyles[source]}`}>
      {sourceLabels[source]}
    </span>
  );
}
