import { Injectable, Logger } from "@nestjs/common";
import { DataSource, QueryRunner } from "typeorm";

export interface MigrationDefinition {
  name: string;
  up: (queryRunner: QueryRunner) => Promise<void>;
  down: (queryRunner: QueryRunner) => Promise<void>;
}

export interface MigrationHistory {
  id: number;
  timestamp: number;
  name: string;
}

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);
  private migrations: MigrationDefinition[] = [];

  register(migration: MigrationDefinition): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.name.localeCompare(b.name));
  }

  async runPending(dataSource: DataSource): Promise<void> {
    await this.ensureMigrationTable(dataSource);
    const applied = await this.getAppliedMigrations(dataSource);
    const pending = this.migrations.filter((m) => !applied.includes(m.name));

    if (pending.length === 0) {
      this.logger.log("No pending migrations");
      return;
    }

    this.logger.log(`Running ${pending.length} pending migration(s)`);
    for (const migration of pending) {
      const queryRunner = dataSource.createQueryRunner();
      try {
        await queryRunner.connect();
        await queryRunner.startTransaction();
        await migration.up(queryRunner);
        await queryRunner.query(
          `INSERT INTO migration_history ("timestamp", "name") VALUES (:timestamp, :name)`,
          { timestamp: Date.now(), name: migration.name } as any,
        );
        await queryRunner.commitTransaction();
        this.logger.log(`Migration applied: ${migration.name}`);
      } catch (error) {
        await queryRunner.rollbackTransaction();
        this.logger.error(`Migration failed: ${migration.name}`, error);
        throw error;
      } finally {
        await queryRunner.release();
      }
    }
  }

  async revertLast(dataSource: DataSource): Promise<void> {
    const applied = await this.getAppliedMigrations(dataSource);
    if (applied.length === 0) {
      this.logger.log("No migrations to revert");
      return;
    }

    const lastMigrationName = applied[applied.length - 1];
    const migration = this.migrations.find((m) => m.name === lastMigrationName);

    if (!migration) {
      throw new Error(`Migration definition not found: ${lastMigrationName}`);
    }

    const queryRunner = dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await migration.down(queryRunner);
      await queryRunner.query(
        `DELETE FROM migration_history WHERE name = :name`,
        { name: migration.name } as any,
      );
      await queryRunner.commitTransaction();
      this.logger.log(`Migration reverted: ${migration.name}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Revert failed: ${migration.name}`, error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getStatus(dataSource: DataSource): Promise<{
    total: number;
    applied: number;
    pending: number;
    history: MigrationHistory[];
  }> {
    await this.ensureMigrationTable(dataSource);
    const applied = await this.getAppliedMigrations(dataSource);
    const history = await this.getMigrationHistory(dataSource);
    return {
      total: this.migrations.length,
      applied: applied.length,
      pending: this.migrations.length - applied.length,
      history,
    };
  }

  private async ensureMigrationTable(dataSource: DataSource): Promise<void> {
    const queryRunner = dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        await queryRunner.query(`
          CREATE TABLE IF NOT EXISTS migration_history (
            id SERIAL PRIMARY KEY,
            "timestamp" BIGINT NOT NULL,
            "name" VARCHAR(255) NOT NULL UNIQUE
          );
        `);
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }
    } finally {
      await queryRunner.release();
    }
  }

  private async getAppliedMigrations(
    dataSource: DataSource,
  ): Promise<string[]> {
    const hasTable = await dataSource.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'migration_history'
      )`,
    );

    if (!hasTable?.[0]?.exists) {
      return [];
    }

    const result = await dataSource.query(
      `SELECT "name" FROM migration_history ORDER BY "timestamp" ASC`,
    );
    return result.map((row: any) => row.name);
  }

  private async getMigrationHistory(
    dataSource: DataSource,
  ): Promise<MigrationHistory[]> {
    const hasTable = await dataSource.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'migration_history'
      )`,
    );

    if (!hasTable?.[0]?.exists) {
      return [];
    }

    const result = await dataSource.query(
      `SELECT id, "timestamp", "name" FROM migration_history ORDER BY "timestamp" DESC`,
    );
    return result.map((row: any) => ({
      ...row,
      timestamp: Number(row.timestamp),
    }));
  }
}
