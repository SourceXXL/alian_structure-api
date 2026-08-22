import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ModuleEntity } from "src/modules/registry/entities/module.entity";
import { TenantModuleState } from "src/modules/registry/entities/tenant-module-state.entity";
import { ModuleLifecycleLoader } from "src/modules/registry/module-lifecycle.loader";
import { ModuleRegistryController } from "src/modules/registry/module-registry.controller";
import { ModuleRegistryService } from "src/modules/registry/module-registry.service";
import { ModuleManifestValidator } from "src/modules/registry/validation/module-manifest.validator";

@Module({
  imports: [TypeOrmModule.forFeature([ModuleEntity, TenantModuleState])],
  controllers: [ModuleRegistryController],
  providers: [
    ModuleRegistryService,
    ModuleLifecycleLoader,
    ModuleManifestValidator,
  ],
  exports: [ModuleRegistryService, ModuleLifecycleLoader],
})
export class ModuleRegistryModule {}
