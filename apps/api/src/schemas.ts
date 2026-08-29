import { z } from "zod";
import { toRawAmount } from "@pv/shared";

const MAX_SAFE_USDC_DISPLAY = Math.floor(Number.MAX_SAFE_INTEGER / 1_000_000);
const usdcDisplayAmountSchema = z
  .number()
  .finite()
  .positive()
  .max(MAX_SAFE_USDC_DISPLAY)
  .refine(
    (amount) =>
      Math.abs(amount * 1_000_000 - Math.round(amount * 1_000_000)) < 1e-6,
    "USDC amounts support at most 6 decimal places.",
  );

export const invoiceSchema = z.object({
  invoice_id: z.string().trim().min(1),
  vendor: z.string().trim().min(1),
  amount: usdcDisplayAmountSchema,
  currency: z.literal("USDC"),
  payment_address: z.string().trim().min(1),
  memo: z.string().optional(),
  description: z.string().optional(),
  due_date: z.string().optional(),
  approved_by: z.string().optional(),
});

export const paymentIntentSchema = z
  .object({
    intent_id: z.string().trim().min(1),
    invoice_id: z.string().trim().min(1),
    vendor_name: z.string().trim().min(1),
    recipient: z.string().trim().min(1),
    amount_display: usdcDisplayAmountSchema,
    amount_raw: z.string().regex(/^\d+$/),
    token: z.literal("USDC"),
    action: z.literal("transfer"),
    reasoning: z.string(),
    created_at: z.string().datetime({ offset: true }),
  })
  .superRefine((intent, context) => {
    if (intent.amount_raw !== toRawAmount(intent.amount_display)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount_raw"],
        message: "amount_raw must equal amount_display in USDC base units.",
      });
    }
  });

const policyCheckIdSchema = z.enum([
  "TOKEN_ALLOWED",
  "VENDOR_KNOWN",
  "BENEFICIARY_MATCH",
  "PER_TX_LIMIT",
  "DAILY_LIMIT",
  "SESSION_VALID",
  "DUPLICATE_PAYMENT",
  "APPROVAL_REQUIRED",
]);

const denyReasonSchema = z.enum([
  "TOKEN_NOT_ALLOWED",
  "VENDOR_UNKNOWN",
  "BENEFICIARY_MISMATCH",
  "PER_TX_LIMIT_EXCEEDED",
  "DAILY_LIMIT_EXCEEDED",
  "SESSION_EXPIRED",
  "DUPLICATE_PAYMENT",
  "POLICY_OVERRIDE_ATTEMPT",
]);

export const policyDecisionSchema = z.object({
  intent_id: z.string().trim().min(1),
  verdict: z.enum(["ALLOW", "REVIEW", "DENY"]),
  checks: z
    .array(
      z.object({
        id: policyCheckIdSchema,
        status: z.enum(["PASS", "FAIL", "WARN", "NA"]),
        detail: z.string(),
      }),
    )
    .length(8),
  deny_reasons: z.array(denyReasonSchema),
  policy_version: z.string().trim().min(1),
  evaluated_at: z.string().datetime({ offset: true }),
  latency_ms: z.number().finite().nonnegative(),
});

export const agentPlanBodySchema = z.object({
  instruction: z.string().trim().min(1),
  invoices: z.array(invoiceSchema).min(1),
});

export const agentPlanResultSchema = z.object({
  intents: z.array(paymentIntentSchema),
  agent_message: z.string(),
});

export const policyEvaluateBodySchema = z.object({
  intent: paymentIntentSchema,
});

export const paymentExecuteBodySchema = z.object({
  intent: paymentIntentSchema,
  decision: policyDecisionSchema,
});

export const approvalBodySchema = z.object({
  approve: z.boolean(),
});

export const approvalParamsSchema = z.object({
  intentId: z.string().trim().min(1),
});

export const receiptParamsSchema = z.object({
  paymentId: z.string().trim().min(1),
});

export const directBypassBodySchema = z.object({
  recipient: z.string().trim().min(1),
  amount_display: usdcDisplayAmountSchema,
});
