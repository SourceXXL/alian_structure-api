import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { verifyMessage } from "ethers";
import {
  AuthStrategy,
  AuthResult,
  AuthPayload,
  WalletCredentials,
} from "../interfaces/auth-strategy.interface";
import { ChallengeService } from "src/core/auth/challenge.service";
import { User } from "src/core/user/entities/user.entity";
import { Wallet } from "src/core/auth/entities/wallet.entity";
import {
  resolveRateLimitTierFromRole,
} from "src/config/quota.config";

/**
 * Wallet-based authentication strategy
 * Uses Ethereum wallet signatures for authentication
 */
@Injectable()
export class WalletStrategy implements AuthStrategy {
  readonly name = "wallet";
  private readonly logger = new Logger(WalletStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly challengeService: ChallengeService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
  ) {}

  /**
   * Check if wallet strategy is enabled
   */
  get isEnabled(): boolean {
    return this.configService.get<boolean>("AUTH_WALLET_ENABLED", true);
  }

  /**
   * Authenticate using wallet signature
   * @param credentials - Wallet credentials containing message and signature
   * @returns Authentication result with JWT token
   */
  async authenticate(credentials: unknown): Promise<AuthResult> {
    const { message, signature } = credentials as WalletCredentials;

    if (!message || !signature) {
      throw new BadRequestException("Message and signature are required");
    }

    // Extract challenge ID from message
    const challengeId = this.challengeService.extractChallengeId(message);
    if (!challengeId) {
      throw new UnauthorizedException("Invalid challenge message format");
    }

    // Get and consume the challenge
    const challenge = this.challengeService.consumeChallenge(challengeId);
    if (!challenge) {
      throw new UnauthorizedException(
        "Challenge not found or expired. Please request a new challenge.",
      );
    }

    // Verify the signature
    let recoveredAddress: string;
    try {
      recoveredAddress = verifyMessage(message, signature);
    } catch (error) {
      throw new UnauthorizedException("Invalid signature");
    }

    // Verify the recovered address matches the challenge address
    if (recoveredAddress.toLowerCase() !== challenge.address) {
      throw new UnauthorizedException(
        "Signature does not match challenge address",
      );
    }

    // Fetch wallet to get associated user and email if linked
    const wallet = await this.walletRepository.findOne({
      where: { address: recoveredAddress.toLowerCase() },
      relations: ["user"],
    });
    const user = wallet?.user;

    // Issue JWT token with email and role if available
    const payload: AuthPayload = {
      address: recoveredAddress.toLowerCase(),
      email: user?.emailVerified ? user.email : undefined,
      role: user?.role || "user",
      tier: resolveRateLimitTierFromRole(user?.role),
      iat: Math.floor(Date.now() / 1000),
      type: "wallet",
    };

    const token = this.jwtService.sign({ sub: user?.id, ...payload });

    this.logger.log(`Wallet authenticated: ${recoveredAddress.toLowerCase()}`);

    return {
      token,
      user: {
        address: recoveredAddress.toLowerCase(),
        email: user?.emailVerified ? user.email : undefined,
        role: user?.role || "user",
        tier: resolveRateLimitTierFromRole(user?.role),
        type: "wallet",
      },
    };
  }

  /**
   * Validate a JWT token
   * @param token - The JWT token to validate
   * @returns The decoded payload or null if invalid
   */
  async validateToken(token: string): Promise<AuthPayload | null> {
    try {
      return this.jwtService.verify(token) as AuthPayload;
    } catch (error) {
      this.logger.warn("Token validation failed", error);
      return null;
    }
  }
}
