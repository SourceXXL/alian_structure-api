import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { readFileSync } from "fs";
import { join } from "path";
import { gt, satisfies } from "semver";
import { DataSource, EntityManager, IsNull, Repository } from "typeorm";
import {
  DisableModuleDto,
  EnableModuleDto,
  RegisterModuleDto,
} from "src/modules/registry/dto/module-registry.dto";
import {
  ModuleEntity,
  ModuleStatus,
} from "src/modules/registry/entities/module.entity";
import { TenantModuleState } from "src/modules/registry/entities/tenant-module-state.entity";
import { ModuleLifecycleLoader } from "src/modules/registry/module-lifecycle.loader";
import { ModuleManifestValidator } from "src/modules/registry/validation/module-manifest.validator";
import { ResolvedModuleState } from "src/modules/registry/interfaces/resolved-module-state.interface";

@Injectable()
export class ModuleRegistryService {
  private readonly logger = new Logger(ModuleRegistryService.name);
  private readonly coreVersion = this.readCoreVersion();

  constructor(
    @InjectRepository(ModuleEntity)
    private readonly moduleRepository: Repository<ModuleEntity>,
    @InjectRepository(TenantModuleState)
    private readonly tenantStateRepository: Repository<TenantModuleState>,
    private readonly dataSource: DataSource,
    private readonly manifestValidator: ModuleManifestValidator,
    private readonly lifecycleLoader: ModuleLifecycleLoader,
  ) {}

  async register(dto: RegisterModuleDto): Promise<ModuleEntity> {
    const manifest = await this.manifestValidator.validate(dto.manifest);
    this.assertCompatible(manifest.name, manifest.core);
    const lifecycle = await this.lifecycleLoader.load(manifest);

    return this.runInTransaction(
      `register ${manifest.name}`,
      async (manager) => {
        const repository = manager.getRepository(ModuleEntity);
        const existing = await repository.findOne({
          where: { name: manifest.name },
        });

        if (!existing) {
          const registryModule = repository.create({
            name: manifest.name,
            version: manifest.version,
            description: dto.description,
            author: dto.author,
            entryPoint: manifest.entryPoint,
            coreCompatibilityRange: manifest.core,
            hooks: manifest.hooks,
            status: ModuleStatus.REGISTERED,
          });
          const saved = await repository.save(registryModule);

          if (manifest.hooks.onInstall) {
            await lifecycle.onInstall!();
          }

          this.logger.log(
            `Registered module ${saved.name}@${saved.version} (${saved.id})`,
          );
          return saved;
        }

        if (!gt(manifest.version, existing.version)) {
          throw new ConflictException(
            `Module ${manifest.name}@${existing.version} is already registered; an upgrade must use a newer version`,
          );
        }

        const previousVersion = existing.version;
        if (manifest.hooks.onUpgrade) {
          await lifecycle.onUpgrade!(previousVersion, manifest.version);
        }

        existing.version = manifest.version;
        existing.description = dto.description;
        existing.author = dto.author;
        existing.entryPoint = manifest.entryPoint;
        existing.coreCompatibilityRange = manifest.core;
        existing.hooks = manifest.hooks;
        const upgraded = await repository.save(existing);
        this.logger.log(
          `Upgraded module ${upgraded.name} from ${previousVersion} to ${upgraded.version}`,
        );
        return upgraded;
      },
    );
  }

  async findAll(): Promise<ModuleEntity[]> {
    return this.moduleRepository.find({
      relations: { tenantStates: true },
      order: { name: "ASC" },
    });
  }

  async findOne(id: string): Promise<ModuleEntity> {
    const registryModule = await this.moduleRepository.findOne({
      where: { id },
      relations: { tenantStates: true },
    });

    if (!registryModule) {
      throw new NotFoundException(`Module ${id} not found`);
    }

    return registryModule;
  }

  async resolveTenantState(
    id: string,
    tenantId: string,
  ): Promise<ResolvedModuleState> {
    const registryModule = await this.moduleRepository.findOne({
      where: { id },
    });
    if (!registryModule) {
      throw new NotFoundException(`Module ${id} not found`);
    }

    const [tenantState, globalState] = await Promise.all([
      this.tenantStateRepository.findOne({
        where: { moduleId: id, tenantId },
      }),
      this.tenantStateRepository.findOne({
        where: { moduleId: id, tenantId: IsNull() },
      }),
    ]);
    const effectiveState = tenantState ?? globalState;

    return {
      moduleId: id,
      tenantId,
      stateId: effectiveState?.id ?? null,
      enabled: effectiveState?.enabled ?? false,
      config: effectiveState?.config ?? null,
      source: tenantState ? "tenant" : globalState ? "global" : "implicit",
    };
  }

  async enable(id: string, dto: EnableModuleDto): Promise<TenantModuleState> {
    return this.runInTransaction(`enable ${id}`, async (manager) => {
      const moduleRepository = manager.getRepository(ModuleEntity);
      const registryModule = await moduleRepository.findOne({ where: { id } });
      if (!registryModule) {
        throw new NotFoundException(`Module ${id} not found`);
      }

      this.assertCompatible(
        registryModule.name,
        registryModule.coreCompatibilityRange,
      );

      const tenantId = dto.tenantId ?? null;
      const stateRepository = manager.getRepository(TenantModuleState);
      let state = await stateRepository.findOne({
        where: {
          moduleId: id,
          tenantId: tenantId === null ? IsNull() : tenantId,
        },
      });

      if (!state) {
        state = stateRepository.create({
          moduleId: id,
          tenantId,
          enabled: true,
          enabledAt: new Date(),
          config: dto.config ?? null,
        });
      } else {
        state.enabled = true;
        state.enabledAt = new Date();
        if (dto.config !== undefined) {
          state.config = dto.config;
        }
      }

      if (tenantId === null) {
        registryModule.status = ModuleStatus.ENABLED;
        await moduleRepository.save(registryModule);
      }

      const saved = await stateRepository.save(state);
      this.logger.log(
        `Enabled module ${registryModule.name} for ${tenantId ?? "global default"}`,
      );
      return saved;
    });
  }

  async disable(id: string, dto: DisableModuleDto): Promise<TenantModuleState> {
    return this.runInTransaction(`disable ${id}`, async (manager) => {
      const moduleRepository = manager.getRepository(ModuleEntity);
      const registryModule = await moduleRepository.findOne({ where: { id } });
      if (!registryModule) {
        throw new NotFoundException(`Module ${id} not found`);
      }

      const tenantId = dto.tenantId ?? null;
      const stateRepository = manager.getRepository(TenantModuleState);
      let state = await stateRepository.findOne({
        where: {
          moduleId: id,
          tenantId: tenantId === null ? IsNull() : tenantId,
        },
      });

      if (!state) {
        state = stateRepository.create({
          moduleId: id,
          tenantId,
          enabled: false,
          enabledAt: null,
          config: null,
        });
      } else {
        state.enabled = false;
        state.enabledAt = null;
      }

      if (tenantId === null) {
        registryModule.status = ModuleStatus.DISABLED;
        await moduleRepository.save(registryModule);
      }

      const saved = await stateRepository.save(state);
      this.logger.log(
        `Disabled module ${registryModule.name} for ${tenantId ?? "global default"}`,
      );
      return saved;
    });
  }

  async deregister(id: string): Promise<void> {
    await this.runInTransaction(`deregister ${id}`, async (manager) => {
      const moduleRepository = manager.getRepository(ModuleEntity);
      const registryModule = await moduleRepository.findOne({ where: { id } });
      if (!registryModule) {
        throw new NotFoundException(`Module ${id} not found`);
      }

      const stateRepository = manager.getRepository(TenantModuleState);
      const enabledStateCount = await stateRepository.count({
        where: { moduleId: id, enabled: true },
      });
      if (enabledStateCount > 0) {
        throw new ConflictException(
          `Module ${registryModule.name} cannot be deregistered while enabled for any tenant or the global default`,
        );
      }

      const lifecycle = await this.lifecycleLoader.load({
        name: registryModule.name,
        version: registryModule.version,
        core: registryModule.coreCompatibilityRange,
        hooks: registryModule.hooks,
        entryPoint: registryModule.entryPoint,
      });
      if (registryModule.hooks.onUninstall) {
        await lifecycle.onUninstall!();
      }

      await stateRepository.delete({ moduleId: id });
      await moduleRepository.remove(registryModule);
      this.logger.log(
        `Deregistered module ${registryModule.name}@${registryModule.version}`,
      );
    });
  }

  private assertCompatible(moduleName: string, requiredRange: string): void {
    if (
      !satisfies(this.coreVersion, requiredRange, { includePrerelease: true })
    ) {
      throw new BadRequestException(
        `Module ${moduleName} requires core version "${requiredRange}", but the running core version is "${this.coreVersion}"`,
      );
    }
  }

  private readCoreVersion(): string {
    try {
      const packageJson = JSON.parse(
        readFileSync(join(process.cwd(), "package.json"), "utf8"),
      ) as { version?: string };
      if (!packageJson.version) {
        throw new Error("package.json does not define a version");
      }
      return packageJson.version;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Unable to determine the running core version: ${reason}`,
      );
    }
  }

  private async runInTransaction<T>(
    operation: string,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.dataSource.transaction(work);
    } catch (error) {
      const reason = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `Module lifecycle transaction failed: ${operation}`,
        reason,
      );
      throw error;
    }
  }
}
