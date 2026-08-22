export interface ModuleLifecycle {
  onInstall?(): Promise<void>;
  onUpgrade?(fromVersion: string, toVersion: string): Promise<void>;
  onUninstall?(): Promise<void>;
}
