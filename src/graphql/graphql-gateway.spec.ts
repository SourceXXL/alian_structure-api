import { AgentReviewsService } from "src/discovery/reviews/agent-reviews.service";
import { UserService } from "src/core/user/user.service";
import { GraphqlGatewayService } from "./graphql-gateway.service";

describe("GraphQL gateway", () => {
  const review = {
    id: "550e8400-e29b-41d4-a716-446655440001",
    agentId: "agent-1",
    userId: "user-1",
    rating: 5,
    reviewText: "Reliable execution",
    developerResponse: null,
    developerRespondedAt: null,
    createdAt: new Date("2026-08-19T10:00:00.000Z"),
    updatedAt: new Date("2026-08-19T10:00:00.000Z"),
  };
  const reviewsService = {
    getApprovedReviewsConnection: jest.fn().mockResolvedValue({
      edges: [{ cursor: "opaque-cursor", node: review }],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: "opaque-cursor",
        endCursor: "opaque-cursor",
      },
    }),
    getAggregation: jest.fn().mockResolvedValue({
      agentId: "agent-1",
      averageRating: 5,
      totalReviews: 1,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
    }),
  };
  const userService = {
    findManyByIds: jest
      .fn()
      .mockResolvedValue([{ id: "user-1", username: "ada" }]),
  };
  let gateway: GraphqlGatewayService;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new GraphqlGatewayService(
      reviewsService as unknown as AgentReviewsService,
      userService as unknown as UserService,
    );
  });

  it("executes a typed paginated review query with a batched author", async () => {
    const response = await gateway.execute({
      query: `
        query Reviews($agentId: ID!, $first: Int!, $after: String) {
          agentReviews(agentId: $agentId, first: $first, after: $after) {
            edges {
              cursor
              node { id rating author { id username } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `,
      variables: { agentId: "agent-1", first: 20, after: null },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({
      agentReviews: {
        edges: [
          {
            cursor: "opaque-cursor",
            node: {
              id: review.id,
              rating: 5,
              author: { id: "user-1", username: "ada" },
            },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: "opaque-cursor" },
      },
    });
    expect(reviewsService.getApprovedReviewsConnection).toHaveBeenCalledWith(
      "agent-1",
      20,
      undefined,
    );
    expect(userService.findManyByIds).toHaveBeenCalledWith(["user-1"]);
  });

  it("executes the aggregate rating query", async () => {
    const response = await gateway.execute({
      query: `
        query Rating($agentId: ID!) {
          agentRating(agentId: $agentId) {
            averageRating
            totalReviews
            ratingDistribution { rating count }
          }
        }
      `,
      variables: { agentId: "agent-1" },
    });

    expect(response.errors).toBeUndefined();
    expect(response.data).toEqual({
      agentRating: {
        averageRating: 5,
        totalReviews: 1,
        ratingDistribution: [
          { rating: 1, count: 0 },
          { rating: 2, count: 0 },
          { rating: 3, count: 0 },
          { rating: 4, count: 0 },
          { rating: 5, count: 1 },
        ],
      },
    });
  });

  it("returns GraphQL validation errors without calling services", async () => {
    const response = await gateway.execute({ query: "query { unknownField }" });

    expect(response.errors?.[0].message).toContain("Cannot query field");
    expect(reviewsService.getAggregation).not.toHaveBeenCalled();
  });

  it("disables schema introspection in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const response = await gateway.execute({
        query: "query { __schema { queryType { name } } }",
      });

      expect(response.errors?.[0].message).toContain(
        "GraphQL introspection has been disabled",
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
