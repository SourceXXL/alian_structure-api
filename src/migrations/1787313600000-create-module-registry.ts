import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateModuleRegistry1787313600000 implements MigrationInterface {
  name = "CreateModuleRegistry1787313600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "modules" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" varchar(128) NOT NULL,
        "version" varchar(64) NOT NULL,
        "description" text NOT NULL,
        "author" varchar(255) NOT NULL,
        "entryPoint" varchar(1024) NOT NULL,
        "coreCompatibilityRange" varchar(255) NOT NULL,
        "hooks" jsonb NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'registered'
          CHECK ("status" IN ('registered', 'enabled', 'disabled', 'deprecated')),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_modules_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "tenant_module_states" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenantId" varchar(255),
        "moduleId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "enabledAt" timestamp,
        "config" jsonb,
        CONSTRAINT "FK_tenant_module_states_module"
          FOREIGN KEY ("moduleId") REFERENCES "modules"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_tenant_module_states_tenant"
      ON "tenant_module_states" ("moduleId", "tenantId")
      WHERE "tenantId" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_tenant_module_states_global"
      ON "tenant_module_states" ("moduleId")
      WHERE "tenantId" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tenant_module_states_tenant_enabled"
      ON "tenant_module_states" ("tenantId", "enabled")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tenant_module_states"`);
    await queryRunner.query(`DROP TABLE "modules"`);
  }
}
