import { Injectable, NotFoundException } from "@nestjs/common";
import {
  billingEstimatedChargesCents,
  billingUsageUnits,
} from "../config/metrics";

export interface BillingPlan {
  id: string;
  name: string;
  monthlyPriceCents: number;
  includedUnits: number;
  unitPriceCents: number;
}

export interface UsageRecord {
  accountId: string;
  metric: string;
  quantity: number;
  tokenizedAccessId?: string;
  idempotencyKey?: string;
  recordedAt: string;
}

export interface InvoicePreview {
  accountId: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  subtotalCents: number;
  currency: "usd";
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPriceCents: number;
    amountCents: number;
  }>;
}

export interface StripeUsageExport {
  customer: string;
  items: Array<{
    price: string;
    quantity: number;
    timestamp: string;
    metadata?: { tokenizedAccessId: string };
  }>;
}

const PLANS: BillingPlan[] = [
  {
    id: "free",
    name: "Free",
    monthlyPriceCents: 0,
    includedUnits: 100,
    unitPriceCents: 0,
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPriceCents: 1900,
    includedUnits: 10000,
    unitPriceCents: 1,
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPriceCents: 9900,
    includedUnits: 100000,
    unitPriceCents: 1,
  },
];

@Injectable()
export class BillingService {
  private readonly accountPlans = new Map<string, string>();
  private readonly usage = new Map<string, UsageRecord[]>();
  private readonly idempotencyKeys = new Map<string, UsageRecord>();

  getPlans(): BillingPlan[] {
    return PLANS.map((plan) => ({ ...plan }));
  }

  setPlan(accountId: string, planId: string): BillingPlan {
    const plan = this.findPlan(planId);
    this.accountPlans.set(accountId, plan.id);
    return plan;
  }

  getPlan(accountId: string): BillingPlan {
    return this.findPlan(this.accountPlans.get(accountId) ?? "free");
  }

  recordUsage(
    accountId: string,
    input: Omit<UsageRecord, "accountId" | "recordedAt">,
  ): UsageRecord {
    const idempotencyKey = input.idempotencyKey
      ? `${accountId}:${input.idempotencyKey}`
      : undefined;
    if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
      return this.idempotencyKeys.get(idempotencyKey);
    }

    const record: UsageRecord = {
      ...input,
      accountId,
      recordedAt: new Date().toISOString(),
    };
    const records = this.usage.get(accountId) ?? [];
    records.push(record);
    this.usage.set(accountId, records);
    if (idempotencyKey) this.idempotencyKeys.set(idempotencyKey, record);

    billingUsageUnits.inc(
      { plan: this.getPlan(accountId).id, metric: input.metric },
      input.quantity,
    );
    return record;
  }

  getUsage(accountId: string): UsageRecord[] {
    return [...(this.usage.get(accountId) ?? [])];
  }

  createInvoicePreview(
    accountId: string,
    periodStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    periodEnd = new Date(),
  ): InvoicePreview {
    const plan = this.getPlan(accountId);
    const units = this.getUsage(accountId)
      .filter((record) => {
        const timestamp = new Date(record.recordedAt).getTime();
        return (
          timestamp >= periodStart.getTime() && timestamp <= periodEnd.getTime()
        );
      })
      .reduce((total, record) => total + record.quantity, 0);
    const overage = Math.max(0, units - plan.includedUnits);
    const overageCents = overage * plan.unitPriceCents;
    const lineItems = [
      {
        description: `${plan.name} monthly plan`,
        quantity: 1,
        unitPriceCents: plan.monthlyPriceCents,
        amountCents: plan.monthlyPriceCents,
      },
      ...(overage > 0
        ? [
            {
              description: "Metered usage overage",
              quantity: overage,
              unitPriceCents: plan.unitPriceCents,
              amountCents: overageCents,
            },
          ]
        : []),
    ];
    const subtotalCents = lineItems.reduce(
      (total, item) => total + item.amountCents,
      0,
    );
    billingEstimatedChargesCents.set({ plan: plan.id }, subtotalCents);
    return {
      accountId,
      planId: plan.id,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      subtotalCents,
      currency: "usd",
      lineItems,
    };
  }

  exportUsage(accountId: string, format: "stripe"): StripeUsageExport;
  exportUsage(accountId: string, format: "csv"): string;
  exportUsage(
    accountId: string,
    format: "csv" | "stripe",
  ): StripeUsageExport | string;
  exportUsage(
    accountId: string,
    format: "csv" | "stripe",
  ): StripeUsageExport | string {
    const records = this.getUsage(accountId);
    if (format === "stripe") {
      return {
        customer: accountId,
        items: records.map((record) => ({
          price: `metered_${record.metric}`,
          quantity: record.quantity,
          timestamp: record.recordedAt,
          metadata: record.tokenizedAccessId
            ? { tokenizedAccessId: record.tokenizedAccessId }
            : undefined,
        })),
      };
    }

    const rows = ["account_id,metric,quantity,recorded_at,tokenized_access_id"];
    rows.push(
      ...records.map((record) =>
        [
          accountId,
          record.metric,
          record.quantity,
          record.recordedAt,
          record.tokenizedAccessId ?? "",
        ]
          .map((value) => this.csv(value))
          .join(","),
      ),
    );
    return rows.join("\n");
  }

  private findPlan(planId: string): BillingPlan {
    const plan = PLANS.find((candidate) => candidate.id === planId);
    if (!plan) throw new NotFoundException(`Unknown billing plan: ${planId}`);
    return plan;
  }

  private csv(value: string | number): string {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
}
