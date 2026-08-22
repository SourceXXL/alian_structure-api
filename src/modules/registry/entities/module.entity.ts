import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { ModuleManifestHooks } from "src/modules/registry/interfaces/module-manifest.interface";
import { TenantModuleState } from "src/modules/registry/entities/tenant-module-state.entity";

export enum ModuleStatus {
  REGISTERED = "registered",
  ENABLED = "enabled",
  DISABLED = "disabled",
  DEPRECATED = "deprecated",
}

@Entity("modules")
@Index(["name"], { unique: true })
export class ModuleEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 128 })
  name: string;

  @Column({ type: "varchar", length: 64 })
  version: string;

  @Column({ type: "text" })
  description: string;

  @Column({ type: "varchar", length: 255 })
  author: string;

  @Column({ type: "varchar", length: 1024 })
  entryPoint: string;

  @Column({ type: "varchar", length: 255 })
  coreCompatibilityRange: string;

  @Column({
    type: process.env.NODE_ENV === "test" ? "simple-json" : "jsonb",
  })
  hooks: ModuleManifestHooks;

  @Column({
    type: "varchar",
    length: 32,
    enum: ModuleStatus,
    default: ModuleStatus.REGISTERED,
  })
  status: ModuleStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => TenantModuleState, (state) => state.module)
  tenantStates: TenantModuleState[];
}
