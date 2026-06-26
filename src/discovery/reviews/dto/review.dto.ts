import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsString,
  IsOptional,
  Min,
  Max,
  MaxLength,
  IsUUID,
} from "class-validator";

export class CreateReviewDto {
  @ApiProperty({ description: "Agent ID being reviewed" })
  @IsUUID()
  agentId: string;

  @ApiProperty({ description: "Star rating 1–5", minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: "Written review text (max 2000 chars)" })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewText?: string;
}

export class DeveloperResponseDto {
  @ApiProperty({ description: "Developer's response text (max 1000 chars)" })
  @IsString()
  @MaxLength(1000)
  response: string;
}

export class ModerateReviewDto {
  @ApiProperty({ enum: ["approved", "rejected", "flagged"] })
  @IsString()
  status: "approved" | "rejected" | "flagged";

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moderationNote?: string;
}

export class ReviewQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agentId?: string;

  @ApiPropertyOptional({ enum: ["pending", "approved", "rejected", "flagged"] })
  @IsOptional()
  @IsString()
  status?: string;
}
