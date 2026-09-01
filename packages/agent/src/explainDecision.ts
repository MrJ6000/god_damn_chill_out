import type {
  DenyReasonCode,
  PaymentIntent,
  PolicyDecision,
} from "@pv/shared";

const DENY_EXPLANATIONS: Record<
  DenyReasonCode,
  (intent: PaymentIntent) => string
> = {
  TOKEN_NOT_ALLOWED: (intent) =>
    `${intent.token} is not an authorized payment token.`,
  VENDOR_UNKNOWN: (intent) =>
    `${intent.vendor_name} is not a verified vendor in the policy registry.`,
  BENEFICIARY_MISMATCH: (intent) =>
    `The recipient address in this payment intent does not match the verified wallet on record for ${intent.vendor_name}. Only the verified vendor wallet is authorized.`,
  PER_TX_LIMIT_EXCEEDED: () =>
    "The payment exceeds the maximum amount allowed for a single transaction.",
  DAILY_LIMIT_EXCEEDED: () =>
    "The payment would exceed the permitted 24-hour spending limit.",
  SESSION_EXPIRED: () =>
    "The AI payment session has expired and can no longer authorize transfers.",
  DUPLICATE_PAYMENT: (intent) =>
    `Invoice ${intent.invoice_id} has already been paid or is still pending.`,
  POLICY_OVERRIDE_ATTEMPT: () =>
    "The request attempted to override a policy that the AI is not allowed to change.",
};

/** 只翻譯既有政策結論，不重新判斷、不呼叫模型，也不變更 verdict。 */
export async function explainDecision(
  intent: PaymentIntent,
  decision: PolicyDecision,
): Promise<string> {
  if (decision.verdict === "ALLOW") {
    return `Payment approved. ${intent.amount_display} ${intent.token} to ${intent.vendor_name} passed all checks under policy ${decision.policy_version}.`;
  }

  if (decision.verdict === "REVIEW") {
    return `Payment requires human review. ${intent.amount_display} ${intent.token} to ${intent.vendor_name} needs an authorized approver before execution. No funds were moved automatically.`;
  }

  const explanations = decision.deny_reasons.map((reason) =>
    DENY_EXPLANATIONS[reason](intent),
  );
  const details =
    explanations.length > 0
      ? explanations.join(" ")
      : `Policy ${decision.policy_version} did not authorize this payment.`;

  return `Payment blocked. ${details} No funds were moved.`;
}
