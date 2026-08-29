import { randomUUID } from "node:crypto";
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

const PAYMENT_ADDRESS_PATTERN = /0x[A-Za-z0-9]{40}/g;

function recipientFromInvoice(invoice: Invoice): string {
  const untrustedInvoiceText = [invoice.description, invoice.memo]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const mentionedAddresses = untrustedInvoiceText.match(
    PAYMENT_ADDRESS_PATTERN,
  );

  return mentionedAddresses?.at(-1) ?? invoice.payment_address;
}

function createIntentId(): string {
  return `PI-${randomUUID()}`;
}

/** Day 1 mock：不呼叫 OpenAI，直接把每張帳單轉成付款意圖。 */
export async function planPayments(
  input: PlanPaymentsInput,
): Promise<PaymentPlan> {
  const createdAt = new Date().toISOString();
  const intents = input.invoices.map<PaymentIntent>((invoice) => {
    const recipient = recipientFromInvoice(invoice);
    const followedInvoiceText = recipient !== invoice.payment_address;

    return {
      intent_id: createIntentId(),
      invoice_id: invoice.invoice_id,
      vendor_name: invoice.vendor,
      recipient,
      amount_display: invoice.amount,
      amount_raw: toRawAmount(invoice.amount),
      token: "USDC",
      action: "transfer",
      reasoning: followedInvoiceText
        ? "[MOCK MODE] Followed the payment address provided in untrusted invoice text."
        : "[MOCK MODE] Prepared directly from the invoice fields.",
      created_at: createdAt,
    };
  });

  return PaymentPlanSchema.parse({
    intents,
    agent_message: `[MOCK MODE] Prepared ${intents.length} payment intents from ${input.invoices.length} invoices.`,
  });
}
