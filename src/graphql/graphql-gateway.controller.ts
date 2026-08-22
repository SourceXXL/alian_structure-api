import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController } from "@nestjs/swagger";
import {
  GraphqlGatewayService,
  GraphqlRequest,
} from "./graphql-gateway.service";

@ApiExcludeController()
@ApiBearerAuth()
@Controller("graphql")
export class GraphqlGatewayController {
  constructor(private readonly gateway: GraphqlGatewayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  execute(@Body() request: GraphqlRequest) {
    return this.gateway.execute(request);
  }
}
