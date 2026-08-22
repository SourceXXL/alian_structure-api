import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { Role } from "src/common/guard/roles.enum";

/**
 * Pairs of roles that are mutually exclusive and must never be held together.
 * ADMIN and KYC_OPERATOR are kept separate to preserve separation of duties:
 * the account that manages the platform must not also sign off on KYC reviews.
 */
const CONFLICTING_ROLE_PAIRS: [Role, Role][] = [
  [Role.ADMIN, Role.KYC_OPERATOR],
];

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  create(createUserDto: CreateUserDto) {
    return this.userRepository.save(createUserDto);
  }

  findAll() {
    return this.userRepository.find();
  }

  findOne(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  /** Fetch users in one query for request-scoped relationship loaders. */
  findManyByIds(ids: readonly string[]): Promise<User[]> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return Promise.resolve([]);
    return this.userRepository.find({ where: { id: In(uniqueIds) } });
  }

  /**
   * Like {@link findOne} but throws {@link NotFoundException} when the user
   * does not exist, so callers can rely on a non-null result.
   */
  async findOneOrFail(id: string): Promise<User> {
    const user = await this.findOne(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    await this.userRepository.update(id, updateUserDto);
    return this.findOne(id);
  }

  remove(id: string) {
    return this.userRepository.delete(id);
  }

  /**
   * Assign a role to a user. Enforces the mutually-exclusive role pairs in
   * {@link CONFLICTING_ROLE_PAIRS} — assigning a role that conflicts with the
   * user's current role throws a BadRequestException.
   */
  async assignRole(userId: string, newRole: Role): Promise<User> {
    const user = await this.findOneOrFail(userId);

    this.assertNoRoleConflict(user.role, newRole);

    user.role = newRole;
    return this.userRepository.save(user);
  }

  /**
   * Throws BadRequestException if assigning `newRole` to a user that
   * currently holds `currentRole` would create a conflicting pair.
   */
  assertNoRoleConflict(currentRole: Role, newRole: Role): void {
    if (currentRole === newRole) return;

    const conflict = CONFLICTING_ROLE_PAIRS.some(
      ([a, b]) =>
        (currentRole === a && newRole === b) ||
        (currentRole === b && newRole === a),
    );

    if (conflict) {
      throw new BadRequestException(
        `Role conflict: a user cannot hold both "${currentRole}" and "${newRole}". ` +
          `These roles are mutually exclusive to preserve separation of duties.`,
      );
    }
  }
}
