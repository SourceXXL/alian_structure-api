import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { UserService } from "./user.service";
import { AssignRoleDto } from "./dto/assign-role.dto";
import { Role } from "src/common/guard/roles.enum";
import { Roles } from "src/common/guard/roles.decorator";
import { RolesGuard } from "src/common/guard/roles.guard";
import { JwtAuthGuard } from "src/core/auth/guards/jwt-auth.guard";
import { AdminTwoFactorGuard } from "src/core/auth/guards/admin-two-factor.guard";

/**
 * AdminRoleController — admin-only role management.
 *
 * Every route requires an authenticated admin whose session is 2FA-verified:
 *  - {@link JwtAuthGuard} populates `request.user` from the bearer token.
 *  - {@link RolesGuard} enforces `@Roles(Role.ADMIN)`.
 *  - {@link AdminTwoFactorGuard} enforces mandatory 2FA for admins.
 *
 * Role assignment is delegated to {@link UserService.assignRole}, which
 * validates the target user exists and rejects conflicting role pairs.
 */
@ApiTags("Admin — Role Management")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, AdminTwoFactorGuard)
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminRoleController {
  constructor(private readonly userService: UserService) {}

  @Get("roles")
  @ApiOperation({
    summary: "List assignable roles",
    description: "Returns the canonical set of roles that can be assigned.",
  })
  @ApiResponse({ status: 200, description: "List of assignable roles" })
  listRoles(): { roles: Role[] } {
    return { roles: Object.values(Role) };
  }

  @Get("users/:id/role")
  @ApiOperation({ summary: "Get a user's current role" })
  @ApiResponse({ status: 200, description: "The user's current role" })
  @ApiResponse({ status: 404, description: "User not found" })
  async getUserRole(
    @Param("id") id: string,
  ): Promise<{ id: string; role: Role }> {
    const user = await this.userService.findOneOrFail(id);
    return { id: user.id, role: user.role };
  }

  @Patch("users/:id/role")
  @ApiOperation({
    summary: "Assign a role to a user",
    description:
      "Assigns the given canonical role. Rejects conflicting role pairs " +
      "(e.g. GOVERNANCE_OPERATOR + KYC_OPERATOR) with 400.",
  })
  @ApiResponse({ status: 200, description: "Role assigned" })
  @ApiResponse({ status: 400, description: "Invalid or conflicting role" })
  @ApiResponse({ status: 404, description: "User not found" })
  async assignRole(
    @Param("id") id: string,
    @Body() dto: AssignRoleDto,
  ): Promise<{ id: string; role: Role }> {
    const user = await this.userService.assignRole(id, dto.role);
    return { id: user.id, role: user.role };
  }

  @Delete("users/:id/role")
  @ApiOperation({
    summary: "Reset a user's role",
    description: "Resets the user to the least-privileged USER role.",
  })
  @ApiResponse({ status: 200, description: "Role reset to USER" })
  @ApiResponse({ status: 404, description: "User not found" })
  async resetRole(
    @Param("id") id: string,
  ): Promise<{ id: string; role: Role }> {
    const user = await this.userService.assignRole(id, Role.USER);
    return { id: user.id, role: user.role };
  }
}
