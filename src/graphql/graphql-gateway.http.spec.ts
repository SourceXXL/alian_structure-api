import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD, Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { StrategyAuthGuard } from "src/core/auth/guards/strategy-auth.guard";
import { StrategyRegistry } from "src/core/auth/strategies/strategy.registry";
import { GraphqlGatewayController } from "./graphql-gateway.controller";
import { GraphqlGatewayService } from "./graphql-gateway.service";

describe("GraphQL gateway HTTP contract", () => {
  let app: INestApplication;
  const execute = jest.fn();
  const validateToken = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [GraphqlGatewayController],
      providers: [
        { provide: GraphqlGatewayService, useValue: { execute } },
        {
          provide: StrategyRegistry,
          useValue: {
            getAll: () => [{ validateToken }],
          },
        },
        { provide: ConfigService, useValue: {} },
        Reflector,
        { provide: APP_GUARD, useClass: StrategyAuthGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    execute.mockResolvedValue({
      data: { agentRating: { agentId: "agent-1", totalReviews: 0 } },
    });
    validateToken.mockResolvedValue({
      sub: "user-1",
      role: "user",
      roles: ["user"],
      iat: 1,
      type: "traditional",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request at the documented endpoint", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/graphql")
      .send({
        query: 'query { agentRating(agentId: "agent-1") { totalReviews } }',
      })
      .expect(401);

    expect(execute).not.toHaveBeenCalled();
  });

  it("executes an authenticated request at the documented endpoint", async () => {
    const graphqlRequest = {
      query: 'query { agentRating(agentId: "agent-1") { totalReviews } }',
    };

    await request(app.getHttpServer())
      .post("/api/v1/graphql")
      .set("authorization", "Bearer valid-token")
      .send(graphqlRequest)
      .expect(200)
      .expect({
        data: { agentRating: { agentId: "agent-1", totalReviews: 0 } },
      });

    expect(validateToken).toHaveBeenCalledWith("valid-token");
    expect(execute).toHaveBeenCalledWith(graphqlRequest);
  });
});
