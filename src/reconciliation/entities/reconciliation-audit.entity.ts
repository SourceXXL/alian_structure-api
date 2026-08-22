import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../common/database/entities/base.entity";

export enum ReconciliationDecision {
  MATCHED = "matched",
  PARTIAL = "partial",
  UNMATCHED = "unmatched",
  FAILED = "failed",
  RETRY = "retry",
}

@Entity("reconciliation_audits")
@Index(["invoiceId", "createdAt"])
@Index(["transactionId", "createdAt"])
export class ReconciliationAudit extends BaseEntity {
  @Column({ type: "varchar", length: 255, nullable: true })
  invoiceId: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  transactionId: string;

  @Column({ type: "varchar", length: 16 })
  decision: ReconciliationDecision;

  @Column({ type: "text", nullable: true })
  reason: string;

  @Column({ type: "integer", default: 0 })
  attempt: number;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown>;
}
