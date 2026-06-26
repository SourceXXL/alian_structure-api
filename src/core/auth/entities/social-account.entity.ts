import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from "typeorm";
import { User } from "src/core/user/entities/user.entity";

export enum SocialProvider {
  GOOGLE = "google",
  GITHUB = "github",
  TWITTER = "twitter",
}

@Entity("social_accounts")
@Unique(["provider", "providerUserId"])
export class SocialAccount {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  userId: string;

  @ManyToOne(() => User, (user) => user.socialAccounts, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "varchar" })
  provider: SocialProvider;

  @Column()
  providerUserId: string;

  @Column({ nullable: true })
  email: string | null;

  @Column({ nullable: true })
  displayName: string | null;

  @Column({ nullable: true })
  avatarUrl: string | null;

  @Column({ default: false })
  emailVerified: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
