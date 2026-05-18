import { IsArray, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class ContractInvokeDto {
  @IsString()
  @IsNotEmpty()
  contractId: string;

  @IsString()
  @IsNotEmpty()
  functionName: string;

  @IsOptional()
  @IsArray()
  args?: unknown[];
}
