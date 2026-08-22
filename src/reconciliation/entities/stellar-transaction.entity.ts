import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/database/entities/base.entity";

export enum StellarTransactionStatus {
  UNMATCHED = "unmatched",
  PARTIAL = "partial",
  MATCHED = "matched",
  FAILED = "failed",
}

@Entity("stellar_reconciliation_transactions")
@Index(["transactionId"], { unique: true })
@Index(["status"])
@Index(["paymentReference"])
export class StellarTransaction extends BaseEntity {
  @Column({ type: "varchar", length: 128 })
  transactionId: string;

  @Column({ type: "bigint", nullable: true })
  ledger: string;

  @Column({ type: "varchar", length: 64, nullable: true })
  sourceAccount: string;

  @Column({ type: "varchar", length: 64 })
  destinationAccount: string;

  @Column({ type: "numeric", precision: 30, scale: 7 })
  amount: string;

  @Column({ type: "varchar", length: 12, default: "XLM" })
  assetCode: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  memo: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  paymentReference: string;

  @Column({
    type: "varchar",
    length: 16,
    default: StellarTransactionStatus.UNMATCHED,
  })
  status: StellarTransactionStatus;

  @Column({ type: "text", nullable: true })
  failureReason: string;

  @Column({ type: "timestamptz", nullable: true })
  observedAt: Date;

  @Column({ type: "jsonb", nullable: true })
  rawPayload: Record<string, unknown>;
}
