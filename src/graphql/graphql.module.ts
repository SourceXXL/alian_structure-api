import { Module } from "@nestjs/common";
import { AgentReviewsModule } from "src/discovery/reviews/agent-reviews.module";
import { UserModule } from "src/core/user/user.module";
import { GraphqlGatewayController } from "./graphql-gateway.controller";
import { GraphqlGatewayService } from "./graphql-gateway.service";

@Module({
  imports: [AgentReviewsModule, UserModule],
  controllers: [GraphqlGatewayController],
  providers: [GraphqlGatewayService],
})
export class GraphqlGatewayModule {}
