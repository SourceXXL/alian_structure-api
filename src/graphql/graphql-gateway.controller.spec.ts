import { IS_PUBLIC_KEY } from "src/common/decorators/public.decorator";
import { GraphqlGatewayController } from "./graphql-gateway.controller";
import { GraphqlGatewayService } from "./graphql-gateway.service";

describe("GraphqlGatewayController", () => {
  it("forwards operations and remains protected by the global auth guard", async () => {
    const result = { data: { agentRating: { totalReviews: 0 } } };
    const gateway = { execute: jest.fn().mockResolvedValue(result) };
    const controller = new GraphqlGatewayController(
      gateway as unknown as GraphqlGatewayService,
    );
    const request = {
      query: 'query { agentRating(agentId: "a") { totalReviews } }',
    };

    await expect(controller.execute(request)).resolves.toBe(result);
    expect(gateway.execute).toHaveBeenCalledWith(request);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GraphqlGatewayController)).toBe(
      undefined,
    );
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        GraphqlGatewayController.prototype.execute,
      ),
    ).toBeUndefined();
  });
});
