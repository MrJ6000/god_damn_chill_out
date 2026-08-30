import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ExecutionResult,
  Invoice,
  PaymentIntent,
  PolicyDecision,
  PolicyReceipt,
  Vendor,
} from "@pv/shared";
import {
  invoicesFileSchema,
  paymentRecordsFileSchema,
  vendorsFileSchema,
} from "./schemas.js";

export interface StoredPaymentRecord {
  execution_mode: "MOCK" | "REAL";
  intent: PaymentIntent;
  decision: PolicyDecision;
  execution: ExecutionResult;
  receipt: PolicyReceipt;
}

export class JsonStore {
  constructor(private readonly dataDir: string) {}

  async listVendors(): Promise<Vendor[]> {
    const value = await this.readJson("vendors.json");
    vendorsFileSchema.parse(value);
    return value as Vendor[];
  }

  async listInvoices(): Promise<Invoice[]> {
    const value = await this.readJson("invoices.json");
    // Validate without returning Zod's reconstructed object so JSON key order
    // remains identical for sha256(JSON.stringify(originalInvoice)).
    invoicesFileSchema.parse(value);
    return value as Invoice[];
  }

  async listPaymentRecords(): Promise<StoredPaymentRecord[]> {
    return paymentRecordsFileSchema.parse(await this.readJson("payments.json"));
  }

  async addPaymentRecord(record: StoredPaymentRecord): Promise<void> {
    const records = await this.listPaymentRecords();
    const nextRecords = paymentRecordsFileSchema.parse([...records, record]);
    await this.writeJson("payments.json", nextRecords);
  }

  async updateApproval(
    intentId: string,
    executionMode: StoredPaymentRecord["execution_mode"],
    humanApproval: PolicyReceipt["human_approval"],
    execution?: ExecutionResult,
    sessionPermissionId?: string,
  ): Promise<PolicyReceipt | null> {
    const records = await this.listPaymentRecords();
    const index = records.findIndex(
      (record) =>
        record.execution_mode === executionMode &&
        record.intent.intent_id === intentId,
    );

    if (index < 0) return null;

    const record = records[index];
    const nextExecution = execution ?? record.execution;
    const receipt = {
      ...record.receipt,
      human_approval: humanApproval,
      session_permission_id:
        sessionPermissionId ?? record.receipt.session_permission_id,
      execution: nextExecution,
      funds_moved_display:
        nextExecution.status === "EXECUTED"
          ? record.intent.amount_display
          : record.receipt.funds_moved_display,
    };
    records[index] = { ...record, execution: nextExecution, receipt };
    await this.writeJson(
      "payments.json",
      paymentRecordsFileSchema.parse(records),
    );
    return receipt;
  }

  private async readJson(fileName: string): Promise<unknown> {
    const content = await readFile(path.join(this.dataDir, fileName), "utf8");
    return JSON.parse(content) as unknown;
  }

  private async writeJson(fileName: string, value: unknown): Promise<void> {
    const target = path.join(this.dataDir, fileName);
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
