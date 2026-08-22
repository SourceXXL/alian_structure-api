import { BadRequestException, Injectable } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ModuleManifestDto } from "src/modules/registry/dto/module-registry.dto";

@Injectable()
export class ModuleManifestValidator {
  async validate(manifest: unknown): Promise<ModuleManifestDto> {
    const candidate = plainToInstance(ModuleManifestDto, manifest);
    const errors = await validate(candidate, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });

    if (errors.length > 0) {
      const messages = errors.flatMap((error) => [
        ...Object.values(error.constraints ?? {}),
        ...(error.children ?? []).flatMap((child) =>
          Object.values(child.constraints ?? {}),
        ),
      ]);
      throw new BadRequestException({
        message: "Invalid module manifest",
        errors: messages,
      });
    }

    return candidate;
  }
}
