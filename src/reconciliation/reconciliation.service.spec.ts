import { ConfigService } from "@nestjs/config";
import {
  ReconciliationAudit,
  ReconciliationDecision,
} from "./entities/reconciliation-audit.entity";
import {
  ReconciliationInvoice,
  ReconciliationInvoiceStatus,
} from "./entities/reconciliation-invoice.entity";
import {
  StellarTransaction,
  StellarTransactionStatus,
} from "./entities/stellar-transaction.entity";
import { ReconciliationService } from "./reconciliation.service";

function repository<T>() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value: Partial<T>) => value as T),
    save: jest.fn(async (value: T) => value),
  };
}

describe("ReconciliationService", () => {
  const invoiceRepo = repository<ReconciliationInvoice>();
  const transactionRepo = repository<StellarTransaction>();
  const auditRepo = repository<ReconciliationAudit>();
  let service: ReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReconciliationService(
      invoiceRepo as any,
      transactionRepo as any,
      auditRepo as any,
      new ConfigService()
    );
  });

  it("creates an open invoice with normalized decimal amounts", async () => {
    invoiceRepo.findOne.mockResolvedValue(undefined);
    transactionRepo.find.mockResolvedValue([]);
    const invoice = await service.createInvoice({
      invoiceId: "INV-1",
      expectedAmount: "10.5",
      destinationAccount: "G".repeat(56),
      paymentReference: "order-1",
    });

    expect(invoice.expectedAmount).toBe("10.5000000");
    expect(invoice.paidAmount).toBe("0.0000000");
    expect(invoice.status).toBe(ReconciliationInvoiceStatus.OPEN);
    expect(invoiceRepo.save).toHaveBeenCalled();
  });

  it("marks an invoice paid when an exact matching transaction arrives", async () => {
    const invoice: ReconciliationInvoice = {
      invoiceId: "INV-1",
      expectedAmount: "10.0000000",
      paidAmount: "0.0000000",
      assetCode: "XLM",
      destinationAccount: "G".repeat(56),
      paymentReference: "order-1",
      status: ReconciliationInvoiceStatus.OPEN,
    } as ReconciliationInvoice;
    invoiceRepo.findOne.mockResolvedValue(invoice);
    transactionRepo.findOne.mockResolvedValue(undefined);
    auditRepo.create.mockImplementation(
      (value) => value as ReconciliationAudit
    );

    const transaction = await service.ingestTransaction({
      transactionId: "tx-1",
      destinationAccount: invoice.destinationAccount,
      amount: "10",
      memo: "order-1",
    });

    expect(transaction.status).toBe(StellarTransactionStatus.MATCHED);
    expect(invoice.status).toBe(ReconciliationInvoiceStatus.PAID);
    expect(invoice.paidAmount).toBe("10.0000000");
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ReconciliationDecision.MATCHED })
    );
  });

  it("marks an invoice partial until the expected amount is reached", async () => {
    const invoice: ReconciliationInvoice = {
      invoiceId: "INV-2",
      expectedAmount: "10.0000000",
      paidAmount: "4.0000000",
      assetCode: "XLM",
      destinationAccount: "G".repeat(56),
      paymentReference: "order-2",
      status: ReconciliationInvoiceStatus.OPEN,
    } as ReconciliationInvoice;
    invoiceRepo.findOne.mockResolvedValue(invoice);
    transactionRepo.findOne.mockResolvedValue(undefined);
    auditRepo.create.mockImplementation(
      (value) => value as ReconciliationAudit
    );

    const transaction = await service.ingestTransaction({
      transactionId: "tx-2",
      destinationAccount: invoice.destinationAccount,
      amount: "3.5",
      memo: "order-2",
    });

    expect(transaction.status).toBe(StellarTransactionStatus.PARTIAL);
    expect(invoice.status).toBe(ReconciliationInvoiceStatus.PARTIAL);
    expect(invoice.paidAmount).toBe("7.5000000");
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ReconciliationDecision.PARTIAL })
    );
  });

  it("keeps transactions unmatched when no invoice reference matches", async () => {
    invoiceRepo.findOne.mockResolvedValue(undefined);
    transactionRepo.findOne.mockResolvedValue(undefined);
    auditRepo.create.mockImplementation(
      (value) => value as ReconciliationAudit
    );

    const transaction = await service.ingestTransaction({
      transactionId: "tx-unmatched",
      destinationAccount: "G".repeat(56),
      amount: "1",
      memo: "unknown-order",
    });

    expect(transaction.status).toBe(StellarTransactionStatus.UNMATCHED);
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ decision: ReconciliationDecision.UNMATCHED })
    );
  });

  it("ignores duplicate transaction events and records an idempotent retry audit", async () => {
    const existing = {
      transactionId: "tx-duplicate",
      status: StellarTransactionStatus.MATCHED,
    } as StellarTransaction;
    transactionRepo.findOne.mockResolvedValue(existing);
    auditRepo.create.mockImplementation(
      (value) => value as ReconciliationAudit
    );

    const result = await service.ingestTransaction({
      transactionId: "tx-duplicate",
      destinationAccount: "G".repeat(56),
      amount: "1",
    });

    expect(result).toBe(existing);
    expect(transactionRepo.save).not.toHaveBeenCalled();
    expect(auditRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: ReconciliationDecision.RETRY,
        metadata: { idempotent: true },
      })
    );
  });

  it("bounds the unmatched dashboard result to 200 records", async () => {
    transactionRepo.find.mockResolvedValue([]);

    await service.listUnmatched(9999);

    expect(transactionRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );
  });
});
