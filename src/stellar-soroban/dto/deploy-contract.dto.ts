import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class ContractDeployDto {
  @IsString()
  @IsNotEmpty()
  contractName: string;

  @IsString()
  @IsNotEmpty()
  wasmHash: string;

  @IsString()
  @IsOptional()
  description?: string;
}
