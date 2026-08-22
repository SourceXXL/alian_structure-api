"use strict";

/** @type {string[]} */
const exampleGrantModuleEvents = [];

/**
 * Runtime implementation of the registry's ModuleLifecycle contract.
 * The adjacent index.d.ts provides the compile-time TypeScript contract.
 */
class ExampleGrantModuleLifecycle {
  async onInstall() {
    exampleGrantModuleEvents.push("installed");
  }

  async onUpgrade(fromVersion, toVersion) {
    exampleGrantModuleEvents.push(`upgraded:${fromVersion}->${toVersion}`);
  }
}

module.exports = {
  default: ExampleGrantModuleLifecycle,
  exampleGrantModuleEvents,
};
