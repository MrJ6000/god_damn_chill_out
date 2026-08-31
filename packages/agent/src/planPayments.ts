import { randomUUID } from "node:crypto";
import { toRawAmount } from "@pv/shared";
import type { Invoice, PaymentIntent } from "@pv/shared";
import { zodResponseFormat } from "openai/helpers/zod";
import { isMockMode, openAIModel, openaiClient } from "./client.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import {
  ModelPaymentPlanSchema,
  PaymentPlanSchema,
  type ModelPaymentPlan,
} from "./schemas.js";

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

interface ModelPlanInput {
  instruction: string;
  invoices: Invoice[];
  vendorContext: Array<{
    display_name: string;
    status: "KNOWN" | "NEW";
  }>;
}

type StructuredPlanRequester = (input: ModelPlanInput) => Promise<unknown>;

export interface PlanPaymentsOptions {
  mockMode?: boolean;
  requestStructuredPlan?: StructuredPlanRequester;
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

function createMockPlan(input: PlanPaymentsInput): PaymentPlan {
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

function createModelInput(input: PlanPaymentsInput): ModelPlanInput {
  return {
    instruction: input.instruction,
    invoices: input.invoices,
    vendorContext: input.vendorContext.map(({ display_name, status }) => ({
      display_name,
      status,
    })),
  };
}

function serializeModelInput(input: ModelPlanInput): string {
  return JSON.stringify(input);
}

async function requestOpenAIStructuredPlan(
  input: ModelPlanInput,
): Promise<unknown> {
  if (!openaiClient) {
    throw new Error(
      "OpenAI client is unavailable because OPENAI_API_KEY is not configured.",
    );
  }

  const completion = await openaiClient.chat.completions.parse({
    model: openAIModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: serializeModelInput(input) },
    ],
    response_format: zodResponseFormat(
      ModelPaymentPlanSchema,
      "payment_plan",
    ),
  });
  const message = completion.choices[0]?.message;

  if (!message?.parsed) {
    throw new Error(
      message?.refusal
        ? `OpenAI refused to create a payment plan: ${message.refusal}`
        : "OpenAI returned no parsed structured payment plan.",
    );
  }

  return message.parsed;
}

async function requestValidatedPlan(
  input: ModelPlanInput,
  requester: StructuredPlanRequester,
): Promise<ModelPaymentPlan> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return ModelPaymentPlanSchema.parse(await requester(input));
    } catch (error) {
      lastError = error;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `OpenAI structured payment plan failed after 2 attempts: ${detail}`,
  );
}

function addProgramFields(modelPlan: ModelPaymentPlan): PaymentPlan {
  const createdAt = new Date().toISOString();
  const intents = modelPlan.intents.map<PaymentIntent>((intent) => ({
    ...intent,
    intent_id: createIntentId(),
    amount_raw: toRawAmount(intent.amount_display),
    created_at: createdAt,
  }));

  return PaymentPlanSchema.parse({
    intents,
    agent_message: modelPlan.agent_message,
  });
}

/** 有 API key 時呼叫 OpenAI；否則保留可離線執行的 Day 1 mock。 */
export async function planPayments(
  input: PlanPaymentsInput,
  options: PlanPaymentsOptions = {},
): Promise<PaymentPlan> {
  if (options.mockMode ?? isMockMode) {
    return createMockPlan(input);
  }

  const modelPlan = await requestValidatedPlan(
    createModelInput(input),
    options.requestStructuredPlan ?? requestOpenAIStructuredPlan,
  );
  return addProgramFields(modelPlan);
}
