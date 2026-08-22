import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { ModuleEntity } from "src/modules/registry/entities/module.entity";

@Entity("tenant_module_states")
@Index("UQ_tenant_module_states_tenant", ["moduleId", "tenantId"], {
  unique: true,
  where: '"tenantId" IS NOT NULL',
})
@Index("UQ_tenant_module_states_global", ["moduleId"], {
  unique: true,
  where: '"tenantId" IS NULL',
})
@Index("IDX_tenant_module_states_tenant_enabled", ["tenantId", "enabled"])
export class TenantModuleState {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  tenantId: string | null;

  @Column({ type: "uuid" })
  moduleId: string;

  @Column({ type: "boolean", default: false })
  enabled: boolean;

  @Column({ nullable: true })
  enabledAt: Date | null;

  @Column({
    type: process.env.NODE_ENV === "test" ? "simple-json" : "jsonb",
    nullable: true,
  })
  config: Record<string, unknown> | null;

  @ManyToOne(
    () => ModuleEntity,
    (registryModule) => registryModule.tenantStates,
    {
      onDelete: "CASCADE",
    },
  )
  @JoinColumn({ name: "moduleId" })
  module: ModuleEntity;
}
