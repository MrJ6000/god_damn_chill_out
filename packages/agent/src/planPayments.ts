import { toRawAmount, type Invoice, type PaymentIntent } from "@pv/shared";
import { PaymentPlanSchema } from "./schemas.js";

export interface PlanPaymentsInput {
  instruction: string;
  invoices: Invoice[];
  vendorContext: Array<{
    display_name: string;
    status: "KNOWN" | "NEW";
  }>;
}

export interface PaymentPlan {
  intents: PaymentIntent[];
  agent_message: string;
}

/** Day 1 mock：不呼叫 OpenAI，直接把每張帳單轉成付款意圖。 */
export async function planPayments(
  input: PlanPaymentsInput,
): Promise<PaymentPlan> {
  const createdAt = new Date().toISOString();
  const intents = input.invoices.map<PaymentIntent>((invoice, index) => ({
    intent_id: `PI-${String(index + 1).padStart(4, "0")}`,
    invoice_id: invoice.invoice_id,
    vendor_name: invoice.vendor,
    recipient: invoice.payment_address,
    amount_display: invoice.amount,
    amount_raw: toRawAmount(invoice.amount),
    token: "USDC",
    action: "transfer",
    reasoning: "Prepared directly from the invoice fields in mock mode.",
    created_at: createdAt,
  }));

  return PaymentPlanSchema.parse({
    intents,
    agent_message: `Prepared ${intents.length} payment intents from ${input.invoices.length} invoices.`,
  });
}
