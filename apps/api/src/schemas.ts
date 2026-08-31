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

const nonnegativeUsdcDisplayAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(MAX_SAFE_USDC_DISPLAY)
  .refine(
    (amount) =>
      Math.abs(amount * 1_000_000 - Math.round(amount * 1_000_000)) < 1e-6,
    "USDC amounts support at most 6 decimal places.",
  );

const transactionHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/);

const evmAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

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
}).strict();

export const vendorSchema = z.object({
  vendor_id: z.string().trim().min(1),
  display_name: z.string().trim().min(1),
  verified_wallet: z.string().trim().min(1),
  verified: z.boolean(),
  status: z.enum(["KNOWN", "NEW"]),
  created_at: z.string().datetime({ offset: true }),
}).strict();

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
  .strict()
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
      }).strict(),
    )
    .length(8),
  deny_reasons: z.array(denyReasonSchema),
  policy_version: z.string().trim().min(1),
  evaluated_at: z.string().datetime({ offset: true }),
  latency_ms: z.number().finite().nonnegative(),
}).strict();

export const executionResultSchema = z
  .object({
    intent_id: z.string().trim().min(1),
    status: z.enum(["EXECUTED", "REJECTED", "PENDING", "SKIPPED"]),
    tx_hash: transactionHashSchema.optional(),
    user_op_hash: transactionHashSchema.optional(),
    block_number: z.number().int().nonnegative().optional(),
    explorer_url: z.string().trim().min(1).optional(),
    error_code: z.string().trim().min(1).optional(),
    error_message: z.string().optional(),
    executed_at: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((execution, context) => {
    if (
      execution.status === "PENDING" &&
      !execution.tx_hash &&
      !execution.user_op_hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "A pending execution must retain its broadcast hash.",
      });
    }
  });

export const policyReceiptSchema = z.object({
  payment_id: z.string().trim().min(1),
  input_hash: z.string().regex(/^[a-f0-9]{8}$/),
  invoice_id: z.string().trim().min(1),
  vendor_name: z.string().trim().min(1),
  verified_recipient: z.string(),
  agent_proposed_recipient: z.string().trim().min(1),
  amount_display: usdcDisplayAmountSchema,
  policy_version: z.string().trim().min(1),
  session_permission_id: z.string().trim().min(1),
  policy_verdict: z.enum(["ALLOW", "REVIEW", "DENY"]),
  deny_reasons: z.array(denyReasonSchema),
  human_approval: z.enum([
    "NOT_REQUIRED",
    "APPROVED",
    "PENDING",
    "REJECTED",
  ]),
  execution: executionResultSchema.nullable(),
  funds_moved_display: nonnegativeUsdcDisplayAmountSchema,
  created_at: z.string().datetime({ offset: true }),
}).strict();

export const storedPaymentRecordSchema = z
  .object({
    execution_mode: z.enum(["MOCK", "REAL"]).default("MOCK"),
    intent: paymentIntentSchema,
    decision: policyDecisionSchema,
    execution: executionResultSchema,
    receipt: policyReceiptSchema,
  })
  .strict()
  .superRefine((record, context) => {
    const intentId = record.intent.intent_id;
    if (
      record.decision.intent_id !== intentId ||
      record.execution.intent_id !== intentId ||
      (record.receipt.execution !== null &&
        record.receipt.execution.intent_id !== intentId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stored decision and execution IDs must match the intent ID.",
      });
    }
    if (record.receipt.invoice_id !== record.intent.invoice_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "invoice_id"],
        message: "Stored receipt invoice ID must match the intent invoice ID.",
      });
    }
    if (
      record.receipt.vendor_name !== record.intent.vendor_name ||
      record.receipt.agent_proposed_recipient !== record.intent.recipient ||
      record.receipt.amount_display !== record.intent.amount_display
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt"],
        message: "Stored receipt payment fields must match the payment intent.",
      });
    }
    if (
      record.receipt.policy_verdict !== record.decision.verdict ||
      record.receipt.policy_version !== record.decision.policy_version ||
      record.receipt.deny_reasons.length !==
        record.decision.deny_reasons.length ||
      record.receipt.deny_reasons.some(
        (reason, index) => reason !== record.decision.deny_reasons[index],
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt"],
        message: "Stored receipt policy fields must match the policy decision.",
      });
    }
    if (
      record.receipt.execution === null ||
      JSON.stringify(record.receipt.execution) !==
        JSON.stringify(record.execution)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "execution"],
        message: "Stored receipt execution must match the execution result.",
      });
    }

    const expectedFundsMoved =
      record.execution.status === "EXECUTED"
        ? record.intent.amount_display
        : 0;
    if (record.receipt.funds_moved_display !== expectedFundsMoved) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "funds_moved_display"],
        message: "Stored funds moved must match the execution status.",
      });
    }
    if (
      record.execution.status === "EXECUTED" &&
      !record.execution.tx_hash &&
      !record.execution.user_op_hash
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message: "An executed payment must include transaction evidence.",
      });
    }
    if (
      record.decision.verdict !== "REVIEW" &&
      record.receipt.human_approval !== "NOT_REQUIRED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "human_approval"],
        message: "Only review receipts may contain a human approval decision.",
      });
    }
    if (
      record.decision.verdict === "REVIEW" &&
      record.receipt.human_approval === "NOT_REQUIRED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "human_approval"],
        message: "A review receipt must contain a human approval state.",
      });
    }
    if (
      record.decision.verdict === "REVIEW" &&
      ["PENDING", "REJECTED"].includes(record.receipt.human_approval) &&
      record.execution.status !== "SKIPPED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "status"],
        message: "An unapproved review payment must remain skipped.",
      });
    }
    if (
      record.decision.verdict === "REVIEW" &&
      record.receipt.human_approval === "APPROVED" &&
      !["EXECUTED", "REJECTED", "PENDING"].includes(record.execution.status)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "status"],
        message: "An approved review must have a submitted chain result.",
      });
    }
    if (
      record.decision.verdict === "DENY" &&
      record.execution.status !== "SKIPPED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "status"],
        message: "A denied payment must remain skipped.",
      });
    }
    if (
      record.decision.verdict === "ALLOW" &&
      record.execution.status === "SKIPPED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "status"],
        message: "An allowed payment must have a submitted chain result.",
      });
    }
    if (
      record.execution_mode === "MOCK" &&
      record.execution.status === "PENDING"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "status"],
        message: "A mock execution cannot remain pending.",
      });
    }
    if (
      record.execution_mode === "MOCK" &&
      record.execution.status === "EXECUTED" &&
      record.execution.error_code !== "MOCK_CHAIN"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution", "error_code"],
        message: "A mock execution must include the MOCK_CHAIN marker.",
      });
    }
    if (
      record.execution_mode === "REAL" &&
      (record.execution.error_code === "MOCK_CHAIN" ||
        record.execution.error_message?.includes("MOCK MODE") ||
        record.receipt.session_permission_id === "SP-MOCK")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["execution"],
        message: "A real execution cannot contain mock-chain evidence.",
      });
    }
    if (
      record.execution_mode === "REAL" &&
      record.execution.status !== "SKIPPED" &&
      record.receipt.session_permission_id === "NOT_SUBMITTED"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "session_permission_id"],
        message: "A submitted real execution requires its session permission ID.",
      });
    }
  });

export const vendorsFileSchema = z.array(vendorSchema);
export const invoicesFileSchema = z.array(invoiceSchema);
export const paymentRecordsFileSchema = z
  .array(storedPaymentRecordSchema)
  .superRefine((records, context) => {
    const intentKeys = new Set<string>();
    const paymentIds = new Set<string>();

    records.forEach((record, index) => {
      const intentKey = record.intent.intent_id;
      if (intentKeys.has(intentKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "intent", "intent_id"],
          message: "Stored intent IDs must be globally unique.",
        });
      }
      intentKeys.add(intentKey);

      if (paymentIds.has(record.receipt.payment_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "receipt", "payment_id"],
          message: "Stored payment IDs must be unique.",
        });
      }
      paymentIds.add(record.receipt.payment_id);
    });
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

export const paymentExecuteBodySchema = z
  .object({
    intent: paymentIntentSchema,
    decision: policyDecisionSchema,
  })
  .superRefine((body, context) => {
    if (body.decision.intent_id !== body.intent.intent_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "intent_id"],
        message: "decision.intent_id must match intent.intent_id.",
      });
    }
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
  recipient: evmAddressSchema,
  amount_display: usdcDisplayAmountSchema,
});

export const sessionPermissionSchema = z.object({
  allowed_token: evmAddressSchema,
  max_per_tx_raw: z.string().regex(/^\d+$/),
  max_per_24h_raw: z.string().regex(/^\d+$/),
  remaining_24h_raw: z.string().regex(/^\d+$/),
  expires_at: z.string().datetime({ offset: true }),
  authorized_recipient_count: z.number().int().nonnegative(),
}).strict();
