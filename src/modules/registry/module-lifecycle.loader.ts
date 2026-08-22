import { BadRequestException, Injectable } from "@nestjs/common";
import { relative, resolve, sep } from "path";
import { ModuleLifecycle } from "src/modules/registry/interfaces/module-lifecycle.interface";
import { ModuleManifest } from "src/modules/registry/interfaces/module-manifest.interface";

type LifecycleExport =
  | ModuleLifecycle
  | (new () => ModuleLifecycle)
  | { default?: LifecycleExport; lifecycle?: LifecycleExport };

@Injectable()
export class ModuleLifecycleLoader {
  private readonly bindings = new Map<string, ModuleLifecycle>();

  bind(entryPoint: string, lifecycle: ModuleLifecycle): void {
    this.bindings.set(entryPoint, lifecycle);
  }

  async load(manifest: ModuleManifest): Promise<ModuleLifecycle> {
    const boundLifecycle = this.bindings.get(manifest.entryPoint);
    if (boundLifecycle) {
      this.assertDeclaredHooks(manifest, boundLifecycle);
      return boundLifecycle;
    }

    const reference = this.resolveReference(manifest.entryPoint);
    let imported: LifecycleExport;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      imported = require(reference) as LifecycleExport;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Unable to load module entry point "${manifest.entryPoint}": ${reason}`,
      );
    }

    const lifecycle = this.instantiate(imported);
    this.assertDeclaredHooks(manifest, lifecycle);
    return lifecycle;
  }

  private resolveReference(entryPoint: string): string {
    if (entryPoint.startsWith("src/")) {
      throw new BadRequestException(
        'Local module entry points must remain inside the project "modules" directory',
      );
    }

    const isLocalReference =
      entryPoint.startsWith(".") ||
      entryPoint.startsWith("/") ||
      entryPoint.startsWith("modules/");

    if (!isLocalReference) {
      return entryPoint;
    }

    const projectRoot = resolve(process.cwd());
    const moduleRoot = resolve(projectRoot, "modules");
    const absoluteReference = resolve(projectRoot, entryPoint);
    const relativeReference = relative(moduleRoot, absoluteReference);

    if (
      relativeReference.startsWith("..") ||
      relativeReference === "" ||
      relativeReference.includes(`..${sep}`)
    ) {
      throw new BadRequestException(
        'Local module entry points must remain inside the project "modules" directory',
      );
    }

    return absoluteReference;
  }

  private instantiate(exported: LifecycleExport): ModuleLifecycle {
    let candidate: LifecycleExport = exported;

    if (typeof candidate === "object" && candidate !== null) {
      const namespace = candidate as {
        default?: LifecycleExport;
        lifecycle?: LifecycleExport;
      };
      candidate = namespace.default ?? namespace.lifecycle ?? candidate;
    }

    if (typeof candidate === "function") {
      return new candidate();
    }

    if (typeof candidate !== "object" || candidate === null) {
      throw new BadRequestException(
        "Module entry point must export a lifecycle object or class",
      );
    }

    return candidate as ModuleLifecycle;
  }

  private assertDeclaredHooks(
    manifest: ModuleManifest,
    lifecycle: ModuleLifecycle,
  ): void {
    const declaredHooks = Object.entries(manifest.hooks).filter(
      ([, enabled]) => enabled,
    );

    for (const [hook] of declaredHooks) {
      if (typeof lifecycle[hook as keyof ModuleLifecycle] !== "function") {
        throw new BadRequestException(
          `Manifest declares ${hook}, but the entry point does not implement it`,
        );
      }
    }
  }
}
