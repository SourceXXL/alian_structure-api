import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/database/entities/base.entity";

export enum ReconciliationInvoiceStatus {
  OPEN = "open",
  PARTIAL = "partial",
  PAID = "paid",
  FAILED = "failed",
}

@Entity("reconciliation_invoices")
@Index(["invoiceId"], { unique: true })
@Index(["status"])
export class ReconciliationInvoice extends BaseEntity {
  @Column({ type: "varchar", length: 255 })
  invoiceId: string;

  @Column({ type: "numeric", precision: 30, scale: 7 })
  expectedAmount: string;

  @Column({ type: "numeric", precision: 30, scale: 7, default: "0" })
  paidAmount: string;

  @Column({ type: "varchar", length: 12, default: "XLM" })
  assetCode: string;

  @Column({ type: "varchar", length: 64 })
  destinationAccount: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  paymentReference: string;

  @Column({
    type: "varchar",
    length: 16,
    default: ReconciliationInvoiceStatus.OPEN,
  })
  status: ReconciliationInvoiceStatus;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown>;
}
