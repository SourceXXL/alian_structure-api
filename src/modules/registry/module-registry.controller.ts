import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  DisableModuleDto,
  EnableModuleDto,
  RegisterModuleDto,
  ResolveModuleStateQueryDto,
} from "src/modules/registry/dto/module-registry.dto";
import { ModuleRegistryService } from "src/modules/registry/module-registry.service";
import { Roles } from "src/common/guard/roles.decorator";
import { Role } from "src/common/guard/roles.enum";
import { SkipKyc } from "src/common/decorators/skip-kyc.decorator";

@ApiTags("Modules")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "Authentication required" })
@ApiResponse({ status: 403, description: "Administrator role required" })
@Roles(Role.ADMIN)
@SkipKyc()
@Controller("modules")
export class ModuleRegistryController {
  constructor(private readonly registryService: ModuleRegistryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Register or upgrade a module",
    description:
      "A new name installs a module; submitting a higher version for an existing name performs an upgrade.",
  })
  @ApiResponse({ status: 201, description: "Module registered or upgraded" })
  @ApiResponse({ status: 400, description: "Invalid or incompatible manifest" })
  @ApiResponse({ status: 409, description: "Version is not newer" })
  async register(@Body() dto: RegisterModuleDto) {
    return { module: await this.registryService.register(dto) };
  }

  @Get()
  @ApiOperation({ summary: "List registered modules and tenant states" })
  async findAll() {
    return { modules: await this.registryService.findAll() };
  }

  @Get(":id/state")
  @ApiOperation({
    summary: "Resolve a tenant's effective module state",
    description:
      "Returns the explicit tenant state when present, otherwise the global default, otherwise an implicit disabled state.",
  })
  @ApiParam({ name: "id", description: "Module UUID" })
  @ApiResponse({ status: 200, description: "Effective module state" })
  @ApiResponse({ status: 404, description: "Module not found" })
  async resolveTenantState(
    @Param("id", ParseUUIDPipe) id: string,
    @Query() query: ResolveModuleStateQueryDto,
  ) {
    return {
      state: await this.registryService.resolveTenantState(id, query.tenantId),
    };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get module details" })
  @ApiParam({ name: "id", description: "Module UUID" })
  @ApiResponse({ status: 404, description: "Module not found" })
  async findOne(@Param("id", ParseUUIDPipe) id: string) {
    return { module: await this.registryService.findOne(id) };
  }

  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Enable a module for one tenant",
    description:
      "Only the requested tenant state changes. Omitting tenantId updates the global default state.",
  })
  @ApiParam({ name: "id", description: "Module UUID" })
  @ApiResponse({ status: 200, description: "Tenant module state enabled" })
  @ApiResponse({ status: 400, description: "Module is incompatible with core" })
  async enable(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: EnableModuleDto,
  ) {
    return { state: await this.registryService.enable(id, dto) };
  }

  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Disable a module for one tenant",
    description:
      "Only the requested tenant state changes. Omitting tenantId updates the global default state.",
  })
  @ApiParam({ name: "id", description: "Module UUID" })
  @ApiResponse({ status: 200, description: "Tenant module state disabled" })
  async disable(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DisableModuleDto,
  ) {
    return { state: await this.registryService.disable(id, dto) };
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Deregister a module that is disabled everywhere" })
  @ApiParam({ name: "id", description: "Module UUID" })
  @ApiResponse({ status: 204, description: "Module deregistered" })
  @ApiResponse({ status: 409, description: "Module is still enabled" })
  async deregister(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    await this.registryService.deregister(id);
  }
}
