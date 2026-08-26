import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import * as crypto from "crypto";
import { ValueTransformer } from "typeorm";
import { User } from "src/core/user/entities/user.entity";

const ENCRYPTION_KEY = Buffer.from(
  process.env.GRANTFOX_ENCRYPTION_KEY || "",
  "hex",
);

// AES-256-GCM transformer for at-rest encryption of the refresh token.
// Stored format: base64(iv).base64(authTag).base64(ciphertext)
class EncryptedTokenTransformer implements ValueTransformer {
  to(value?: string | null): string | null {
    if (value == null) return null;
    if (!ENCRYPTION_KEY.length) {
      throw new Error("GRANTFOX_ENCRYPTION_KEY is not configured");
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return [
      iv.toString("base64"),
      authTag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".");
  }

  from(value?: string | null): string | null {
    if (value == null) return null;
    const [ivB64, tagB64, dataB64] = value.split(".");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      ENCRYPTION_KEY,
      Buffer.from(ivB64, "base64"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}



@Entity("grantfox_tokens")
@Index(["userId", "grantfoxUserId"], { unique: true })
export class GrantfoxToken {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  @Index()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user: User;

  /** The Grantfox-issued user/org identifier. */
  @Column()
  grantfoxUserId: string;

  /** The Grantfox org/project name, if applicable. */
  @Column({ nullable: true })
  grantfoxOrgName: string | null;

  /** Scoped permissions granted by Grantfox (JSON array). */
  @Column({ type: "simple-json", nullable: true })
  entitlements: string[] | null;

  /** Billing permissions granted by Grantfox (JSON array). */
  @Column({ type: "simple-json", nullable: true })
  billingPermissions: string[] | null;

  /** Short-lived access token (stored plaintext for quick lookup). */
  @Column()
  accessToken: string;

  /** Encrypted refresh token using AES-256-GCM. */
  @Column({
    type: "text",
    transformer: new EncryptedTokenTransformer(),
  })
  refreshToken: string;

  /** Access token expiration timestamp. */
  @Column({ type: "timestamp" })
  accessTokenExpiresAt: Date;

  /** Refresh token expiration timestamp. */
  @Column({ type: "timestamp" })
  refreshTokenExpiresAt: Date;

  /** Whether this token pair has been revoked. */
  @Column({ default: false })
  revoked: boolean;

  /** Timestamp when the token was revoked. */
  @Column({ type: "timestamp", nullable: true })
  revokedAt: Date | null;

  /** Reference to the token that replaced this one (rotation tracking). */
  @Column({ nullable: true })
  replacedByToken: string | null;

  /** The PKCE code verifier used during the initial authorization. */
  @Column({ nullable: true })
  codeVerifier: string | null;

  /** The OAuth state parameter for CSRF protection. */
  @Column({ nullable: true })
  oauthState: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
