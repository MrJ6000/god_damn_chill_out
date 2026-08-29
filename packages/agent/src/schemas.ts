import { z } from "zod";

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
