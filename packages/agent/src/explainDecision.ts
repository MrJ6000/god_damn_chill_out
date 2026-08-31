import type { PaymentIntent, PolicyDecision } from "@pv/shared";

/** Day 1 mock：只翻譯既有政策結論，不重新判斷或變更 verdict。 */
export async function explainDecision(
  intent: PaymentIntent,
  decision: PolicyDecision,
): Promise<string> {
  if (decision.verdict === "ALLOW") {
    return `Payment approved. ${intent.amount_display} ${intent.token} to ${intent.vendor_name} passed policy ${decision.policy_version}.`;
  }

  if (decision.verdict === "REVIEW") {
    return `Payment requires human review. ${intent.amount_display} ${intent.token} to ${intent.vendor_name} was not executed automatically.`;
  }

  const reasons = decision.deny_reasons.join(", ") || "POLICY_DENIED";
  return `Payment blocked. Policy ${decision.policy_version} denied the payment to ${intent.vendor_name}: ${reasons}. No funds were moved.`;
}
