import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminRoleController } from "./admin-role.controller";
import { UserService } from "./user.service";
import { User } from "./entities/user.entity";
import { Role } from "src/common/guard/roles.enum";
import { RolesGuard } from "src/common/guard/roles.guard";
import { JwtAuthGuard } from "src/core/auth/guards/jwt-auth.guard";
import { AdminTwoFactorGuard } from "src/core/auth/guards/admin-two-factor.guard";

describe("AdminRoleController", () => {
  let controller: AdminRoleController;
  let userService: jest.Mocked<
    Pick<UserService, "assignRole" | "findOneOrFail">
  >;

  const makeUser = (role: Role): User =>
    ({ id: "user-1", role }) as unknown as User;

  beforeEach(async () => {
    userService = {
      assignRole: jest.fn(),
      findOneOrFail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminRoleController],
      providers: [{ provide: UserService, useValue: userService }],
    })
      // These are unit tests for the controller's logic; the guard behaviour
      // is covered by their own specs, so override them with pass-throughs
      // to avoid resolving their (auth-module) dependencies here.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminTwoFactorGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AdminRoleController>(AdminRoleController);
  });

  describe("listRoles", () => {
    it("returns every canonical role", () => {
      expect(controller.listRoles()).toEqual({ roles: Object.values(Role) });
    });
  });

  describe("getUserRole", () => {
    it("returns the target user's current role", async () => {
      userService.findOneOrFail.mockResolvedValue(makeUser(Role.OPERATOR));
      await expect(controller.getUserRole("user-1")).resolves.toEqual({
        id: "user-1",
        role: Role.OPERATOR,
      });
    });

    it("propagates NotFoundException for an unknown user", async () => {
      userService.findOneOrFail.mockRejectedValue(new NotFoundException());
      await expect(controller.getUserRole("nope")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("assignRole", () => {
    it("assigns the requested role and echoes the result", async () => {
      userService.assignRole.mockResolvedValue(makeUser(Role.ADMIN));
      await expect(
        controller.assignRole("user-1", { role: Role.ADMIN }),
      ).resolves.toEqual({ id: "user-1", role: Role.ADMIN });
      expect(userService.assignRole).toHaveBeenCalledWith("user-1", Role.ADMIN);
    });

    it("propagates BadRequestException for a conflicting role", async () => {
      userService.assignRole.mockRejectedValue(new BadRequestException());
      await expect(
        controller.assignRole("user-1", { role: Role.KYC_OPERATOR }),
      ).rejects.toThrow(BadRequestException);
    });

    it("propagates NotFoundException for an unknown user", async () => {
      userService.assignRole.mockRejectedValue(new NotFoundException());
      await expect(
        controller.assignRole("nope", { role: Role.ADMIN }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("resetRole", () => {
    it("resets the target user to the least-privileged USER role", async () => {
      userService.assignRole.mockResolvedValue(makeUser(Role.USER));
      await expect(controller.resetRole("user-1")).resolves.toEqual({
        id: "user-1",
        role: Role.USER,
      });
      expect(userService.assignRole).toHaveBeenCalledWith("user-1", Role.USER);
    });
  });
});
