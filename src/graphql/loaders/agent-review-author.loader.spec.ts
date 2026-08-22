import { UserService } from "src/core/user/user.service";
import { AgentReviewAuthorLoader } from "./agent-review-author.loader";

describe("AgentReviewAuthorLoader", () => {
  const users = [
    { id: "user-1", username: "ada" },
    { id: "user-2", username: "grace" },
  ];

  it("batches authors into one service lookup and preserves key order", async () => {
    const userService = {
      findManyByIds: jest.fn().mockResolvedValue(users),
    } as unknown as UserService;
    const loader = new AgentReviewAuthorLoader(userService);

    const result = await Promise.all([
      loader.load("user-2"),
      loader.load("missing"),
      loader.load("user-1"),
    ]);

    expect(userService.findManyByIds).toHaveBeenCalledTimes(1);
    expect(userService.findManyByIds).toHaveBeenCalledWith([
      "user-2",
      "missing",
      "user-1",
    ]);
    expect(result).toEqual([users[1], null, users[0]]);
  });

  it("keeps DataLoader caches isolated between request-scoped instances", async () => {
    const userService = {
      findManyByIds: jest.fn().mockResolvedValue([users[0]]),
    } as unknown as UserService;
    const firstRequest = new AgentReviewAuthorLoader(userService);
    const secondRequest = new AgentReviewAuthorLoader(userService);

    await firstRequest.load("user-1");
    await firstRequest.load("user-1");
    await secondRequest.load("user-1");

    expect(userService.findManyByIds).toHaveBeenCalledTimes(2);
  });
});
