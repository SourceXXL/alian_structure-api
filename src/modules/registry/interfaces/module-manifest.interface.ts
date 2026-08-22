export interface ModuleManifestHooks {
  onInstall: boolean;
  onUpgrade: boolean;
  onUninstall: boolean;
}

export interface ModuleManifest {
  name: string;
  version: string;
  core: string;
  hooks: ModuleManifestHooks;
  entryPoint: string;
}
