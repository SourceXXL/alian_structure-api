import { ROLES_KEY } from "src/common/guard/roles.decorator";
import { Role } from "src/common/guard/roles.enum";
import { SKIP_KYC_KEY } from "src/common/decorators/skip-kyc.decorator";
import { ModuleRegistryController } from "src/modules/registry/module-registry.controller";

describe("ModuleRegistryController access policy", () => {
  it("requires an administrator while bypassing the incompatible KYC claim guard", () => {
    expect(Reflect.getMetadata(ROLES_KEY, ModuleRegistryController)).toEqual([
      Role.ADMIN,
    ]);
    expect(Reflect.getMetadata(SKIP_KYC_KEY, ModuleRegistryController)).toBe(
      true,
    );
  });
});
