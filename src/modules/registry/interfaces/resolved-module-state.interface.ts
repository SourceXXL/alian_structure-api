export type ModuleStateSource = "tenant" | "global" | "implicit";

export interface ResolvedModuleState {
  moduleId: string;
  tenantId: string;
  stateId: string | null;
  enabled: boolean;
  config: Record<string, unknown> | null;
  source: ModuleStateSource;
}
