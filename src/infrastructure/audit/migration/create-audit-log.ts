import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditLogTable1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "audit_logs_action_enum" AS ENUM (
        'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'ACCESS', 'EXPORT', 'PERMISSION_CHANGE'
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "userId" uuid,
        "action" "audit_logs_action_enum" NOT NULL,
        "resourceType" varchar(100),
        "resourceId" varchar(255),
        "ipAddress" varchar(45) NOT NULL,
        "userAgent" text,
        "details" text,
        "metadata" jsonb,
        "searchText" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "archivedAt" timestamptz
      );
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_audit_user_created" ON "audit_logs" ("userId", "createdAt");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_action_created" ON "audit_logs" ("action", "createdAt");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_ip_created" ON "audit_logs" ("ipAddress", "createdAt");`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_created" ON "audit_logs" ("createdAt");`,
    );

    // GIN index over a generated tsvector for sub-2s full-text search at 1M+ rows.
    await queryRunner.query(`
      CREATE INDEX "idx_audit_search_fts" ON "audit_logs"
      USING GIN (to_tsvector('english', "searchText"));
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_logs";`);
    await queryRunner.query(`DROP TYPE "audit_logs_action_enum";`);
  }
}