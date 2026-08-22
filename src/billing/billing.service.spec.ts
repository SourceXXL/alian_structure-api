import { register } from "../config/metrics";
import { BillingService } from "./billing.service";

describe("BillingService", () => {
  let service: BillingService;

  beforeEach(() => {
    service = new BillingService();
  });

  it("records usage once for an idempotency key and creates a mock invoice", () => {
    service.setPlan("acct-1", "starter");
    service.recordUsage("acct-1", {
      metric: "api_request",
      quantity: 10001,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });
    service.recordUsage("acct-1", {
      metric: "api_request",
      quantity: 10001,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });

    const invoice = service.createInvoicePreview("acct-1");
    expect(service.getUsage("acct-1")).toHaveLength(1);
    expect(invoice.subtotalCents).toBe(1901);
  });

  it("exports CSV and Stripe-compatible usage payloads", () => {
    service.recordUsage("acct-2", {
      metric: "compute",
      quantity: 3,
      tokenizedAccessId: "token-1",
    });
    expect(service.exportUsage("acct-2", "csv")).toContain(
      "account_id,metric,quantity",
    );
    expect(service.exportUsage("acct-2", "stripe").items[0]).toMatchObject({
      price: "metered_compute",
      quantity: 3,
    });
  });

  it("registers billing telemetry in the shared Prometheus registry", async () => {
    const output = await register.metrics();
    expect(output).toContain("alian_structure_billing_usage_units_total");
    expect(output).toContain("alian_structure_billing_estimated_charges_cents");
  });
});
