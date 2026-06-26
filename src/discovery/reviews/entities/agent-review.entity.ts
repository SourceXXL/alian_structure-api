import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum ReviewStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  FLAGGED = "flagged",
}

@Entity("agent_reviews")
@Index(["agentId", "userId"], { unique: true })
export class AgentReview {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  agentId: string;

  @Index()
  @Column()
  userId: string;

  /** 1–5 star rating */
  @Column({ type: "int" })
  rating: number;

  @Column({ type: "text", nullable: true })
  reviewText: string | null;

  /** Developer's response to this review */
  @Column({ type: "text", nullable: true })
  developerResponse: string | null;

  @Column({ type: "timestamp", nullable: true })
  developerRespondedAt: Date | null;

  @Column({ type: "varchar", default: ReviewStatus.PENDING })
  status: ReviewStatus;

  /** Spam/toxic score 0–1 from automated detection */
  @Column({ type: "decimal", precision: 5, scale: 4, default: 0 })
  spamScore: number;

  /** Moderation note set by admin */
  @Column({ type: "text", nullable: true })
  moderationNote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
