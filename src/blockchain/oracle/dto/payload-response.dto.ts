import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { PayloadStatus, PayloadType } from "../entities/signed-payload.entity";

/**
 * Response DTO for payload operations
 */
export class PayloadResponseDto {
  @ApiProperty({
    description: "Unique payload UUID",
    example: "a1b2c3d4-1234-5678-90ef-ghijklmnopqr",
  })
  id: string;

  @ApiProperty({
    description: "Type of payload",
    enum: PayloadType,
    example: PayloadType.PRICE_FEED,
  })
  payloadType: PayloadType;

  @ApiProperty({
    description: "Ethereum address that signed this payload",
    example: "0xAbCd1234567890abcdef1234567890abcdef1234",
  })
  signerAddress: string;

  @ApiProperty({ description: "Submission nonce", example: "42" })
  nonce: string;

  @ApiProperty({
    description: "Raw payload data",
    type: "object",
    example: { token: "ETH", price: 3200.5 },
  })
  payload: Record<string, any>;

  @ApiProperty({
    description: "Keccak256 hash of the payload",
    example: "0xabc123...",
  })
  payloadHash: string;

  @ApiProperty({
    description: "EIP-712 structured data hash",
    example: "0xdef456...",
  })
  structuredDataHash: string;

  @ApiPropertyOptional({
    description: "ECDSA signature (0x-prefixed, 132 chars)",
    nullable: true,
    example: "0x...",
  })
  signature: string | null;

  @ApiProperty({ description: "Payload expiry timestamp" })
  expiresAt: Date;

  @ApiProperty({
    description: "Current submission status",
    enum: PayloadStatus,
    example: PayloadStatus.PENDING,
  })
  status: PayloadStatus;

  @ApiPropertyOptional({
    description: "On-chain transaction hash after submission",
    nullable: true,
    example: "0x...",
  })
  transactionHash: string | null;

  @ApiPropertyOptional({
    description: "Block number when confirmed on-chain",
    nullable: true,
    example: "18500000",
  })
  blockNumber: string | null;

  @ApiProperty({
    description: "Total number of submission attempts",
    example: 1,
  })
  submissionAttempts: number;

  @ApiPropertyOptional({
    description: "Error message if submission failed",
    nullable: true,
  })
  errorMessage: string | null;

  @ApiPropertyOptional({
    description: "Optional metadata",
    nullable: true,
    type: "object",
  })
  metadata: Record<string, any> | null;

  @ApiProperty({ description: "Record creation timestamp" })
  createdAt: Date;

  @ApiProperty({ description: "Record last-updated timestamp" })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: "When submitted to blockchain",
    nullable: true,
  })
  submittedAt: Date | null;

  @ApiPropertyOptional({
    description: "When confirmed on-chain",
    nullable: true,
  })
  confirmedAt: Date | null;
}
