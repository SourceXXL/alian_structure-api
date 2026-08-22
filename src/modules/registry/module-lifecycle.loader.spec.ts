import { BadRequestException } from "@nestjs/common";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ModuleManifest } from "src/modules/registry/interfaces/module-manifest.interface";
import { ModuleLifecycleLoader } from "src/modules/registry/module-lifecycle.loader";

describe("ModuleLifecycleLoader", () => {
  const loader = new ModuleLifecycleLoader();
  const manifest = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        "modules/example-grant-module/module.manifest.json",
      ),
      "utf8",
    ),
  ) as ModuleManifest;

  it("loads the runtime example without a TypeScript require hook", async () => {
    const lifecycle = await loader.load(manifest);

    expect(typeof lifecycle.onInstall).toBe("function");
    expect(typeof lifecycle.onUpgrade).toBe("function");
  });

  it("rejects local entry points outside the modules directory", async () => {
    await expect(
      loader.load({
        ...manifest,
        entryPoint: "src/app.module",
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Local module entry points must remain inside the project "modules" directory',
      ),
    );
  });

  it("rejects hooks declared by a manifest but missing from its runtime", async () => {
    await expect(
      loader.load({
        ...manifest,
        hooks: { ...manifest.hooks, onUninstall: true },
      }),
    ).rejects.toThrow(
      "Manifest declares onUninstall, but the entry point does not implement it",
    );
  });
});
