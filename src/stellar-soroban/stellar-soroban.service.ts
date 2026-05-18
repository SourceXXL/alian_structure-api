import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ContractDeployDto } from "./dto/deploy-contract.dto";
import { ContractInvokeDto } from "./dto/invoke-contract.dto";

@Injectable()
export class StellarSorobanService {
  private readonly logger = new Logger(StellarSorobanService.name);
  private readonly networkUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.networkUrl =
      this.configService.get<string>("SOROBAN_NETWORK_URL") ||
      "https://soroban-rpc.stellar.org";
  }

  getStatus() {
    return {
      module: "stellar-soroban",
      ready: true,
      networkUrl: this.networkUrl,
      message:
        "Standalone Stellar Soroban contract module is active in the mono-repo root.",
    };
  }

  async deployContract(dto: ContractDeployDto) {
    this.logger.log(`Deploying Soroban contract ${dto.contractName}`);

    return {
      contractId: `soroban-${dto.contractName
        .toLowerCase()
        .replace(/\s+/g, "-")}-${Date.now()}`,
      networkUrl: this.networkUrl,
      uploaded: true,
      metadata: {
        wasmHash: dto.wasmHash,
        description: dto.description ?? null,
      },
    };
  }

  async invokeContract(dto: ContractInvokeDto) {
    this.logger.log(
      `Invoking Soroban contract ${dto.contractId} function ${dto.functionName}`
    );

    return {
      contractId: dto.contractId,
      functionName: dto.functionName,
      args: dto.args ?? [],
      networkUrl: this.networkUrl,
      success: true,
      result: {
        code: 0,
        output: "ok",
      },
    };
  }
}
