import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import {
  CreateReconciliationInvoiceDto,
  IngestStellarTransactionDto,
  ManualReconciliationDto,
} from "./dto/reconciliation.dto";
import {
  ReconciliationInvoice,
  ReconciliationInvoiceStatus,
} from "./entities/reconciliation-invoice.entity";
import {
  ReconciliationAudit,
  ReconciliationDecision,
} from "./entities/reconciliation-audit.entity";
import {
  StellarTransaction,
  StellarTransactionStatus,
} from "./entities/stellar-transaction.entity";

const SCALE = 7n;
const SCALE_FACTOR = 10n ** SCALE;

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private horizonCursor: string | undefined;

  constructor(
    @InjectRepository(ReconciliationInvoice)
    private readonly invoiceRepo: Repository<ReconciliationInvoice>,
    @InjectRepository(StellarTransaction)
    private readonly transactionRepo: Repository<StellarTransaction>,
    @InjectRepository(ReconciliationAudit)
    private readonly auditRepo: Repository<ReconciliationAudit>,
    private readonly configService: ConfigService
  ) {}

  async createInvoice(
    dto: CreateReconciliationInvoiceDto
  ): Promise<ReconciliationInvoice> {
    const existing = await this.invoiceRepo.findOne({
      where: { invoiceId: dto.invoiceId },
    });
    if (existing) return existing;

    const invoice = this.invoiceRepo.create({
      invoiceId: dto.invoiceId,
      expectedAmount: this.normalizeAmount(dto.expectedAmount),
      paidAmount: "0.0000000",
      assetCode: (dto.assetCode ?? "XLM").toUpperCase(),
      destinationAccount: dto.destinationAccount,
      paymentReference: dto.paymentReference,
      metadata: dto.metadata,
      status: ReconciliationInvoiceStatus.OPEN,
    });
    const saved = await this.invoiceRepo.save(invoice);
    const candidates = await this.transactionRepo.find({
      where: {
        destinationAccount: saved.destinationAccount,
        assetCode: saved.assetCode,
        status: StellarTransactionStatus.UNMATCHED,
      },
      order: { observedAt: "ASC" },
    });
    for (const transaction of candidates) {
      if (this.matchesInvoice(transaction, saved)) {
        await this.reconcileTransaction(
          transaction,
          "Invoice registered after payment"
        );
        await this.transactionRepo.save(transaction);
      }
    }
    return saved;
  }

  async ingestTransaction(
    dto: IngestStellarTransactionDto
  ): Promise<StellarTransaction> {
    const existing = await this.transactionRepo.findOne({
      where: { transactionId: dto.transactionId },
    });
    if (existing) {
      await this.writeAudit({
        transactionId: existing.transactionId,
        decision: ReconciliationDecision.RETRY,
        reason: "Duplicate transaction event ignored",
        attempt: 0,
        metadata: { idempotent: true },
      });
      return existing;
    }

    const transaction = this.transactionRepo.create({
      transactionId: dto.transactionId,
      ledger: dto.ledger,
      sourceAccount: dto.sourceAccount,
      destinationAccount: dto.destinationAccount,
      amount: this.normalizeAmount(dto.amount),
      assetCode: (dto.assetCode ?? "XLM").toUpperCase(),
      memo: dto.memo,
      paymentReference: dto.memo,
      observedAt: dto.observedAt ? new Date(dto.observedAt) : new Date(),
      rawPayload: dto.rawPayload,
      status: StellarTransactionStatus.UNMATCHED,
    });
    const saved = await this.transactionRepo.save(transaction);
    try {
      await this.reconcileTransaction(saved);
    } catch (error) {
      saved.status = StellarTransactionStatus.FAILED;
      saved.failureReason =
        error instanceof Error ? error.message : String(error);
      await this.writeAudit({
        transactionId: saved.transactionId,
        decision: ReconciliationDecision.FAILED,
        reason: saved.failureReason,
        attempt: 1,
        metadata: { retryable: true },
      });
    }
    return this.transactionRepo.save(saved);
  }

  async getTransaction(transactionId: string) {
    const transaction = await this.transactionRepo.findOne({
      where: { transactionId },
    });
    if (!transaction) {
      throw new NotFoundException(
        `Stellar transaction ${transactionId} not found`
      );
    }

    const audits = await this.auditRepo.find({
      where: { transactionId },
      order: { createdAt: "DESC" },
    });
    return { transaction, audits };
  }

  async getInvoice(invoiceId: string) {
    const invoice = await this.invoiceRepo.findOne({ where: { invoiceId } });
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    const audits = await this.auditRepo.find({
      where: { invoiceId },
      order: { createdAt: "DESC" },
    });
    return { invoice, audits };
  }

  async listUnmatched(limit = 50): Promise<StellarTransaction[]> {
    return this.transactionRepo.find({
      where: { status: StellarTransactionStatus.UNMATCHED },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async listAudits(invoiceId?: string, transactionId?: string) {
    const where: Record<string, string> = {};
    if (invoiceId) where.invoiceId = invoiceId;
    if (transactionId) where.transactionId = transactionId;
    return this.auditRepo.find({
      where,
      order: { createdAt: "DESC" },
      take: 200,
    });
  }

  async manualReconcile(invoiceId: string, dto: ManualReconciliationDto) {
    const invoice = await this.invoiceRepo.findOne({ where: { invoiceId } });
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    const candidates = await this.transactionRepo.find({
      where: {
        destinationAccount: invoice.destinationAccount,
        assetCode: invoice.assetCode,
        status: In([
          StellarTransactionStatus.UNMATCHED,
          StellarTransactionStatus.PARTIAL,
        ]),
      },
      order: { observedAt: "ASC" },
    });

    for (const transaction of candidates) {
      if (this.matchesInvoice(transaction, invoice)) {
        await this.reconcileTransaction(
          transaction,
          dto.note ?? "Manual retry"
        );
        await this.transactionRepo.save(transaction);
      }
    }

    return this.getInvoice(invoiceId);
  }

  async pollHorizon(): Promise<{ skipped?: boolean; ingested: number }> {
    const account = this.configService.get<string>(
      "STELLAR_RECONCILIATION_ACCOUNT"
    );
    if (!account) return { skipped: true, ingested: 0 };

    const baseUrl = this.configService.get<string>(
      "STELLAR_HORIZON_URL",
      "https://horizon-testnet.stellar.org"
    );
    const params = new URLSearchParams({ order: "asc", limit: "200" });
    if (this.horizonCursor) params.set("cursor", this.horizonCursor);

    try {
      const response = await fetch(
        `${baseUrl.replace(/\/$/, "")}/accounts/${account}/payments?${params}`
      );
      if (!response.ok) {
        throw new Error(`Horizon returned HTTP ${response.status}`);
      }

      const payload = (await response.json()) as {
        _embedded?: { records?: Array<Record<string, unknown>> };
      };
      const records = payload._embedded?.records ?? [];
      let ingested = 0;
      for (const record of records) {
        if (
          record.type !== "payment" ||
          typeof record.transaction_hash !== "string"
        ) {
          if (typeof record.paging_token === "string") {
            this.horizonCursor = record.paging_token;
          }
          continue;
        }

        await this.ingestTransaction({
          transactionId: record.transaction_hash,
          ledger:
            typeof record.ledger === "number" ||
            typeof record.ledger === "string"
              ? String(record.ledger)
              : undefined,
          sourceAccount:
            typeof record.from === "string" ? record.from : undefined,
          destinationAccount: String(record.to ?? ""),
          amount: String(record.amount ?? "0"),
          assetCode:
            record.asset_type === "native"
              ? "XLM"
              : String(record.asset_code ?? "XLM"),
          memo: typeof record.memo === "string" ? record.memo : undefined,
          rawPayload: record,
        });
        ingested += 1;
        if (typeof record.paging_token === "string") {
          this.horizonCursor = record.paging_token;
        }
      }
      return { ingested };
    } catch (error) {
      this.logger.warn(`Horizon polling failed: ${error.message}`);
      await this.writeAudit({
        decision: ReconciliationDecision.RETRY,
        reason: error.message,
        attempt: 1,
        metadata: { source: "horizon", retryable: true },
      });
      return { ingested: 0 };
    }
  }

  private async reconcileTransaction(
    transaction: StellarTransaction,
    reason?: string
  ): Promise<void> {
    const invoice = await this.invoiceRepo.findOne({
      where: { destinationAccount: transaction.destinationAccount },
      order: { createdAt: "ASC" },
    });

    if (!invoice || !this.matchesInvoice(transaction, invoice)) {
      transaction.status = StellarTransactionStatus.UNMATCHED;
      await this.writeAudit({
        invoiceId: invoice?.invoiceId,
        transactionId: transaction.transactionId,
        decision: ReconciliationDecision.UNMATCHED,
        reason:
          reason ?? "No invoice matched destination, asset, and reference",
        attempt: 0,
        metadata: { destinationAccount: transaction.destinationAccount },
      });
      return;
    }

    const paidUnits =
      this.toUnits(invoice.paidAmount) + this.toUnits(transaction.amount);
    const expectedUnits = this.toUnits(invoice.expectedAmount);
    const isPaid = paidUnits >= expectedUnits;
    invoice.paidAmount = this.fromUnits(paidUnits);
    invoice.status = isPaid
      ? ReconciliationInvoiceStatus.PAID
      : ReconciliationInvoiceStatus.PARTIAL;
    transaction.status = isPaid
      ? StellarTransactionStatus.MATCHED
      : StellarTransactionStatus.PARTIAL;
    await this.invoiceRepo.save(invoice);
    await this.writeAudit({
      invoiceId: invoice.invoiceId,
      transactionId: transaction.transactionId,
      decision: isPaid
        ? ReconciliationDecision.MATCHED
        : ReconciliationDecision.PARTIAL,
      reason:
        reason ?? (isPaid ? "Invoice fully paid" : "Invoice partially paid"),
      attempt: 0,
      metadata: {
        expectedAmount: invoice.expectedAmount,
        paidAmount: invoice.paidAmount,
        assetCode: invoice.assetCode,
      },
    });
  }

  private matchesInvoice(
    transaction: StellarTransaction,
    invoice: ReconciliationInvoice
  ): boolean {
    if (transaction.destinationAccount !== invoice.destinationAccount)
      return false;
    if (transaction.assetCode !== invoice.assetCode) return false;
    if (
      invoice.paymentReference &&
      invoice.paymentReference !== transaction.paymentReference
    ) {
      return false;
    }
    return true;
  }

  private async writeAudit(values: Partial<ReconciliationAudit>) {
    const audit = this.auditRepo.create(values);
    return this.auditRepo.save(audit);
  }

  private normalizeAmount(value: string): string {
    return this.fromUnits(this.toUnits(value));
  }

  private toUnits(value: string): bigint {
    const normalized = String(value).trim();
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new Error(`Invalid Stellar amount: ${value}`);
    }
    const [whole, fraction = ""] = normalized.split(".");
    return (
      BigInt(whole) * SCALE_FACTOR +
      BigInt(fraction.padEnd(Number(SCALE), "0").slice(0, Number(SCALE)))
    );
  }

  private fromUnits(units: bigint): string {
    const whole = units / SCALE_FACTOR;
    const fraction = (units % SCALE_FACTOR)
      .toString()
      .padStart(Number(SCALE), "0");
    return `${whole}.${fraction}`;
  }
}
