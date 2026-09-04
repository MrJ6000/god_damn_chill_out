import type {
  AttackCase,
  AttackType,
  DenyReasonCode,
  Invoice,
  PaymentIntent,
  PolicyVerdict,
} from "@pv/shared";
import legitimate001 from "./cases/legitimate/ATK-LEG-001.json";
import legitimate002 from "./cases/legitimate/ATK-LEG-002.json";
import legitimate003 from "./cases/legitimate/ATK-LEG-003.json";
import legitimate004 from "./cases/legitimate/ATK-LEG-004.json";
import legitimate005 from "./cases/legitimate/ATK-LEG-005.json";
import promptInjection001 from "./cases/prompt-injection/ATK-PI-001.json";
import promptInjection002 from "./cases/prompt-injection/ATK-PI-002.json";
import promptInjection003 from "./cases/prompt-injection/ATK-PI-003.json";
import promptInjection004 from "./cases/prompt-injection/ATK-PI-004.json";
import promptInjection005 from "./cases/prompt-injection/ATK-PI-005.json";
import legitimate006 from "./cases/legitimate/ATK-LEG-006.json";
import legitimate007 from "./cases/legitimate/ATK-LEG-007.json";
import legitimate008 from "./cases/legitimate/ATK-LEG-008.json";
import legitimate009 from "./cases/legitimate/ATK-LEG-009.json";
import legitimate010 from "./cases/legitimate/ATK-LEG-010.json";
import promptInjection006 from "./cases/prompt-injection/ATK-PI-006.json";
import promptInjection007 from "./cases/prompt-injection/ATK-PI-007.json";
import promptInjection008 from "./cases/prompt-injection/ATK-PI-008.json";
import promptInjection009 from "./cases/prompt-injection/ATK-PI-009.json";
import promptInjection010 from "./cases/prompt-injection/ATK-PI-010.json";
import addressReplacement001 from "./cases/address-replacement/ATK-AR-001.json";
import addressReplacement002 from "./cases/address-replacement/ATK-AR-002.json";
import addressReplacement003 from "./cases/address-replacement/ATK-AR-003.json";
import addressReplacement004 from "./cases/address-replacement/ATK-AR-004.json";
import addressReplacement005 from "./cases/address-replacement/ATK-AR-005.json";
import addressReplacement006 from "./cases/address-replacement/ATK-AR-006.json";
import addressReplacement007 from "./cases/address-replacement/ATK-AR-007.json";
import addressReplacement008 from "./cases/address-replacement/ATK-AR-008.json";
import addressReplacement009 from "./cases/address-replacement/ATK-AR-009.json";
import addressReplacement010 from "./cases/address-replacement/ATK-AR-010.json";
import splitTransaction001 from "./cases/split-transaction/ATK-ST-001.json";
import splitTransaction002 from "./cases/split-transaction/ATK-ST-002.json";
import splitTransaction003 from "./cases/split-transaction/ATK-ST-003.json";
import splitTransaction004 from "./cases/split-transaction/ATK-ST-004.json";
import splitTransaction005 from "./cases/split-transaction/ATK-ST-005.json";
import splitTransaction006 from "./cases/split-transaction/ATK-ST-006.json";
import splitTransaction007 from "./cases/split-transaction/ATK-ST-007.json";
import splitTransaction008 from "./cases/split-transaction/ATK-ST-008.json";
import duplicatePayment001 from "./cases/duplicate-payment/ATK-DP-001.json";
import duplicatePayment002 from "./cases/duplicate-payment/ATK-DP-002.json";
import duplicatePayment003 from "./cases/duplicate-payment/ATK-DP-003.json";
import duplicatePayment004 from "./cases/duplicate-payment/ATK-DP-004.json";
import vendorImpersonation001 from "./cases/vendor-impersonation/ATK-VI-001.json";
import vendorImpersonation002 from "./cases/vendor-impersonation/ATK-VI-002.json";
import vendorImpersonation003 from "./cases/vendor-impersonation/ATK-VI-003.json";
import vendorImpersonation004 from "./cases/vendor-impersonation/ATK-VI-004.json";
import policyOverride001 from "./cases/policy-override/ATK-PO-001.json";
import policyOverride002 from "./cases/policy-override/ATK-PO-002.json";
import policyOverride003 from "./cases/policy-override/ATK-PO-003.json";
import policyOverride004 from "./cases/policy-override/ATK-PO-004.json";
import legitimate011 from "./cases/legitimate/ATK-LEG-011.json";
import legitimate012 from "./cases/legitimate/ATK-LEG-012.json";
import legitimate013 from "./cases/legitimate/ATK-LEG-013.json";
import legitimate014 from "./cases/legitimate/ATK-LEG-014.json";
import legitimate015 from "./cases/legitimate/ATK-LEG-015.json";
import legitimate016 from "./cases/legitimate/ATK-LEG-016.json";
import legitimate017 from "./cases/legitimate/ATK-LEG-017.json";
import legitimate018 from "./cases/legitimate/ATK-LEG-018.json";
import legitimate019 from "./cases/legitimate/ATK-LEG-019.json";
import legitimate020 from "./cases/legitimate/ATK-LEG-020.json";
import promptInjection011 from "./cases/prompt-injection/ATK-PI-011.json";
import promptInjection012 from "./cases/prompt-injection/ATK-PI-012.json";
import promptInjection013 from "./cases/prompt-injection/ATK-PI-013.json";
import promptInjection014 from "./cases/prompt-injection/ATK-PI-014.json";
import promptInjection015 from "./cases/prompt-injection/ATK-PI-015.json";
import promptInjection016 from "./cases/prompt-injection/ATK-PI-016.json";
import promptInjection017 from "./cases/prompt-injection/ATK-PI-017.json";
import promptInjection018 from "./cases/prompt-injection/ATK-PI-018.json";
import promptInjection019 from "./cases/prompt-injection/ATK-PI-019.json";
import promptInjection020 from "./cases/prompt-injection/ATK-PI-020.json";
import addressReplacement011 from "./cases/address-replacement/ATK-AR-011.json";
import addressReplacement012 from "./cases/address-replacement/ATK-AR-012.json";
import addressReplacement013 from "./cases/address-replacement/ATK-AR-013.json";
import addressReplacement014 from "./cases/address-replacement/ATK-AR-014.json";
import addressReplacement015 from "./cases/address-replacement/ATK-AR-015.json";
import splitTransaction009 from "./cases/split-transaction/ATK-ST-009.json";
import splitTransaction010 from "./cases/split-transaction/ATK-ST-010.json";
import splitTransaction011 from "./cases/split-transaction/ATK-ST-011.json";
import splitTransaction012 from "./cases/split-transaction/ATK-ST-012.json";
import splitTransaction013 from "./cases/split-transaction/ATK-ST-013.json";
import splitTransaction014 from "./cases/split-transaction/ATK-ST-014.json";
import splitTransaction015 from "./cases/split-transaction/ATK-ST-015.json";
import duplicatePayment005 from "./cases/duplicate-payment/ATK-DP-005.json";
import duplicatePayment006 from "./cases/duplicate-payment/ATK-DP-006.json";
import duplicatePayment007 from "./cases/duplicate-payment/ATK-DP-007.json";
import duplicatePayment008 from "./cases/duplicate-payment/ATK-DP-008.json";
import duplicatePayment009 from "./cases/duplicate-payment/ATK-DP-009.json";
import duplicatePayment010 from "./cases/duplicate-payment/ATK-DP-010.json";
import vendorImpersonation005 from "./cases/vendor-impersonation/ATK-VI-005.json";
import vendorImpersonation006 from "./cases/vendor-impersonation/ATK-VI-006.json";
import vendorImpersonation007 from "./cases/vendor-impersonation/ATK-VI-007.json";
import vendorImpersonation008 from "./cases/vendor-impersonation/ATK-VI-008.json";
import vendorImpersonation009 from "./cases/vendor-impersonation/ATK-VI-009.json";
import vendorImpersonation010 from "./cases/vendor-impersonation/ATK-VI-010.json";
import policyOverride005 from "./cases/policy-override/ATK-PO-005.json";
import policyOverride006 from "./cases/policy-override/ATK-PO-006.json";
import policyOverride007 from "./cases/policy-override/ATK-PO-007.json";
import policyOverride008 from "./cases/policy-override/ATK-PO-008.json";
import policyOverride009 from "./cases/policy-override/ATK-PO-009.json";
import policyOverride010 from "./cases/policy-override/ATK-PO-010.json";

const ATTACK_TYPES: readonly AttackType[] = [
  "LEGITIMATE",
  "PROMPT_INJECTION",
  "ADDRESS_REPLACEMENT",
  "SPLIT_TRANSACTION",
  "DUPLICATE_PAYMENT",
  "VENDOR_IMPERSONATION",
  "POLICY_OVERRIDE",
];

const POLICY_VERDICTS: readonly PolicyVerdict[] = ["ALLOW", "REVIEW", "DENY"];

const DENY_REASONS: readonly DenyReasonCode[] = [
  "TOKEN_NOT_ALLOWED",
  "VENDOR_UNKNOWN",
  "BENEFICIARY_MISMATCH",
  "PER_TX_LIMIT_EXCEEDED",
  "DAILY_LIMIT_EXCEEDED",
  "SESSION_EXPIRED",
  "DUPLICATE_PAYMENT",
  "POLICY_OVERRIDE_ATTEMPT",
];

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function assertNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
}

function assertInvoice(value: unknown, label: string): asserts value is Invoice {
  assertRecord(value, label);
  assertString(value.invoice_id, `${label}.invoice_id`);
  assertString(value.vendor, `${label}.vendor`);
  assertNumber(value.amount, `${label}.amount`);
  if (value.currency !== "USDC") throw new Error(`${label}.currency must be USDC.`);
  assertString(value.payment_address, `${label}.payment_address`);
}

function assertPaymentIntent(value: unknown, label: string): asserts value is PaymentIntent {
  assertRecord(value, label);
  assertString(value.intent_id, `${label}.intent_id`);
  assertString(value.invoice_id, `${label}.invoice_id`);
  assertString(value.vendor_name, `${label}.vendor_name`);
  assertString(value.recipient, `${label}.recipient`);
  assertNumber(value.amount_display, `${label}.amount_display`);
  assertString(value.amount_raw, `${label}.amount_raw`);
  if (value.token !== "USDC") throw new Error(`${label}.token must be USDC.`);
  if (value.action !== "transfer") throw new Error(`${label}.action must be transfer.`);
  assertString(value.reasoning, `${label}.reasoning`);
  assertString(value.created_at, `${label}.created_at`);
}

function validateAttackCase(value: unknown, source: string): AttackCase {
  assertRecord(value, source);
  assertString(value.case_id, `${source}.case_id`);
  if (!ATTACK_TYPES.includes(value.type as AttackType)) {
    throw new Error(`${source}.type is not a supported AttackType.`);
  }
  assertString(value.description, `${source}.description`);
  if (!Array.isArray(value.invoices) || value.invoices.length === 0) {
    throw new Error(`${source}.invoices must be a non-empty array.`);
  }
  value.invoices.forEach((invoice, index) => assertInvoice(invoice, `${source}.invoices[${index}]`));
  if (!Array.isArray(value.recorded_intents) || value.recorded_intents.length === 0) {
    throw new Error(`${source}.recorded_intents must be a non-empty array for offline mode.`);
  }
  value.recorded_intents.forEach((intent, index) =>
    assertPaymentIntent(intent, `${source}.recorded_intents[${index}]`),
  );
  if (value.recorded_intents.length !== value.invoices.length) {
    throw new Error(`${source} must contain one recorded intent per invoice.`);
  }
  if (!POLICY_VERDICTS.includes(value.expected_verdict as PolicyVerdict)) {
    throw new Error(`${source}.expected_verdict is invalid.`);
  }
  if (
    value.expected_deny_reason !== undefined &&
    !DENY_REASONS.includes(value.expected_deny_reason as DenyReasonCode)
  ) {
    throw new Error(`${source}.expected_deny_reason is invalid.`);
  }
  if (typeof value.must_not_execute !== "boolean") {
    throw new Error(`${source}.must_not_execute must be a boolean.`);
  }
  return value as unknown as AttackCase;
}

function loadAttackCases(): AttackCase[] {
  const rawCases: unknown[] = [
    legitimate001,
    legitimate002,
    legitimate003,
    legitimate004,
    legitimate005,
    promptInjection001,
    promptInjection002,
    promptInjection003,
    promptInjection004,
    promptInjection005,
    legitimate006,
    legitimate007,
    legitimate008,
    legitimate009,
    legitimate010,
    promptInjection006,
    promptInjection007,
    promptInjection008,
    promptInjection009,
    promptInjection010,
    addressReplacement001,
    addressReplacement002,
    addressReplacement003,
    addressReplacement004,
    addressReplacement005,
    addressReplacement006,
    addressReplacement007,
    addressReplacement008,
    addressReplacement009,
    addressReplacement010,
    splitTransaction001,
    splitTransaction002,
    splitTransaction003,
    splitTransaction004,
    splitTransaction005,
    splitTransaction006,
    splitTransaction007,
    splitTransaction008,
    duplicatePayment001,
    duplicatePayment002,
    duplicatePayment003,
    duplicatePayment004,
    vendorImpersonation001,
    vendorImpersonation002,
    vendorImpersonation003,
    vendorImpersonation004,
    policyOverride001,
    policyOverride002,
    policyOverride003,
    policyOverride004,
    legitimate011,
    legitimate012,
    legitimate013,
    legitimate014,
    legitimate015,
    legitimate016,
    legitimate017,
    legitimate018,
    legitimate019,
    legitimate020,
    promptInjection011,
    promptInjection012,
    promptInjection013,
    promptInjection014,
    promptInjection015,
    promptInjection016,
    promptInjection017,
    promptInjection018,
    promptInjection019,
    promptInjection020,
    addressReplacement011,
    addressReplacement012,
    addressReplacement013,
    addressReplacement014,
    addressReplacement015,
    splitTransaction009,
    splitTransaction010,
    splitTransaction011,
    splitTransaction012,
    splitTransaction013,
    splitTransaction014,
    splitTransaction015,
    duplicatePayment005,
    duplicatePayment006,
    duplicatePayment007,
    duplicatePayment008,
    duplicatePayment009,
    duplicatePayment010,
    vendorImpersonation005,
    vendorImpersonation006,
    vendorImpersonation007,
    vendorImpersonation008,
    vendorImpersonation009,
    vendorImpersonation010,
    policyOverride005,
    policyOverride006,
    policyOverride007,
    policyOverride008,
    policyOverride009,
    policyOverride010,
  ];
  const cases = rawCases.map((value, index) => validateAttackCase(value, `attack case ${index + 1}`));
  const caseIds = new Set<string>();
  for (const attackCase of cases) {
    if (caseIds.has(attackCase.case_id)) throw new Error(`Duplicate case_id: ${attackCase.case_id}`);
    caseIds.add(attackCase.case_id);
  }
  return cases;
}

export const attackCases: AttackCase[] = loadAttackCases();

export default attackCases;
