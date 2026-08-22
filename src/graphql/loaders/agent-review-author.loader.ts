import DataLoader from "dataloader";
import { UserService } from "src/core/user/user.service";
import { User } from "src/core/user/entities/user.entity";

export type ReviewAuthor = Pick<User, "id" | "username">;

/**
 * One instance is created per GraphQL request, so cached author data cannot
 * cross request or authentication boundaries.
 */
export class AgentReviewAuthorLoader {
  private readonly byId = new DataLoader<string, ReviewAuthor | null>(
    async (ids) => {
      const users = await this.userService.findManyByIds(ids);
      const usersById = new Map(users.map((user) => [user.id, user]));
      return ids.map((id) => {
        const user = usersById.get(id);
        return user ? { id: user.id, username: user.username } : null;
      });
    },
  );

  constructor(private readonly userService: UserService) {}

  load(userId: string): Promise<ReviewAuthor | null> {
    return this.byId.load(userId);
  }
}
