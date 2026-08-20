import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { Role } from "src/common/guard/roles.enum";

/**
 * RoleSeederService — idempotent RBAC bootstrap.
 *
 * On application start it ensures a single bootstrap administrator exists, so a
 * freshly provisioned deployment has at least one account that can reach the
 * admin role-management endpoints. Without this there would be no way to grant
 * the first ADMIN role through the API (every role-management route already
 * requires ADMIN).
 *
 * The bootstrap target is resolved from configuration:
 *   - ADMIN_BOOTSTRAP_EMAIL  — promote the user with this email, or
 *   - ADMIN_BOOTSTRAP_WALLET — promote the user with this wallet address.
 *
 * Behaviour is fully idempotent and non-destructive:
 *   - No config set        → no-op (nothing is seeded).
 *   - No matching user      → logged warning, no-op (we never create phantom
 *                             accounts or invent credentials).
 *   - User already ADMIN    → no-op.
 *   - User exists, non-admin → promoted to ADMIN.
 *
 * There is intentionally no migration here: the app runs on TypeORM
 * `synchronize: true` and role data is a single column on the users table, so a
 * runtime seeder is the pragmatic seam. If migration infrastructure is added
 * later, this promotion can move into a data migration unchanged.
 */
@Injectable()
export class RoleSeederService implements OnModuleInit {
  private readonly logger = new Logger(RoleSeederService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedBootstrapAdmin();
  }

  /**
   * Promote the configured bootstrap account to ADMIN if it exists and is not
   * already an admin. Safe to run on every boot.
   */
  async seedBootstrapAdmin(): Promise<void> {
    const email = this.configService
      .get<string>("ADMIN_BOOTSTRAP_EMAIL")
      ?.trim();
    const wallet = this.configService
      .get<string>("ADMIN_BOOTSTRAP_WALLET")
      ?.trim();

    if (!email && !wallet) {
      // No bootstrap target configured — nothing to seed.
      return;
    }

    const user = await this.userRepository.findOne({
      where: email ? { email } : { walletAddress: wallet!.toLowerCase() },
    });

    const target = email ?? wallet;

    if (!user) {
      this.logger.warn(
        `Bootstrap admin target "${target}" not found; skipping. ` +
          `Create the account first, then restart to promote it.`,
      );
      return;
    }

    if (user.role === Role.ADMIN) {
      this.logger.log(`Bootstrap admin "${target}" already has ADMIN role.`);
      return;
    }

    user.role = Role.ADMIN;
    await this.userRepository.save(user);
    this.logger.log(`Promoted bootstrap admin "${target}" to ADMIN role.`);
  }
}
