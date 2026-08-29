import { fileURLToPath } from "node:url";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { planPayments } from "@pv/agent";
import type {
  ApiErr,
  ApiOk,
  ExecutionResult,
  PolicyReceipt,
} from "@pv/shared";
import { toRawAmount } from "@pv/shared";
import type { output, ZodTypeAny } from "zod";
import {
  buildMockBlastRadius,
  buildMockExecution,
  buildMockReceipt,
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
  paymentExecuteBodySchema,
  policyEvaluateBodySchema,
  receiptParamsSchema,
} from "./schemas.js";
import { JsonStore } from "./store.js";

const defaultDataDir = fileURLToPath(new URL("../../../data", import.meta.url));

export interface CreateAppOptions {
  dataDir?: string;
  now?: () => Date;
  mockAgent?: boolean;
  mockChain?: boolean;
  webOrigin?: string;
  config?: Partial<RuntimeConfig>;
}

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

      if (!mockAgent) {
        sendError(
          res,
          503,
          "AGENT_INTEGRATION_NOT_READY",
          "@pv/agent currently provides only MOCK MODE. Set MOCK_AGENT=1 for the mock contract.",
        );
        return;
      }

      const vendors = await store.listVendors();
      try {
        const plan = await planPayments({
          instruction: body.instruction,
          invoices: body.invoices,
          vendorContext: vendors.map(({ display_name, status }) => ({
            display_name,
            status,
          })),
        });
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
        evaluatePolicy(body.intent, vendors, records, now(), config),
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
      const invoice = invoices.find(
        (candidate) => candidate.invoice_id === body.intent.invoice_id,
      );
      if (!invoice) {
        sendError(
          res,
          404,
          "INVOICE_NOT_FOUND",
          `Invoice ${body.intent.invoice_id} was not found.`,
        );
        return;
      }
      const intentMatchesInvoice =
        body.intent.vendor_name.toLowerCase() === invoice.vendor.toLowerCase() &&
        body.intent.amount_display === invoice.amount &&
        body.intent.amount_raw === toRawAmount(invoice.amount) &&
        body.intent.token === invoice.currency;
      if (!intentMatchesInvoice) {
        sendError(
          res,
          409,
          "INTENT_INVOICE_MISMATCH",
          "Intent vendor, amount, or token does not match the original invoice.",
        );
        return;
      }

      const outcome = await serializePaymentMutation(async () => {
        const records = await store.listPaymentRecords();

        // Never trust the client-provided decision. Re-evaluate on the server.
        const decision = evaluatePolicy(
          body.intent,
          vendors,
          records,
          now(),
          config,
        );
        let execution: ExecutionResult;

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
          return null;
        }

        const vendor = vendors.find(
          (candidate) =>
            candidate.verified &&
            candidate.display_name.toLowerCase() ===
            body.intent.vendor_name.toLowerCase(),
        );
        const receipt = buildMockReceipt({
          invoice,
          intent: body.intent,
          decision,
          execution,
          vendor,
          paymentNumber: records.length + 1,
          now: now(),
        });
        await store.addPaymentRecord({
          intent: body.intent,
          decision,
          execution,
          receipt,
        });
        return { execution, receipt };
      });

      if (!outcome) {
        sendError(
          res,
          503,
          "CHAIN_INTEGRATION_NOT_READY",
          "@pv/smart-account does not export executeTransfer yet. Set MOCK_CHAIN=1 for the mock contract.",
        );
        return;
      }
      sendOk(res, outcome);
    }),
  );

  app.get(
    "/api/blast-radius",
    asyncHandler(async (_req, res) => {
      const [vendors, records] = await Promise.all([
        store.listVendors(),
        store.listPaymentRecords(),
      ]);
      sendOk(res, buildMockBlastRadius(vendors, records, now(), config));
    }),
  );

  app.get(
    "/api/receipts",
    asyncHandler(async (_req, res) => {
      const records = await store.listPaymentRecords();
      sendOk(
        res,
        records.map((record) => record.receipt),
      );
    }),
  );

  app.get(
    "/api/receipts/:paymentId",
    asyncHandler(async (req, res) => {
      const params = parseWithSchema(receiptParamsSchema, req.params, res);
      if (!params) return;

      const records = await store.listPaymentRecords();
      const receipt = records.find(
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
        const record = records.find(
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
            records,
            now(),
            config,
          );
          if (currentDecision.verdict === "DENY") {
            return {
              status: "policy-changed" as const,
              denyReasons: currentDecision.deny_reasons,
            };
          }
          if (!mockChain) {
            return { status: "chain-not-ready" as const };
          }
        }

        const execution = body.approve
          ? buildMockSuccessfulExecution(record.intent.intent_id, now())
          : undefined;
        const receipt = await store.updateApproval(
          params.intentId,
          body.approve ? "APPROVED" : "REJECTED",
          execution,
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
          "@pv/smart-account does not export executeTransfer yet. Set MOCK_CHAIN=1 for the mock contract.",
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

  app.post("/api/attack/direct-bypass", (req, res) => {
    const body = parseWithSchema(directBypassBodySchema, req.body, res);
    if (!body) return;

    if (!mockChain) {
      sendError(
        res,
        503,
        "CHAIN_INTEGRATION_NOT_READY",
        "@pv/smart-account does not export executeRawTransferWithSessionKey yet. Set MOCK_CHAIN=1 for the mock contract.",
      );
      return;
    }

    sendOk(
      res,
      buildMockExecution(
        "DIRECT-BYPASS-MOCK",
        now(),
        "MOCK_CHAIN",
        `MOCK MODE: no UserOperation was submitted for ${body.amount_display} USDC to ${body.recipient}.`,
      ),
    );
  });

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
