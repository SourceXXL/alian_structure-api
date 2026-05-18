import { Body, Controller, Get, Post } from "@nestjs/common";

import { StellarSorobanService } from "./stellar-soroban.service";
import { ContractDeployDto } from "./dto/deploy-contract.dto";
import { ContractInvokeDto } from "./dto/invoke-contract.dto";

@Controller("stellar-soroban")
export class StellarSorobanController {
  constructor(private readonly sorobanService: StellarSorobanService) {}

  @Get("status")
  status() {
    return this.sorobanService.getStatus();
  }

  @Post("deploy")
  deploy(@Body() dto: ContractDeployDto) {
    return this.sorobanService.deployContract(dto);
  }

  @Post("invoke")
  invoke(@Body() dto: ContractInvokeDto) {
    return this.sorobanService.invokeContract(dto);
  }
}
