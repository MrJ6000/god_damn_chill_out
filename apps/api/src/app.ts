import { fileURLToPath } from "node:url";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { isMockMode, planPayments } from "@pv/agent";
import type {
  ApiErr,
  ApiOk,
  BlastRadius,
  ExecutionResult,
  PaymentIntent,
  PolicyReceipt,
} from "@pv/shared";
import { toRawAmount } from "@pv/shared";
import type { output, ZodTypeAny } from "zod";
import {
  buildMockBlastRadius,
  buildMockExecution,
  buildPolicyReceipt,
  buildMockSuccessfulExecution,
  getRuntimeConfig,
  type RuntimeConfig,
} from "./mock.js";
import { evaluatePolicy } from "./policy.js";
import {
  agentPlanBodySchema,
  agentPlanResultSchema,
  approvalBodySchema,
  approvalParamsSchema,
  directBypassBodySchema,
  executionResultSchema,
  paymentExecuteBodySchema,
  policyEvaluateBodySchema,
  receiptParamsSchema,
  sessionPermissionSchema,
} from "./schemas.js";
import { JsonStore, type StoredPaymentRecord } from "./store.js";

const defaultDataDir = fileURLToPath(new URL("../../../data", import.meta.url));

export interface CreateAppOptions {
  dataDir?: string;
  now?: () => Date;
  mockAgent?: boolean;
  mockChain?: boolean;
  enableDirectBypass?: boolean;
  expectedTokenAddress?: string;
  webOrigin?: string;
  config?: Partial<RuntimeConfig>;
  agentRuntime?: {
    plan: typeof planPayments;
    openAIConfigured: boolean;
  };
  smartAccountRuntime?: SmartAccountRuntime;
}

export interface SmartAccountRuntime {
  /** Must only use the scoped AI session key, never the CFO root signer. */
  sessionKeyOnly?: boolean;
  /** Stable identifier for the exact scoped permission used for execution. */
  sessionPermissionId?: string;
  executeTransfer?: (intent: PaymentIntent) => Promise<ExecutionResult>;
  executeRawTransferWithSessionKey?: (
    recipient: string,
    amountRaw: string,
  ) => Promise<ExecutionResult>;
  readSessionPermission?: () => Promise<unknown>;
}

type SessionPermission = output<typeof sessionPermissionSchema>;

function sendOk<T>(res: Response, data: T): void {
  const body: ApiOk<T> = { ok: true, data };
  res.json(body);
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  const body: ApiErr = { ok: false, error: { code, message } };
  res.status(status).json(body);
}

function parseWithSchema<T extends ZodTypeAny>(
  schema: T,
  input: unknown,
  res: Response,
): output<T> | null {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;

  sendError(res, 400, "VALIDATION_ERROR", parsed.error.message);
  return null;
}

function paymentIntentsEqual(
  left: PaymentIntent,
  right: PaymentIntent,
): boolean {
  return (
    left.intent_id === right.intent_id &&
    left.invoice_id === right.invoice_id &&
    left.vendor_name === right.vendor_name &&
    left.recipient === right.recipient &&
    left.amount_display === right.amount_display &&
    left.amount_raw === right.amount_raw &&
    left.token === right.token &&
    left.action === right.action &&
    left.reasoning === right.reasoning &&
    left.created_at === right.created_at
  );
}

function recordsForExecutionMode(
  records: StoredPaymentRecord[],
  executionMode: StoredPaymentRecord["execution_mode"],
): StoredPaymentRecord[] {
  return records.filter(
    (record) => record.execution_mode === executionMode,
  );
}

function nextPaymentNumber(records: StoredPaymentRecord[]): number {
  const usedPaymentIds = new Set(
    records.map((record) => record.receipt.payment_id),
  );
  let candidate = records.length + 1;
  while (usedPaymentIds.has(`PV-${String(candidate).padStart(4, "0")}`)) {
    candidate += 1;
  }
  return candidate;
}

function rawUsdcToDisplay(raw: string): number {
  const value = BigInt(raw);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("On-chain USDC amount exceeds the safe display range.");
  }
  return Number(value) / 1_000_000;
}

function buildPermissionBackedBlastRadius(
  permission: SessionPermission,
  records: StoredPaymentRecord[],
  now: Date,
  config: RuntimeConfig,
): BlastRadius {
  const totalSpent = records.reduce(
    (total, record) => total + record.receipt.funds_moved_display,
    0,
  );
  return {
    treasury_balance_display: Math.max(
      0,
      config.treasuryBalanceDisplay - totalSpent,
    ),
    max_per_tx_display: rawUsdcToDisplay(permission.max_per_tx_raw),
    max_per_24h_display: rawUsdcToDisplay(permission.max_per_24h_raw),
    remaining_24h_display: rawUsdcToDisplay(permission.remaining_24h_raw),
    authorized_recipient_count: permission.authorized_recipient_count,
    unauthorized_recipient_exposure: 0,
    session_expires_at: permission.expires_at,
    session_remaining_seconds: Math.max(
      0,
      Math.floor((Date.parse(permission.expires_at) - now.getTime()) / 1_000),
    ),
    allowed_tokens: ["USDC"],
    allowed_actions: ["transfer"],
    // The permission limits come from chain, but treasury balance remains a
    // configured/local-ledger estimate. The shared type has no mixed source.
    source: "cached",
  };
}

function parseChainExecution(
  input: unknown,
  expectedIntentId?: string,
): ExecutionResult | null {
  const parsed = executionResultSchema.safeParse(input);
  if (!parsed.success) return null;
  if (expectedIntentId && parsed.data.intent_id !== expectedIntentId) return null;
  if (parsed.data.status === "SKIPPED") return null;
  if (
    parsed.data.error_code === "MOCK_CHAIN" ||
    parsed.data.error_message?.includes("MOCK MODE")
  ) {
    return null;
  }
  return parsed.data;
}

function hasOnchainExecutionEvidence(execution: ExecutionResult): boolean {
  // A pending result is deliberately non-terminal, but retaining either hash
  // prevents an idempotent retry from broadcasting the same payment again.
  if (execution.status === "PENDING") {
    return (
      execution.tx_hash !== undefined || execution.user_op_hash !== undefined
    );
  }

  // Terminal results must include a mined transaction hash.
  return execution.tx_hash !== undefined;
}

function hasUsableSessionPermission(
  runtime: SmartAccountRuntime,
): runtime is SmartAccountRuntime & { sessionPermissionId: string } {
  return (
    runtime.sessionKeyOnly === true &&
    typeof runtime.sessionPermissionId === "string" &&
    runtime.sessionPermissionId.trim() !== "" &&
    !["SP-MOCK", "NOT_SUBMITTED"].includes(runtime.sessionPermissionId)
  );
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();
  const store = new JsonStore(options.dataDir ?? defaultDataDir);
  const now = options.now ?? (() => new Date());
  const config = getRuntimeConfig(options.config);
  const mockAgent = options.mockAgent ?? process.env.MOCK_AGENT === "1";
  const mockChain = options.mockChain ?? process.env.MOCK_CHAIN === "1";
  const enableDirectBypass =
    options.enableDirectBypass ?? process.env.ENABLE_DIRECT_BYPASS === "1";
  const expectedTokenAddress =
    options.expectedTokenAddress ?? process.env.USDC_ADDRESS;
  const executionMode: StoredPaymentRecord["execution_mode"] = mockChain
    ? "MOCK"
    : "REAL";
  const agentRuntime = options.agentRuntime ?? {
    plan: planPayments,
    openAIConfigured: !isMockMode,
  };
  let smartAccountRuntimePromise: Promise<SmartAccountRuntime> | undefined;
  const startedAt = Date.now();
  let paymentMutationQueue = Promise.resolve();

  function serializePaymentMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = paymentMutationQueue.then(operation, operation);
    paymentMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function loadSmartAccountRuntime(): Promise<SmartAccountRuntime> {
    if (options.smartAccountRuntime) {
      return Promise.resolve(options.smartAccountRuntime);
    }
    smartAccountRuntimePromise ??= import(
      "../../../packages/smart-account/src/index.js"
    ).then((module) => module as unknown as SmartAccountRuntime);
    return smartAccountRuntimePromise;
  }

  app.use(
    cors({
      origin:
        options.webOrigin ??
        process.env.WEB_ORIGIN ??
        "http://localhost:3000",
    }),
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    sendOk(res, {
      status: "ok",
      version: "0.1.0",
      uptime_s: Math.floor((Date.now() - startedAt) / 1_000),
    });
  });

  app.get(
    "/api/vendors",
    asyncHandler(async (_req, res) => {
      sendOk(res, await store.listVendors());
    }),
  );

  app.get(
    "/api/invoices",
    asyncHandler(async (_req, res) => {
      sendOk(res, await store.listInvoices());
    }),
  );

  app.post(
    "/api/agent/plan",
    asyncHandler(async (req, res) => {
      const body = parseWithSchema(agentPlanBodySchema, req.body, res);
      if (!body) return;

      if (!mockAgent && !agentRuntime.openAIConfigured) {
        sendError(
          res,
          503,
          "AGENT_INTEGRATION_NOT_READY",
          "OPENAI_API_KEY is required when MOCK_AGENT is not set to 1.",
        );
        return;
      }

      const vendors = await store.listVendors();
      try {
        const plan = await agentRuntime.plan(
          {
            instruction: body.instruction,
            invoices: body.invoices,
            vendorContext: vendors.map(({ display_name, status }) => ({
              display_name,
              status,
            })),
          },
          { mockMode: mockAgent },
        );
        const parsedPlan = agentPlanResultSchema.safeParse(plan);
        if (!parsedPlan.success) {
          console.error("[api] invalid agent plan", parsedPlan.error);
          sendError(
            res,
            502,
            "AGENT_INVALID_RESPONSE",
            "@pv/agent returned an invalid payment plan.",
          );
          return;
        }

        sendOk(res, parsedPlan.data);
      } catch (error) {
        console.error("[api] agent plan failed", error);
        sendError(
          res,
          502,
          "AGENT_ERROR",
          "@pv/agent could not create a payment plan.",
        );
      }
    }),
  );

  app.post(
    "/api/policy/evaluate",
    asyncHandler(async (req, res) => {
      const body = parseWithSchema(policyEvaluateBodySchema, req.body, res);
      if (!body) return;

      const [vendors, records] = await Promise.all([
        store.listVendors(),
        store.listPaymentRecords(),
      ]);
      sendOk(
        res,
        evaluatePolicy(
          body.intent,
          vendors,
          recordsForExecutionMode(records, executionMode),
          now(),
          config,
        ),
      );
    }),
  );

  app.post(
    "/api/payments/execute",
    asyncHandler(async (req, res) => {
      const body = parseWithSchema(paymentExecuteBodySchema, req.body, res);
      if (!body) return;

      const [vendors, invoices] = await Promise.all([
        store.listVendors(),
        store.listInvoices(),
      ]);

      const outcome = await serializePaymentMutation(async () => {
        const records = await store.listPaymentRecords();
        const modeRecords = recordsForExecutionMode(records, executionMode);
        const existingRecord = records.find(
          (record) => record.intent.intent_id === body.intent.intent_id,
        );
        if (existingRecord) {
          if (existingRecord.execution_mode !== executionMode) {
            return { status: "intent-mode-conflict" as const };
          }
          if (!paymentIntentsEqual(existingRecord.intent, body.intent)) {
            return { status: "intent-conflict" as const };
          }
          return {
            status: "existing" as const,
            execution: existingRecord.execution,
            receipt: existingRecord.receipt,
          };
        }

        const invoice = invoices.find(
          (candidate) => candidate.invoice_id === body.intent.invoice_id,
        );
        if (!invoice) return { status: "invoice-not-found" as const };

        const intentMatchesInvoice =
          body.intent.vendor_name.toLowerCase() ===
            invoice.vendor.toLowerCase() &&
          body.intent.amount_display === invoice.amount &&
          body.intent.amount_raw === toRawAmount(invoice.amount) &&
          body.intent.token === invoice.currency;
        if (!intentMatchesInvoice) {
          return { status: "invoice-mismatch" as const };
        }

        // Never trust the client-provided decision. Re-evaluate on the server.
        const decision = evaluatePolicy(
          body.intent,
          vendors,
          modeRecords,
          now(),
          config,
        );
        let execution: ExecutionResult;
        let sessionPermissionId = mockChain ? "SP-MOCK" : "NOT_SUBMITTED";

        if (decision.verdict !== "ALLOW") {
          execution = buildMockExecution(
            body.intent.intent_id,
            now(),
            decision.verdict === "DENY"
              ? "POLICY_DENIED"
              : "POLICY_REVIEW_REQUIRED",
            `Policy verdict ${decision.verdict}; no transaction was submitted.`,
          );
        } else if (mockChain) {
          execution = buildMockSuccessfulExecution(body.intent.intent_id, now());
        } else {
          let smartAccount: SmartAccountRuntime;
          try {
            smartAccount = await loadSmartAccountRuntime();
          } catch (error) {
            console.error("[api] smart-account module failed to load", error);
            return { status: "chain-not-ready" as const };
          }
          if (
            !smartAccount.executeTransfer ||
            !hasUsableSessionPermission(smartAccount)
          ) {
            return { status: "chain-not-ready" as const };
          }

          let rawExecution: unknown;
          try {
            rawExecution = await smartAccount.executeTransfer(body.intent);
          } catch (error) {
            console.error("[api] smart-account transfer failed", error);
            return { status: "chain-failed" as const };
          }
          const parsedExecution = parseChainExecution(
            rawExecution,
            body.intent.intent_id,
          );
          if (!parsedExecution) {
            console.error("[api] smart-account returned an invalid execution");
            return { status: "chain-invalid-response" as const };
          }
          if (!hasOnchainExecutionEvidence(parsedExecution)) {
            return { status: "chain-unconfirmed" as const };
          }
          execution = parsedExecution;
          sessionPermissionId = smartAccount.sessionPermissionId;
        }

        const vendor = vendors.find(
          (candidate) =>
            candidate.verified &&
            candidate.display_name.toLowerCase() ===
            body.intent.vendor_name.toLowerCase(),
        );
        const receipt = buildPolicyReceipt({
          invoice,
          intent: body.intent,
          decision,
          execution,
          vendor,
          paymentNumber: nextPaymentNumber(records),
          sessionPermissionId,
          now: now(),
        });
        await store.addPaymentRecord({
          execution_mode: executionMode,
          intent: body.intent,
          decision,
          execution,
          receipt,
        });
        return { status: "created" as const, execution, receipt };
      });

      if (outcome.status === "intent-conflict") {
        sendError(
          res,
          409,
          "INTENT_ID_CONFLICT",
          "This intent_id is already associated with a different payment intent.",
        );
        return;
      }
      if (outcome.status === "intent-mode-conflict") {
        sendError(
          res,
          409,
          "INTENT_MODE_CONFLICT",
          "This intent_id was already used in a different execution mode. Create a new payment intent before switching modes.",
        );
        return;
      }
      if (outcome.status === "invoice-not-found") {
        sendError(
          res,
          404,
          "INVOICE_NOT_FOUND",
          `Invoice ${body.intent.invoice_id} was not found.`,
        );
        return;
      }
      if (outcome.status === "invoice-mismatch") {
        sendError(
          res,
          409,
          "INTENT_INVOICE_MISMATCH",
          "Intent vendor, amount, or token does not match the original invoice.",
        );
        return;
      }
      if (outcome.status === "chain-not-ready") {
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account must provide a session-only executeTransfer runtime and a real permission ID. Set MOCK_CHAIN=1 for mock mode.",
        );
        return;
      }
      if (outcome.status === "chain-failed") {
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_FAILED",
          "The Smart Account transfer failed before a confirmed on-chain result was available.",
        );
        return;
      }
      if (outcome.status === "chain-invalid-response") {
        sendError(
          res,
          502,
          "CHAIN_INVALID_RESPONSE",
          "@pv/smart-account returned an invalid execution result.",
        );
        return;
      }
      if (outcome.status === "chain-unconfirmed") {
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_UNCONFIRMED",
          "No mined transaction receipt was available; the payment was not cached.",
        );
        return;
      }
      sendOk(res, {
        execution: outcome.execution,
        receipt: outcome.receipt,
      });
    }),
  );

  app.get(
    "/api/blast-radius",
    asyncHandler(async (_req, res) => {
      const [vendors, records] = await Promise.all([
        store.listVendors(),
        store.listPaymentRecords(),
      ]);
      const modeRecords = recordsForExecutionMode(records, executionMode);
      if (mockChain) {
        sendOk(
          res,
          buildMockBlastRadius(vendors, modeRecords, now(), config),
        );
        return;
      }

      let smartAccount: SmartAccountRuntime;
      try {
        smartAccount = await loadSmartAccountRuntime();
      } catch (error) {
        console.error("[api] smart-account module failed to load", error);
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account does not export readSessionPermission yet.",
        );
        return;
      }
      if (
        !smartAccount.readSessionPermission ||
        !expectedTokenAddress ||
        !/^0x[a-fA-F0-9]{40}$/.test(expectedTokenAddress)
      ) {
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "A valid USDC_ADDRESS is required to verify the on-chain permission.",
        );
        return;
      }

      try {
        const permission = sessionPermissionSchema.parse(
          await smartAccount.readSessionPermission(),
        );
        if (
          permission.allowed_token.toLowerCase() !==
          expectedTokenAddress.toLowerCase()
        ) {
          sendError(
            res,
            502,
            "CHAIN_PERMISSION_MISMATCH",
            "The on-chain session permission is configured for an unexpected token.",
          );
          return;
        }
        sendOk(
          res,
          buildPermissionBackedBlastRadius(
            permission,
            modeRecords,
            now(),
            config,
          ),
        );
      } catch (error) {
        console.error("[api] reading on-chain permission failed", error);
        sendError(
          res,
          502,
          "CHAIN_READ_FAILED",
          "The API could not read a valid session permission from the chain.",
        );
      }
    }),
  );

  app.get(
    "/api/receipts",
    asyncHandler(async (_req, res) => {
      const records = await store.listPaymentRecords();
      sendOk(
        res,
        recordsForExecutionMode(records, executionMode).map(
          (record) => record.receipt,
        ),
      );
    }),
  );

  app.get(
    "/api/receipts/:paymentId",
    asyncHandler(async (req, res) => {
      const params = parseWithSchema(receiptParamsSchema, req.params, res);
      if (!params) return;

      const records = await store.listPaymentRecords();
      const receipt = recordsForExecutionMode(records, executionMode).find(
        (record) => record.receipt.payment_id === params.paymentId,
      )?.receipt;
      if (!receipt) {
        sendError(
          res,
          404,
          "RECEIPT_NOT_FOUND",
          `Receipt ${params.paymentId} was not found.`,
        );
        return;
      }

      sendOk(res, receipt);
    }),
  );

  app.post(
    "/api/approvals/:intentId",
    asyncHandler(async (req, res) => {
      const params = parseWithSchema(approvalParamsSchema, req.params, res);
      if (!params) return;
      const body = parseWithSchema(approvalBodySchema, req.body, res);
      if (!body) return;

      const outcome = await serializePaymentMutation(async () => {
        const records = await store.listPaymentRecords();
        const modeRecords = recordsForExecutionMode(records, executionMode);
        const record = modeRecords.find(
          (candidate) => candidate.intent.intent_id === params.intentId,
        );
        if (!record) return { status: "missing" as const };
        if (record.receipt.policy_verdict !== "REVIEW") {
          return { status: "not-review" as const };
        }
        if (record.receipt.human_approval !== "PENDING") {
          return { status: "already-decided" as const };
        }
        if (body.approve) {
          const vendors = await store.listVendors();
          const currentDecision = evaluatePolicy(
            record.intent,
            vendors,
            modeRecords,
            now(),
            config,
          );
          if (currentDecision.verdict === "DENY") {
            return {
              status: "policy-changed" as const,
              denyReasons: currentDecision.deny_reasons,
            };
          }
        }

        let execution: ExecutionResult | undefined;
        let sessionPermissionId: string | undefined;
        if (body.approve && mockChain) {
          execution = buildMockSuccessfulExecution(record.intent.intent_id, now());
          sessionPermissionId = "SP-MOCK";
        } else if (body.approve) {
          let smartAccount: SmartAccountRuntime;
          try {
            smartAccount = await loadSmartAccountRuntime();
          } catch (error) {
            console.error("[api] smart-account module failed to load", error);
            return { status: "chain-not-ready" as const };
          }
          if (
            !smartAccount.executeTransfer ||
            !hasUsableSessionPermission(smartAccount)
          ) {
            return { status: "chain-not-ready" as const };
          }

          let rawExecution: unknown;
          try {
            rawExecution = await smartAccount.executeTransfer(record.intent);
          } catch (error) {
            console.error("[api] approved smart-account transfer failed", error);
            return { status: "chain-failed" as const };
          }
          const parsedExecution = parseChainExecution(
            rawExecution,
            record.intent.intent_id,
          );
          if (!parsedExecution) {
            console.error("[api] smart-account returned an invalid execution");
            return { status: "chain-invalid-response" as const };
          }
          if (!hasOnchainExecutionEvidence(parsedExecution)) {
            return { status: "chain-unconfirmed" as const };
          }
          execution = parsedExecution;
          sessionPermissionId = smartAccount.sessionPermissionId;
        }
        const receipt = await store.updateApproval(
          params.intentId,
          executionMode,
          body.approve ? "APPROVED" : "REJECTED",
          execution,
          sessionPermissionId,
        );
        return receipt
          ? { status: "updated" as const, receipt }
          : { status: "missing" as const };
      });

      if (outcome.status === "missing") {
        sendError(
          res,
          404,
          "INTENT_NOT_FOUND",
          `Intent ${params.intentId} has no payment receipt.`,
        );
        return;
      }
      if (outcome.status === "not-review") {
        sendError(
          res,
          409,
          "APPROVAL_NOT_ALLOWED",
          "Only a REVIEW receipt can receive a human approval decision.",
        );
        return;
      }
      if (outcome.status === "already-decided") {
        sendError(
          res,
          409,
          "APPROVAL_ALREADY_DECIDED",
          "This review receipt already has a human approval decision.",
        );
        return;
      }
      if (outcome.status === "chain-not-ready") {
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account must provide a session-only executeTransfer runtime and a real permission ID. Set MOCK_CHAIN=1 for mock mode.",
        );
        return;
      }
      if (outcome.status === "chain-failed") {
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_FAILED",
          "The approved Smart Account transfer failed before a confirmed on-chain result was available.",
        );
        return;
      }
      if (outcome.status === "chain-invalid-response") {
        sendError(
          res,
          502,
          "CHAIN_INVALID_RESPONSE",
          "@pv/smart-account returned an invalid execution result.",
        );
        return;
      }
      if (outcome.status === "chain-unconfirmed") {
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_UNCONFIRMED",
          "No mined transaction receipt was available; the approval remains pending.",
        );
        return;
      }
      if (outcome.status === "policy-changed") {
        sendError(
          res,
          409,
          "APPROVAL_POLICY_CHANGED",
          `Policy now denies this payment: ${outcome.denyReasons.join(", ")}.`,
        );
        return;
      }
      sendOk(res, outcome.receipt satisfies PolicyReceipt);
    }),
  );

  app.post(
    "/api/attack/direct-bypass",
    asyncHandler(async (req, res) => {
      const body = parseWithSchema(directBypassBodySchema, req.body, res);
      if (!body) return;

      if (mockChain) {
        sendOk(
          res,
          buildMockExecution(
            "DIRECT-BYPASS-MOCK",
            now(),
            "MOCK_CHAIN",
            `MOCK MODE: no transaction was submitted for ${body.amount_display} USDC to ${body.recipient}.`,
          ),
        );
        return;
      }

      if (!enableDirectBypass) {
        sendError(
          res,
          403,
          "DIRECT_BYPASS_DISABLED",
          "Set ENABLE_DIRECT_BYPASS=1 explicitly for the local on-chain attack demo.",
        );
        return;
      }

      let smartAccount: SmartAccountRuntime;
      try {
        smartAccount = await loadSmartAccountRuntime();
      } catch (error) {
        console.error("[api] smart-account module failed to load", error);
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account does not export executeRawTransferWithSessionKey yet.",
        );
        return;
      }
      if (
        !smartAccount.executeRawTransferWithSessionKey ||
        smartAccount.sessionKeyOnly !== true
      ) {
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account does not provide a session-only direct-bypass runtime.",
        );
        return;
      }

      let rawExecution: unknown;
      try {
        rawExecution = await smartAccount.executeRawTransferWithSessionKey(
          body.recipient,
          toRawAmount(body.amount_display),
        );
      } catch (error) {
        console.error("[api] direct bypass transaction failed", error);
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_FAILED",
          "The direct-bypass transaction failed before a confirmed on-chain result was available.",
        );
        return;
      }

      const execution = parseChainExecution(rawExecution);
      if (!execution) {
        sendError(
          res,
          502,
          "CHAIN_INVALID_RESPONSE",
          "@pv/smart-account returned an invalid direct-bypass result.",
        );
        return;
      }
      if (!hasOnchainExecutionEvidence(execution)) {
        sendError(
          res,
          502,
          "CHAIN_EXECUTION_UNCONFIRMED",
          "The direct-bypass attempt has no mined transaction receipt.",
        );
        return;
      }

      sendOk(res, execution);
    }),
  );

  app.use((_req, res) => {
    sendError(res, 404, "NOT_FOUND", "API route not found.");
  });

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const status =
        typeof error === "object" && error !== null && "status" in error
          ? (error as { status?: unknown }).status
          : undefined;
      if (error instanceof SyntaxError && status === 400) {
        sendError(res, 400, "VALIDATION_ERROR", "Request body is not valid JSON.");
        return;
      }
      if (status === 413) {
        sendError(res, 413, "PAYLOAD_TOO_LARGE", "Request body exceeds the 2 MB limit.");
        return;
      }

      console.error("[api] unhandled error", error);
      sendError(res, 500, "INTERNAL_ERROR", "The API could not complete the request.");
    },
  );

  return app;
}
