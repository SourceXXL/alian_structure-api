import { QueryRunner } from "typeorm";
import { CreateModuleRegistry1787313600000 } from "src/migrations/1787313600000-create-module-registry";

describe("CreateModuleRegistry1787313600000", () => {
  const queryRunner = {
    query: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueryRunner;
  const migration = new CreateModuleRegistry1787313600000();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates both registry tables, constraints, and tenant indexes", async () => {
    await migration.up(queryRunner);

    const sql = (queryRunner.query as jest.Mock).mock.calls
      .map(([statement]) => String(statement))
      .join("\n");
    expect(sql).toContain('CREATE TABLE "modules"');
    expect(sql).toContain('CREATE TABLE "tenant_module_states"');
    expect(sql).toContain('FOREIGN KEY ("moduleId")');
    expect(sql).toContain('"UQ_tenant_module_states_tenant"');
    expect(sql).toContain('"UQ_tenant_module_states_global"');
  });

  it("drops tenant state before its parent module table", async () => {
    await migration.down(queryRunner);

    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'DROP TABLE "tenant_module_states"',
    );
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      2,
      'DROP TABLE "modules"',
    );
  });
});
