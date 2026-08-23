import { IsString, IsNotEmpty, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * DTO for signing a payload with a private key
 */
export class SignPayloadDto {
  @ApiProperty({
    description: "UUID of the payload to sign",
    example: "a1b2c3d4-1234-5678-90ef-ghijklmnopqr",
  })
  @IsString()
  @IsNotEmpty()
  payloadId: string;

  @ApiProperty({
    description:
      "Ethereum private key (0x-prefixed, 64 hex chars). NOTE: use client-side signing in production.",
    example:
      "0x4c0883a69102937d6231471b5dbb6e538eba2ef68e5fd63f36fe1ef7e9bb4d7f",
    pattern: "^0x[a-fA-F0-9]{64}$",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^0x[a-fA-F0-9]{64}$/, {
    message: "Private key must be a valid hex string with 0x prefix",
  })
  privateKey: string;
}
