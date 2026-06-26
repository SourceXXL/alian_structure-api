import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ValueTransformer,
} from "typeorm";
import * as crypto from "crypto";

const ENCRYPTION_KEY = Buffer.from(
  process.env.AUDIT_LOG_ENCRYPTION_KEY || "",
  "hex",
);

// AES-256-GCM transformer for at-rest encryption of sensitive columns.
// Stored format: base64(iv).base64(authTag).base64(ciphertext)
class EncryptedTransformer implements ValueTransformer {
  to(value?: string | null): string | null {
    if (value == null) return null;
    if (!ENCRYPTION_KEY.length) {
      throw new Error("AUDIT_LOG_ENCRYPTION_KEY is not configured");
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

export enum AuditLogAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
  LOGIN = "LOGIN",
  LOGOUT = "LOGOUT",
  ACCESS = "ACCESS",
  EXPORT = "EXPORT",
  PERMISSION_CHANGE = "PERMISSION_CHANGE",
}

@Entity("audit_logs")
@Index(["userId", "createdAt"])
@Index(["action", "createdAt"])
@Index(["ipAddress", "createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", nullable: true })
  @Index()
  userId: string | null;

  @Column({ type: "enum", enum: AuditLogAction })
  @Index()
  action: AuditLogAction;

  @Column({ type: "varchar", length: 100, nullable: true })
  resourceType: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  resourceId: string | null;

  @Column({ type: "varchar", length: 45 })
  ipAddress: string;

  @Column({ type: "text", nullable: true })
  userAgent: string | null;

  // Encrypted at rest: may contain PII or sensitive request/response context.
  @Column({ type: "text", nullable: true, transformer: new EncryptedTransformer() })
  details: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata: Record<string, unknown> | null;

  // Materialized search text, kept in sync by the service layer and indexed
  // via a GIN(to_tsvector) index created in the migration.
  @Column({ type: "text" })
  searchText: string;

  @CreateDateColumn()
  @Index()
  createdAt: Date;

  @Column({ type: "timestamptz", nullable: true })
  archivedAt: Date | null;
}