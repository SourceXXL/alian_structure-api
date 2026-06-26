import { SocialAccount } from "src/core/auth/entities/social-account.entity";
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { ProvenanceRecord } from "src/infrastructure/audit/entities/provenance-record.entity";
import { Wallet } from "src/core/auth/entities/wallet.entity";

export enum UserRole {
  USER = "user",
  KYC_OPERATOR = "kyc_operator",
  ADMIN = "admin",
}

export enum KycStatus {
  UNVERIFIED = "unverified",
  PENDING = "pending",
  IN_REVIEW = "in_review",
  VERIFIED = "verified",
  REJECTED = "rejected",
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true, nullable: true })
  username: string | null;

  @Column({ unique: true, nullable: false })
  walletAddress: string;

  @Column({ unique: true, nullable: true })
  email: string | null;

  @Column({ nullable: true })
  password: string | null;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({
    type: "varchar",
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({
    type: "varchar",
    default: KycStatus.UNVERIFIED,
  })
  kycStatus: KycStatus;

  @Column({ default: false })
  isActive: boolean;

  @Column({ type: "timestamp", nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Provenance records associated with this user
   */
  @OneToMany(() => ProvenanceRecord, (provenance) => provenance.user)
  provenanceRecords: ProvenanceRecord[];

  /**
   * Wallets linked to this user account
   */
  @OneToMany(() => Wallet, (wallet) => wallet.user)
  wallets: Wallet[];

  @Column({ unique: true, nullable: true })
  referralCode: string | null;

  @Column({ nullable: true })
  referredById: string | null;

  @ManyToOne(() => User, (user) => user.referrals)
  @JoinColumn({ name: "referredById" })
  referredBy: User | null;

  /**
   * Wallets linked to this user account
   */

  @OneToMany(() => User, (user) => user.referredBy)
  referrals: User[];

  @OneToMany(() => SocialAccount, (social) => social.user)
  socialAccounts: SocialAccount[];
}
