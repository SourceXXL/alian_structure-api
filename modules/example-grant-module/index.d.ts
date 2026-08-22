import type { ModuleLifecycle } from "../../src/modules/registry/interfaces/module-lifecycle.interface";

export const exampleGrantModuleEvents: string[];

export default class ExampleGrantModuleLifecycle implements ModuleLifecycle {
  onInstall(): Promise<void>;
  onUpgrade(fromVersion: string, toVersion: string): Promise<void>;
}
