import { IsIn } from "class-validator";

export class SetPlanDto {
  @IsIn(["free", "starter", "growth"])
  planId: string;
}
