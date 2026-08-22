import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import { RegisterModuleDto } from "src/modules/registry/dto/module-registry.dto";
import {
  ModuleEntity,
  ModuleStatus,
} from "src/modules/registry/entities/module.entity";
import { TenantModuleState } from "src/modules/registry/entities/tenant-module-state.entity";
import { ModuleLifecycle } from "src/modules/registry/interfaces/module-lifecycle.interface";
import { ModuleLifecycleLoader } from "src/modules/registry/module-lifecycle.loader";
import { ModuleRegistryModule } from "src/modules/registry/module-registry.module";
import { ModuleRegistryService } from "src/modules/registry/module-registry.service";

describe("ModuleRegistryService", () => {
  let testingModule: TestingModule;
  let service: ModuleRegistryService;
  let lifecycleLoader: ModuleLifecycleLoader;

  const registration = (
    version = "0.1.0",
    core = ">=0.1.0 <1.0.0",
    entryPoint = "test/example-lifecycle",
  ): RegisterModuleDto => ({
    manifest: {
      name: "test-grant-module",
      version,
      core,
      entryPoint,
      hooks: {
        onInstall: true,
        onUpgrade: true,
        onUninstall: false,
      },
    },
    description: "Test grant module",
    author: "Test contributor",
  });

  beforeEach(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "sqlite",
          database: ":memory:",
          dropSchema: true,
          synchronize: true,
          entities: [ModuleEntity, TenantModuleState],
        }),
        ModuleRegistryModule,
      ],
    }).compile();

    service = testingModule.get(ModuleRegistryService);
    lifecycleLoader = testingModule.get(ModuleLifecycleLoader);
  });

  afterEach(async () => {
    await testingModule.get(DataSource).destroy();
    await testingModule.close();
  });

  it("registers a compatible manifest and invokes onInstall", async () => {
    const lifecycle: ModuleLifecycle = {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    };
    lifecycleLoader.bind("test/example-lifecycle", lifecycle);

    const registered = await service.register(registration());

    expect(registered.name).toBe("test-grant-module");
    expect(registered.version).toBe("0.1.0");
    expect(registered.status).toBe(ModuleStatus.REGISTERED);
    expect(lifecycle.onInstall).toHaveBeenCalledTimes(1);
  });

  it("rejects a module whose core range is incompatible", async () => {
    await expect(
      service.register(registration("0.1.0", ">=9.0.0")),
    ).rejects.toThrow(
      new BadRequestException(
        'Module test-grant-module requires core version ">=9.0.0", but the running core version is "0.1.0"',
      ),
    );
  });

  it("rejects invalid semantic versions before loading lifecycle code", async () => {
    await expect(service.register(registration("not-semver"))).rejects.toThrow(
      "Invalid module manifest",
    );
  });

  it("rejects invalid core semantic-version ranges", async () => {
    await expect(
      service.register(registration("0.1.0", "not-a-range")),
    ).rejects.toThrow("Invalid module manifest");
  });

  it("rolls back registration when onInstall fails", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockRejectedValue(new Error("install failed")),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });

    await expect(service.register(registration())).rejects.toThrow(
      "install failed",
    );

    expect(
      await testingModule.get(DataSource).getRepository(ModuleEntity).count(),
    ).toBe(0);
  });

  it("enables and disables only the requested tenant state", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });
    const registered = await service.register(registration());

    const enabled = await service.enable(registered.id, {
      tenantId: "tenant-a",
      config: { mode: "demo" },
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.config).toEqual({ mode: "demo" });
    expect((await service.findOne(registered.id)).status).toBe(
      ModuleStatus.REGISTERED,
    );

    const disabled = await service.disable(registered.id, {
      tenantId: "tenant-a",
    });
    expect(disabled.enabled).toBe(false);
    expect(disabled.enabledAt).toBeNull();

    await service.enable(registered.id, {});
    expect((await service.findOne(registered.id)).status).toBe(
      ModuleStatus.ENABLED,
    );
  });

  it("resolves explicit tenant state before global and implicit defaults", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });
    const registered = await service.register(registration());

    await expect(
      service.resolveTenantState(registered.id, "tenant-a"),
    ).resolves.toEqual({
      moduleId: registered.id,
      tenantId: "tenant-a",
      stateId: null,
      enabled: false,
      config: null,
      source: "implicit",
    });

    await service.enable(registered.id, { config: { plan: "default" } });
    const inherited = await service.resolveTenantState(
      registered.id,
      "tenant-a",
    );
    expect(inherited).toMatchObject({
      enabled: true,
      config: { plan: "default" },
      source: "global",
    });

    await service.disable(registered.id, { tenantId: "tenant-a" });
    const overridden = await service.resolveTenantState(
      registered.id,
      "tenant-a",
    );
    expect(overridden).toMatchObject({
      enabled: false,
      config: null,
      source: "tenant",
    });
  });

  it("rechecks core compatibility before enabling a registered module", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });
    const registered = await service.register(registration());
    registered.coreCompatibilityRange = ">=9.0.0";
    await testingModule
      .get(DataSource)
      .getRepository(ModuleEntity)
      .save(registered);

    await expect(
      service.enable(registered.id, { tenantId: "tenant-a" }),
    ).rejects.toThrow(
      'Module test-grant-module requires core version ">=9.0.0", but the running core version is "0.1.0"',
    );
  });

  it("invokes onUpgrade with the previous and next versions", async () => {
    const lifecycle: ModuleLifecycle = {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    };
    lifecycleLoader.bind("test/example-lifecycle", lifecycle);
    await service.register(registration());

    const upgraded = await service.register(registration("0.2.0"));

    expect(upgraded.version).toBe("0.2.0");
    expect(lifecycle.onUpgrade).toHaveBeenCalledWith("0.1.0", "0.2.0");
  });

  it("rolls back the stored version when an upgrade hook fails", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });
    const registered = await service.register(registration());
    await service.enable(registered.id, {});
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockRejectedValue(new Error("upgrade failed")),
    });

    await expect(service.register(registration("0.2.0"))).rejects.toThrow(
      "upgrade failed",
    );

    const rolledBack = await service.findOne(registered.id);
    expect(rolledBack.version).toBe("0.1.0");
    expect(rolledBack.status).toBe(ModuleStatus.ENABLED);
  });

  it("invokes onUninstall when deregistering a disabled module", async () => {
    const lifecycle: ModuleLifecycle = {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
      onUninstall: jest.fn().mockResolvedValue(undefined),
    };
    lifecycleLoader.bind("test/example-lifecycle", lifecycle);
    const dto = registration();
    dto.manifest.hooks.onUninstall = true;
    const registered = await service.register(dto);

    await service.deregister(registered.id);

    expect(lifecycle.onUninstall).toHaveBeenCalledTimes(1);
    await expect(service.findOne(registered.id)).rejects.toThrow(
      `Module ${registered.id} not found`,
    );
  });

  it("keeps the module registered when onUninstall fails", async () => {
    const lifecycle: ModuleLifecycle = {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
      onUninstall: jest.fn().mockResolvedValue(undefined),
    };
    lifecycleLoader.bind("test/example-lifecycle", lifecycle);
    const dto = registration();
    dto.manifest.hooks.onUninstall = true;
    const registered = await service.register(dto);
    lifecycleLoader.bind("test/example-lifecycle", {
      ...lifecycle,
      onUninstall: jest.fn().mockRejectedValue(new Error("uninstall failed")),
    });

    await expect(service.deregister(registered.id)).rejects.toThrow(
      "uninstall failed",
    );
    await expect(service.findOne(registered.id)).resolves.toMatchObject({
      id: registered.id,
      version: "0.1.0",
    });
  });

  it("does not deregister a module enabled for any tenant", async () => {
    lifecycleLoader.bind("test/example-lifecycle", {
      onInstall: jest.fn().mockResolvedValue(undefined),
      onUpgrade: jest.fn().mockResolvedValue(undefined),
    });
    const registered = await service.register(registration());
    await service.enable(registered.id, { tenantId: "tenant-a" });

    await expect(service.deregister(registered.id)).rejects.toThrow(
      "cannot be deregistered while enabled",
    );
  });
});
