import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsSemVer,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsSemverRange } from "src/modules/registry/validation/semver-range.decorator";

export class ModuleManifestHooksDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  onInstall: boolean;

  @ApiProperty({ example: true })
  @IsBoolean()
  onUpgrade: boolean;

  @ApiProperty({ example: false })
  @IsBoolean()
  onUninstall: boolean;
}

export class ModuleManifestDto {
  @ApiProperty({ example: "example-grant-module" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/, {
    message:
      "name must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens",
  })
  name: string;

  @ApiProperty({ example: "1.2.0" })
  @IsSemVer()
  version: string;

  @ApiProperty({ example: ">=0.1.0 <1.0.0" })
  @IsNotEmpty()
  @IsSemverRange()
  core: string;

  @ApiProperty({ type: ModuleManifestHooksDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ModuleManifestHooksDto)
  hooks: ModuleManifestHooksDto;

  @ApiProperty({
    example: "modules/example-grant-module/index.cjs",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  @Matches(/^[a-zA-Z0-9@_./-]+$/, {
    message: "entryPoint contains unsupported characters",
  })
  entryPoint: string;
}

export class RegisterModuleDto {
  @ApiProperty({ type: ModuleManifestDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => ModuleManifestDto)
  manifest: ModuleManifestDto;

  @ApiProperty({ example: "A grant-funded example integration" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ example: "GrantFox contributor" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  author: string;
}

export class EnableModuleDto {
  @ApiPropertyOptional({
    example: "tenant-123",
    description: "Tenant key. Omit to update the global default module state.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  tenantId?: string;

  @ApiPropertyOptional({
    example: { featureFlag: true },
    description: "Optional settings isolated to this tenant or global default.",
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class DisableModuleDto {
  @ApiPropertyOptional({
    example: "tenant-123",
    description:
      "Tenant key. Omit to disable the module in the global default state.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  tenantId?: string;
}

export class ResolveModuleStateQueryDto {
  @ApiProperty({
    example: "tenant-123",
    description:
      "Tenant whose effective state should be resolved. An explicit tenant state overrides the global default.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  tenantId: string;
}
