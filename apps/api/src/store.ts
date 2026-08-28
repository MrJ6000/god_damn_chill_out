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

export interface StoredPaymentRecord {
  intent: PaymentIntent;
  decision: PolicyDecision;
  execution: ExecutionResult;
  receipt: PolicyReceipt;
}

export class JsonStore {
  constructor(private readonly dataDir: string) {}

  async listVendors(): Promise<Vendor[]> {
    return this.readJson<Vendor[]>("vendors.json");
  }

  async listInvoices(): Promise<Invoice[]> {
    return this.readJson<Invoice[]>("invoices.json");
  }

  async listPaymentRecords(): Promise<StoredPaymentRecord[]> {
    return this.readJson<StoredPaymentRecord[]>("payments.json");
  }

  async addPaymentRecord(record: StoredPaymentRecord): Promise<void> {
    const records = await this.listPaymentRecords();
    records.push(record);
    await this.writeJson("payments.json", records);
  }

  async updateApproval(
    intentId: string,
    humanApproval: PolicyReceipt["human_approval"],
    execution?: ExecutionResult,
  ): Promise<PolicyReceipt | null> {
    const records = await this.listPaymentRecords();
    const index = records.findIndex((record) => record.intent.intent_id === intentId);

    if (index < 0) return null;

    const record = records[index];
    const nextExecution = execution ?? record.execution;
    const receipt = {
      ...record.receipt,
      human_approval: humanApproval,
      execution: nextExecution,
      funds_moved_display:
        nextExecution.status === "EXECUTED"
          ? record.intent.amount_display
          : record.receipt.funds_moved_display,
    };
    records[index] = { ...record, execution: nextExecution, receipt };
    await this.writeJson("payments.json", records);
    return receipt;
  }

  private async readJson<T>(fileName: string): Promise<T> {
    const content = await readFile(path.join(this.dataDir, fileName), "utf8");
    return JSON.parse(content) as T;
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
