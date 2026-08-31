import { z } from "zod";

export const ModelPaymentIntentSchema = z
  .object({
    invoice_id: z.string(),
    vendor_name: z.string(),
    recipient: z.string(),
    amount_display: z.number(),
    token: z.literal("USDC"),
    action: z.literal("transfer"),
    reasoning: z.string(),
  })
  .strict();

export const ModelPaymentPlanSchema = z
  .object({
    intents: z.array(ModelPaymentIntentSchema),
    agent_message: z.string(),
  })
  .strict();

export const PaymentIntentSchema = z.object({
  intent_id: z.string(),
  invoice_id: z.string(),
  vendor_name: z.string(),
  recipient: z.string(),
  amount_display: z.number(),
  amount_raw: z.string(),
  token: z.literal("USDC"),
  action: z.literal("transfer"),
  reasoning: z.string(),
  created_at: z.string().datetime(),
});

export const PaymentPlanSchema = z.object({
  intents: z.array(PaymentIntentSchema),
  agent_message: z.string(),
});

export type ModelPaymentPlan = z.infer<typeof ModelPaymentPlanSchema>;
