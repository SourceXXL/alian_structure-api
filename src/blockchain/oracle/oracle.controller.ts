import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { OracleService } from "./services/oracle.service";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { CreatePayloadDto } from "./dto/create-payload.dto";
import { SignPayloadDto } from "./dto/sign-payload.dto";
import { SubmitPayloadDto } from "./dto/submit-payload.dto";
import { VerifySignatureDto } from "./dto/verify-signature.dto";
import { PayloadResponseDto } from "./dto/payload-response.dto";
import { PayloadStatus } from "./entities/signed-payload.entity";

/**
 * Controller for Oracle service endpoints
 * Handles payload creation, signing, and submission
 */
@ApiTags("Oracle")
@Controller("oracle")
export class OracleController {
  private readonly logger = new Logger(OracleController.name);

  constructor(private readonly oracleService: OracleService) {}

  /**
   * Create a new payload to be signed
   * Requires authentication
   */
  @Post("payloads")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Create a new payload",
    description:
      "Create a new payload ready for signing. Requires JWT authentication.",
  })
  @ApiResponse({
    status: 201,
    description: "Payload created",
    type: PayloadResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid payload data" })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async createPayload(
    @Request() req,
    @Body() createPayloadDto: CreatePayloadDto,
  ): Promise<PayloadResponseDto> {
    const signerAddress = req.user.address;
    this.logger.log(
      `Creating payload for ${signerAddress}, type: ${createPayloadDto.payloadType}`,
    );

    return this.oracleService.createPayload(signerAddress, createPayloadDto);
  }

  /**
   * Sign a payload with a private key
   * Note: In production, this should be done client-side for security
   * This endpoint is provided for convenience during development/testing
   */
  @Post("payloads/:id/sign")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign a payload",
    description:
      "Sign a payload with a private key. **Use client-side signing in production.**",
  })
  @ApiParam({ name: "id", description: "Payload UUID" })
  @ApiResponse({
    status: 200,
    description: "Payload signed",
    type: PayloadResponseDto,
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Payload not found" })
  async signPayload(
    @Param("id") id: string,
    @Body() signPayloadDto: SignPayloadDto,
  ): Promise<PayloadResponseDto> {
    this.logger.log(`Signing payload ${id}`);

    return this.oracleService.signPayload(id, signPayloadDto.privateKey);
  }

  /**
   * Submit a signed payload on-chain
   * Requires authentication
   */
  @Post("payloads/:id/submit")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Submit payload on-chain",
    description: "Submit a fully signed payload to the blockchain.",
  })
  @ApiParam({ name: "id", description: "Payload UUID" })
  @ApiResponse({
    status: 200,
    description: "Payload submitted",
    schema: {
      type: "object",
      properties: {
        transactionHash: { type: "string" },
        payload: { $ref: "#/components/schemas/PayloadResponseDto" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Payload not found" })
  async submitPayload(
    @Param("id") id: string,
  ): Promise<{ transactionHash: string; payload: PayloadResponseDto }> {
    this.logger.log(`Submitting payload ${id} on-chain`);

    return this.oracleService.submitPayload(id);
  }

  /**
   * Retry a failed submission
   */
  @Post("payloads/:id/retry")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Retry failed submission",
    description: "Retry submitting a payload that previously failed.",
  })
  @ApiParam({ name: "id", description: "Payload UUID" })
  @ApiResponse({
    status: 200,
    description: "Retry initiated",
    schema: {
      type: "object",
      properties: {
        transactionHash: { type: "string" },
        payload: { $ref: "#/components/schemas/PayloadResponseDto" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Payload not found" })
  async retrySubmission(
    @Param("id") id: string,
  ): Promise<{ transactionHash: string; payload: PayloadResponseDto }> {
    this.logger.log(`Retrying submission for payload ${id}`);

    return this.oracleService.retrySubmission(id);
  }

  /**
   * Verify a signature off-chain
   */
  @Post("verify-signature")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Verify signature off-chain",
    description:
      "Verify an ECDSA signature against a payload and expected signer address.",
  })
  @ApiResponse({
    status: 200,
    description: "Verification result",
    schema: {
      type: "object",
      properties: { valid: { type: "boolean" }, message: { type: "string" } },
    },
  })
  async verifySignature(
    @Body() verifySignatureDto: VerifySignatureDto,
  ): Promise<{ valid: boolean; message: string }> {
    // For this endpoint, we would need to compute the payload hash and verify
    // This is a simplified version - in production, you'd pass the payload ID
    return {
      valid: false,
      message: "Use /payloads/:id/verify endpoint instead",
    };
  }

  /**
   * Verify a payload's signature
   */
  @Get("payloads/:id/verify")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Verify payload signature",
    description:
      "Check whether the stored signature on a payload is valid for a given signer.",
  })
  @ApiParam({ name: "id", description: "Payload UUID" })
  @ApiQuery({
    name: "expectedSigner",
    description: "Ethereum address of the expected signer",
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: "Verification result",
    schema: {
      type: "object",
      properties: { valid: { type: "boolean" }, payloadId: { type: "string" } },
    },
  })
  @ApiResponse({ status: 404, description: "Payload not found" })
  async verifyPayloadSignature(
    @Param("id") id: string,
    @Query("expectedSigner") expectedSigner: string,
  ): Promise<{ valid: boolean; payloadId: string }> {
    this.logger.log(`Verifying signature for payload ${id}`);

    const valid = await this.oracleService.verifySignature(id, expectedSigner);

    return {
      valid,
      payloadId: id,
    };
  }

  /**
   * Get a specific payload
   */
  @Get("payloads/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({ summary: "Get payload by ID" })
  @ApiParam({ name: "id", description: "Payload UUID" })
  @ApiResponse({
    status: 200,
    description: "Payload found",
    type: PayloadResponseDto,
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  @ApiResponse({ status: 404, description: "Payload not found" })
  async getPayload(@Param("id") id: string): Promise<PayloadResponseDto> {
    return this.oracleService.getPayload(id);
  }

  /**
   * Get payloads for the authenticated user
   */
  @Get("my-payloads")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get my payloads",
    description:
      "Retrieve all payloads belonging to the authenticated wallet address.",
  })
  @ApiQuery({
    name: "status",
    enum: PayloadStatus,
    required: false,
    description: "Filter by submission status",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    description: "Max results to return (default 50)",
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "List of payloads",
    type: [PayloadResponseDto],
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getMyPayloads(
    @Request() req,
    @Query("status") status?: PayloadStatus,
    @Query("limit") limit?: number,
  ): Promise<PayloadResponseDto[]> {
    const address = req.user.address;
    const limitValue = limit ? parseInt(limit.toString()) : 50;

    this.logger.log(
      `Fetching payloads for ${address}, status: ${status || "all"}, limit: ${limitValue}`,
    );

    return this.oracleService.getPayloadsForAddress(
      address,
      status,
      limitValue,
    );
  }

  /**
   * Get payloads for a specific address (public endpoint)
   */
  @Get("payloads/address/:address")
  @ApiOperation({
    summary: "Get payloads by address",
    description:
      "Retrieve payloads submitted by a specific Ethereum address (public).",
  })
  @ApiParam({ name: "address", description: "Ethereum wallet address" })
  @ApiQuery({ name: "status", enum: PayloadStatus, required: false })
  @ApiQuery({ name: "limit", required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: "List of payloads",
    type: [PayloadResponseDto],
  })
  async getPayloadsForAddress(
    @Param("address") address: string,
    @Query("status") status?: PayloadStatus,
    @Query("limit") limit?: number,
  ): Promise<PayloadResponseDto[]> {
    const limitValue = limit ? parseInt(limit.toString()) : 50;

    return this.oracleService.getPayloadsForAddress(
      address,
      status,
      limitValue,
    );
  }

  /**
   * Get pending payloads ready for submission
   */
  @Get("payloads/pending/ready")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get pending payloads",
    description:
      "Retrieve signed payloads that are ready for on-chain submission.",
  })
  @ApiQuery({
    name: "limit",
    required: false,
    type: Number,
    description: "Max results (default 100)",
  })
  @ApiResponse({
    status: 200,
    description: "List of pending payloads",
    type: [PayloadResponseDto],
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getPendingPayloads(
    @Query("limit") limit?: number,
  ): Promise<PayloadResponseDto[]> {
    const limitValue = limit ? parseInt(limit.toString()) : 100;

    return this.oracleService.getPendingPayloads(limitValue);
  }

  /**
   * Get current nonce for an address
   */
  @Get("nonce/:address")
  @ApiOperation({
    summary: "Get nonce for address",
    description:
      "Retrieve the current submission nonce for an Ethereum address.",
  })
  @ApiParam({ name: "address", description: "Ethereum wallet address" })
  @ApiResponse({
    status: 200,
    description: "Current nonce",
    schema: {
      type: "object",
      properties: { address: { type: "string" }, nonce: { type: "string" } },
    },
  })
  async getCurrentNonce(@Param("address") address: string): Promise<{
    address: string;
    nonce: string;
  }> {
    const nonce = await this.oracleService.getCurrentNonce(address);

    return {
      address,
      nonce,
    };
  }

  /**
   * Get current nonce for authenticated user
   */
  @Get("my-nonce")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("JWT-auth")
  @ApiOperation({
    summary: "Get my nonce",
    description:
      "Retrieve the current submission nonce for the authenticated wallet address.",
  })
  @ApiResponse({
    status: 200,
    description: "Current nonce",
    schema: {
      type: "object",
      properties: { address: { type: "string" }, nonce: { type: "string" } },
    },
  })
  @ApiResponse({ status: 401, description: "Unauthorized" })
  async getMyNonce(@Request() req): Promise<{
    address: string;
    nonce: string;
  }> {
    const address = req.user.address;
    const nonce = await this.oracleService.getCurrentNonce(address);

    return {
      address,
      nonce,
    };
  }

  /**
   * Get Oracle service statistics
   */
  @Get("stats")
  @ApiOperation({
    summary: "Get Oracle statistics",
    description:
      "Retrieve aggregate statistics about oracle submissions and payload statuses.",
  })
  @ApiResponse({ status: 200, description: "Oracle statistics" })
  async getStatistics(): Promise<any> {
    return this.oracleService.getStatistics();
  }

  /**
   * Health check endpoint
   */
  @Get("health")
  @ApiOperation({ summary: "Oracle health check" })
  @ApiResponse({
    status: 200,
    description: "Service is healthy",
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        timestamp: { type: "string" },
        service: { type: "string" },
      },
    },
  })
  async healthCheck(): Promise<{
    status: string;
    timestamp: string;
    service: string;
  }> {
    return {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "oracle",
    };
  }
}
