import {
  Injectable,
  Logger,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { JwtService } from "@nestjs/jwt";
import { v4 as uuidv4 } from "uuid";
import * as speakeasy from "speakeasy";
import * as qrcode from "qrcode";
import { EmailService } from "./email.service";
import { User } from "src/core/user/entities/user.entity";
import { resolveRateLimitTierFromRole } from "src/config/quota.config";
import {
  RefreshToken,
  TwoFactorAuth,
  TwoFactorType,
  TwoFactorStatus,
} from "./entities/auth.entity";
import {
  LoginDto,
  RegisterDto,
  RefreshTokenDto,
  TwoFactorVerifyDto,
} from "./dto/auth.dto";
import { TwoFactorSetupDto } from "./dto/kyc.dto";

@Injectable()
export class EnhancedAuthService {
  private readonly logger = new Logger(EnhancedAuthService.name);

  /** Max consecutive failed 2FA attempts before the account is locked. */
  private readonly MAX_2FA_ATTEMPTS = 5;
  /** Duration of the 2FA lockout once the attempt limit is reached. */
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  /** Number of single-use backup codes issued per enablement. */
  private readonly BACKUP_CODE_COUNT = 10;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(TwoFactorAuth)
    private readonly twoFactorRepository: Repository<TwoFactorAuth>,
    private readonly jwtService: JwtService,
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
  ) {}

  async register(
    registerDto: RegisterDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Partial<User> & { tier?: string };
    requiresTwoFactor?: boolean;
  }> {
    const { email, password, username, referralCode } = registerDto;

    // Check if user already exists
    const existingUser = await this.userRepository.findOne({
      where: [{ email }, { username }],
    });

    if (existingUser) {
      if (existingUser.email === email) {
        throw new ConflictException("Email already registered");
      }
      if (existingUser.username === username) {
        throw new ConflictException("Username already taken");
      }
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate unique referral code for the new user
    const userReferralCode = uuidv4().substring(0, 8).toUpperCase();

    // Check if a referral code was provided
    let referredBy: User | null = null;
    if (referralCode) {
      referredBy = await this.userRepository.findOne({
        where: { referralCode: referralCode.toUpperCase() },
      });
      if (!referredBy) {
        throw new BadRequestException("Invalid referral code");
      }
    }

    // Create user
    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      username,
      walletAddress: `email_${email}`, // Generate a pseudo wallet address for email users
      emailVerified: false,
      isActive: true,
      referralCode: userReferralCode,
      referredBy: referredBy || undefined,
    });

    await this.userRepository.save(user);

    // A freshly registered account never has 2FA configured yet.
    const tokens = await this.generateTokens(user, ipAddress, userAgent, true);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tier: resolveRateLimitTierFromRole(user.role),
        kycStatus: user.kycStatus,
      },
      requiresTwoFactor: false,
    };
  }

  async login(
    loginDto: LoginDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    user: Partial<User> & { tier?: string };
    requiresTwoFactor?: boolean;
  }> {
    const { email, password } = loginDto;

    // Find user by email
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    if (!user.isActive) {
      throw new UnauthorizedException("Account is deactivated");
    }

    // Check if user has a password (traditional auth user)
    if (!user.password) {
      throw new BadRequestException(
        "This account uses wallet authentication. Please use wallet login.",
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Update last login
    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

    // When 2FA is enabled the issued access token is NOT yet 2FA-verified: the
    // client must complete POST /api/auth/2fa/verify to obtain a fully
    // privileged token. Admin endpoints reject tokens that are not 2FA-verified.
    const twoFactorEnabled = await this.isTwoFactorEnabled(user.id);
    const tokens = await this.generateTokens(
      user,
      ipAddress,
      userAgent,
      !twoFactorEnabled,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        tier: resolveRateLimitTierFromRole(user.role),
        kycStatus: user.kycStatus,
      },
      requiresTwoFactor: twoFactorEnabled,
    };
  }

  async refreshToken(
    refreshTokenDto: RefreshTokenDto,
    ipAddress: string,
    userAgent?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { refreshToken } = refreshTokenDto;

    // Find and validate refresh token
    const tokenEntity = await this.refreshTokenRepository.findOne({
      where: { token: refreshToken, revoked: false },
      relations: ["user"],
    });

    if (!tokenEntity || tokenEntity.expiresAt < new Date()) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    // A refreshed access token is only 2FA-verified when the account has no 2FA
    // configured; otherwise the holder must re-run 2FA before touching
    // 2FA-gated (e.g. admin) endpoints.
    const twoFactorEnabled = await this.isTwoFactorEnabled(tokenEntity.user.id);
    const newTokens = await this.generateTokens(
      tokenEntity.user,
      ipAddress,
      userAgent,
      !twoFactorEnabled,
    );

    // Revoke old refresh token
    await this.refreshTokenRepository.update(tokenEntity.id, {
      revoked: true,
      revokedAt: new Date(),
      replacedByToken: newTokens.refreshToken,
    });

    return {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    };
  }

  async setupTwoFactor(
    userId: string,
    setupDto: TwoFactorSetupDto,
  ): Promise<{ secret: string; qrCodeUrl: string; backupCodes: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Check if 2FA is already enabled
    const existing2FA = await this.twoFactorRepository.findOne({
      where: { userId, isEnabled: true },
    });

    if (existing2FA) {
      throw new BadRequestException(
        "Two-factor authentication is already enabled",
      );
    }

    // Generate TOTP secret
    const secret = speakeasy.generateSecret({
      name: `alian-structure (${user.email})`,
      issuer: "alian-structure",
    });

    // Generate QR code
    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    // Generate backup codes — only the hashes are persisted; the plaintext set
    // is returned to the user exactly once and can never be recovered after.
    const { plaintext, hashed } = this.generateBackupCodes();

    // Remove any stale pending/disabled record before creating a fresh one so a
    // user can restart setup without hitting a unique-ish conflict.
    await this.twoFactorRepository.delete({ userId, isEnabled: false });

    const twoFactor = this.twoFactorRepository.create({
      userId,
      type: TwoFactorType.TOTP,
      status: TwoFactorStatus.PENDING,
      secret: secret.base32,
      backupCodes: JSON.stringify(hashed),
      isEnabled: false,
      failedAttempts: 0,
      lockedUntil: null,
    });

    await this.twoFactorRepository.save(twoFactor);

    return {
      secret: secret.base32,
      qrCodeUrl,
      backupCodes: plaintext,
    };
  }

  async verifyTwoFactorSetup(
    userId: string,
    code: string,
  ): Promise<{ success: boolean }> {
    const twoFactor = await this.twoFactorRepository.findOne({
      where: { userId, status: TwoFactorStatus.PENDING },
    });

    if (!twoFactor) {
      throw new NotFoundException("Two-factor authentication setup not found");
    }

    // Verify TOTP code
    const verified = speakeasy.totp.verify({
      secret: twoFactor.secret,
      encoding: "base32",
      token: code,
      window: 2, // Allow 2 time steps (30 seconds) tolerance
    });

    if (verified) {
      await this.twoFactorRepository.update(twoFactor.id, {
        status: TwoFactorStatus.VERIFIED,
        isEnabled: true,
        verifiedAt: new Date(),
        failedAttempts: 0,
        lockedUntil: null,
      });

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (user?.email) {
        await this.notify2faChange(user.email, "enabled");
      }
    }

    return { success: verified };
  }

  async verifyTwoFactorLogin(
    userId: string,
    verifyDto: TwoFactorVerifyDto,
    clientInfo?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Throws on lockout / invalid code; returns on success.
    await this.verifyTwoFactorCode(userId, verifyDto);

    // Get user and generate final, fully 2FA-verified tokens
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const tokens = await this.generateTokens(
      user,
      clientInfo?.ipAddress ?? "0.0.0.0",
      clientInfo?.userAgent ?? "2FA Verification",
      true,
    );

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Verify a TOTP or backup code for an enabled 2FA record, enforcing account
   * lockout after {@link MAX_2FA_ATTEMPTS} consecutive failures.
   *
   * Shared by the email/password and wallet login flows. Returns normally on
   * success (resetting the failure counter) and throws on lockout or an invalid
   * code (incrementing the counter, and locking the account when the limit is
   * reached).
   */
  async verifyTwoFactorCode(
    userId: string,
    verifyDto: TwoFactorVerifyDto,
  ): Promise<void> {
    const twoFactor = await this.twoFactorRepository.findOne({
      where: { userId, isEnabled: true },
    });

    if (!twoFactor) {
      throw new BadRequestException("Two-factor authentication not enabled");
    }

    // Enforce lockout window
    if (twoFactor.lockedUntil && twoFactor.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil(
        (twoFactor.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new UnauthorizedException(
        `Account locked due to too many failed 2FA attempts. Try again in ${minutes} minute(s).`,
      );
    }

    let verified = false;
    let usedBackupCode = false;

    if (verifyDto.code) {
      verified = speakeasy.totp.verify({
        secret: twoFactor.secret,
        encoding: "base32",
        token: verifyDto.code,
        window: 2,
      });
    } else if (verifyDto.backupCode) {
      const storedHashes: string[] = JSON.parse(twoFactor.backupCodes || "[]");
      const candidate = this.hashBackupCode(verifyDto.backupCode);
      const matchIndex = storedHashes.findIndex((h) =>
        this.safeEqual(h, candidate),
      );

      if (matchIndex !== -1) {
        verified = true;
        usedBackupCode = true;
        // Consume the single-use backup code
        storedHashes.splice(matchIndex, 1);
        twoFactor.backupCodes = JSON.stringify(storedHashes);
      }
    } else {
      throw new BadRequestException("A TOTP code or backup code is required");
    }

    if (!verified) {
      twoFactor.failedAttempts += 1;
      let lockedMessage = "Invalid two-factor authentication code";

      if (twoFactor.failedAttempts >= this.MAX_2FA_ATTEMPTS) {
        twoFactor.lockedUntil = new Date(Date.now() + this.LOCKOUT_DURATION_MS);
        twoFactor.failedAttempts = 0;
        lockedMessage = `Account locked due to too many failed 2FA attempts. Try again in ${this.LOCKOUT_DURATION_MS / 60000} minutes.`;
        this.logger.warn(`2FA lockout triggered for user ${userId}`);
      }

      await this.twoFactorRepository.save(twoFactor);
      throw new UnauthorizedException(lockedMessage);
    }

    // Success — reset counters and record usage
    twoFactor.failedAttempts = 0;
    twoFactor.lockedUntil = null;
    twoFactor.lastUsedAt = new Date();
    await this.twoFactorRepository.save(twoFactor);

    if (usedBackupCode) {
      this.logger.log(`Backup code consumed for user ${userId}`);
    }
  }

  /**
   * Regenerate the set of single-use backup codes (recovery for a lost device
   * is still possible as long as the user has one unused code or their TOTP).
   * Requires password re-authentication and invalidates all previous codes.
   */
  async regenerateBackupCodes(
    userId: string,
    password: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.password) {
      throw new NotFoundException("User not found");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid password");
    }

    const twoFactor = await this.twoFactorRepository.findOne({
      where: { userId, isEnabled: true },
    });
    if (!twoFactor) {
      throw new BadRequestException("Two-factor authentication not enabled");
    }

    const { plaintext, hashed } = this.generateBackupCodes();
    twoFactor.backupCodes = JSON.stringify(hashed);
    await this.twoFactorRepository.save(twoFactor);

    if (user.email) {
      await this.notify2faChange(user.email, "backup-codes-regenerated");
    }

    return { backupCodes: plaintext };
  }

  /**
   * Return the current 2FA status for a user (used by clients/admin UIs).
   */
  async getTwoFactorStatus(userId: string): Promise<{
    enabled: boolean;
    pending: boolean;
    remainingBackupCodes: number;
    lockedUntil: Date | null;
  }> {
    const records = await this.twoFactorRepository.find({ where: { userId } });
    const enabledRecord = records.find((r) => r.isEnabled);
    const pendingRecord = records.find(
      (r) => !r.isEnabled && r.status === TwoFactorStatus.PENDING,
    );

    const remainingBackupCodes = enabledRecord
      ? (JSON.parse(enabledRecord.backupCodes || "[]") as string[]).length
      : 0;

    return {
      enabled: !!enabledRecord,
      pending: !!pendingRecord,
      remainingBackupCodes,
      lockedUntil:
        enabledRecord?.lockedUntil &&
        enabledRecord.lockedUntil.getTime() > Date.now()
          ? enabledRecord.lockedUntil
          : null,
    };
  }

  async disableTwoFactor(
    userId: string,
    password: string,
  ): Promise<{ success: boolean }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.password) {
      throw new NotFoundException("User not found");
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid password");
    }

    // Disable 2FA
    await this.twoFactorRepository.update(
      { userId },
      {
        isEnabled: false,
        status: TwoFactorStatus.DISABLED,
        failedAttempts: 0,
        lockedUntil: null,
      },
    );

    if (user.email) {
      await this.notify2faChange(user.email, "disabled");
    }

    return { success: true };
  }

  private async generateTokens(
    user: User,
    ipAddress: string,
    userAgent?: string,
    twoFactorVerified = true,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Generate access token
    const payload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tier: resolveRateLimitTierFromRole(user.role),
      twoFactorVerified,
    };
    const accessToken = this.jwtService.sign(payload);

    // Generate refresh token
    const refreshTokenValue = this.generateRefreshToken();
    const refreshTokenEntity = this.refreshTokenRepository.create({
      userId: user.id,
      token: refreshTokenValue,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      ipAddress,
      userAgent,
    });

    await this.refreshTokenRepository.save(refreshTokenEntity);

    return {
      accessToken,
      refreshToken: refreshTokenValue,
    };
  }

  private generateRefreshToken(): string {
    return randomBytes(64).toString("hex");
  }

  /**
   * Generate {@link BACKUP_CODE_COUNT} backup codes. Returns the plaintext set
   * (shown to the user once) alongside their SHA-256 hashes (persisted).
   */
  private generateBackupCodes(): { plaintext: string[]; hashed: string[] } {
    const plaintext: string[] = [];
    const hashed: string[] = [];
    for (let i = 0; i < this.BACKUP_CODE_COUNT; i++) {
      // 8 hex chars, grouped as XXXX-XXXX for readability
      const raw = randomBytes(4).toString("hex").toUpperCase();
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
      plaintext.push(code);
      hashed.push(this.hashBackupCode(code));
    }
    return { plaintext, hashed };
  }

  private hashBackupCode(code: string): string {
    const normalized = code.toUpperCase().replace(/[\s-]/g, "");
    return createHash("sha256").update(normalized).digest("hex");
  }

  /** Constant-time comparison of two hex digest strings. */
  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * Best-effort 2FA security alert. A mail failure must never roll back the
   * security action that triggered it, so errors are logged and swallowed.
   */
  private async notify2faChange(
    email: string,
    event: "enabled" | "disabled" | "backup-codes-regenerated",
  ): Promise<void> {
    try {
      await this.emailService.send2faChangeNotification(email, event);
    } catch (error) {
      this.logger.warn(
        `Failed to send 2FA "${event}" notification to ${email}: ${
          (error as Error).message
        }`,
      );
    }
  }

  async isTwoFactorEnabled(userId: string): Promise<boolean> {
    const twoFactor = await this.twoFactorRepository.findOne({
      where: { userId, isEnabled: true },
    });
    return !!twoFactor;
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { userId, revoked: false },
      { revoked: true, revokedAt: new Date() },
    );
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: userId } });
  }
}
