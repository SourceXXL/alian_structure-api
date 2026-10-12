import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import { EnhancedAuthService } from "./enhanced-auth.service";
import { EmailService } from "./email.service";
import { User } from "../user/entities/user.entity";
import { RefreshToken, TwoFactorAuth } from "./entities/auth.entity";

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-pw"),
  compare: jest.fn(),
}));
jest.mock("speakeasy", () => ({
  generateSecret: jest.fn().mockReturnValue({
    base32: "SECRET",
    otpauth_url: "otpauth://totp/test",
  }),
}));
jest.mock("qrcode", () => ({
  toDataURL: jest.fn().mockResolvedValue("data:image/png;base64,stub"),
}));

/**
 * Registration, login and refresh-token behaviour.
 *
 * `enhanced-auth.service.spec.ts` covers the 2FA flows and
 * `auth-token-ttl.spec.ts` covers token lifetimes; neither exercises the
 * credential guard rails or refresh-token rotation. This suite does.
 */
describe("EnhancedAuthService credentials and refresh tokens", () => {
  let service: EnhancedAuthService;
  let userRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let refreshTokenRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let twoFactorRepository: { findOne: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const activeUser = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    password: "hashed-pw",
    role: undefined,
    isActive: true,
    emailVerified: true,
  } as unknown as User;

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    userRepository = {
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...activeUser, ...v })),
      save: jest.fn(async (v) => v),
      update: jest.fn(),
    };
    refreshTokenRepository = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      update: jest.fn(),
    };
    twoFactorRepository = { findOne: jest.fn().mockResolvedValue(null) };
    jwtService = { sign: jest.fn().mockReturnValue("signed.jwt.token") };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnhancedAuthService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: getRepositoryToken(TwoFactorAuth),
          useValue: twoFactorRepository,
        },
        { provide: JwtService, useValue: jwtService },
        {
          provide: EmailService,
          useValue: {
            send2faChangeNotification: jest.fn(),
            sendEmail: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(EnhancedAuthService);
  });

  describe("register", () => {
    const dto = {
      email: "new@example.com",
      password: "password123",
      username: "newuser",
    };

    it("creates the account and returns a token pair", async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.register(dto, "127.0.0.1", "jest");

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.requiresTwoFactor).toBe(false);
      expect(userRepository.save).toHaveBeenCalled();
      expect(refreshTokenRepository.save).toHaveBeenCalled();
    });

    it("rejects an email that is already registered", async () => {
      userRepository.findOne.mockResolvedValue(activeUser);

      await expect(service.register(dto, "127.0.0.1")).rejects.toThrow(
        new ConflictException("Email already registered"),
      );
    });

    it("rejects a username that is already taken", async () => {
      userRepository.findOne.mockResolvedValue({
        ...activeUser,
        email: "different@example.com",
        username: "newuser",
      });

      await expect(service.register(dto, "127.0.0.1")).rejects.toThrow(
        new ConflictException("Username already taken"),
      );
    });

    it("rejects an unknown referral code", async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.register(
          { ...dto, referralCode: "NOPE12" },
          "127.0.0.1",
        ),
      ).rejects.toThrow(new BadRequestException("Invalid referral code"));
    });
  });

  describe("login", () => {
    const dto = { email: "user@example.com", password: "password123" };

    it("returns a token pair for valid credentials", async () => {
      userRepository.findOne.mockResolvedValue(activeUser);

      const result = await service.login(dto, "127.0.0.1");

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      // No 2FA configured, so the token is already 2FA-verified.
      expect(result.requiresTwoFactor).toBe(false);
    });

    it("records the login timestamp", async () => {
      userRepository.findOne.mockResolvedValue(activeUser);

      await service.login(dto, "127.0.0.1");

      expect(userRepository.update).toHaveBeenCalledWith(
        activeUser.id,
        expect.objectContaining({ lastLoginAt: expect.any(Date) }),
      );
    });

    it("rejects an unknown email", async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.login(dto, "127.0.0.1")).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("rejects a wrong password", async () => {
      userRepository.findOne.mockResolvedValue(activeUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto, "127.0.0.1")).rejects.toThrow(
        new UnauthorizedException("Invalid credentials"),
      );
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it("rejects a deactivated account", async () => {
      userRepository.findOne.mockResolvedValue({
        ...activeUser,
        isActive: false,
      });

      await expect(service.login(dto, "127.0.0.1")).rejects.toThrow(
        new UnauthorizedException("Account is deactivated"),
      );
    });

    it("points wallet-only accounts at wallet login", async () => {
      userRepository.findOne.mockResolvedValue({
        ...activeUser,
        password: null,
      });

      await expect(service.login(dto, "127.0.0.1")).rejects.toThrow(
        new BadRequestException(
          "This account uses wallet authentication. Please use wallet login.",
        ),
      );
    });
  });

  describe("refreshToken", () => {
    const validToken = {
      id: "rt-1",
      token: "stored-refresh-token",
      user: activeUser,
      expiresAt: new Date(Date.now() + 60_000),
    };

    it("rotates the refresh token and revokes the old one", async () => {
      refreshTokenRepository.findOne.mockResolvedValue(validToken);

      const result = await service.refreshToken(
        { refreshToken: "stored-refresh-token" },
        "127.0.0.1",
      );

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.refreshToken).not.toBe("stored-refresh-token");

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        "rt-1",
        expect.objectContaining({
          revoked: true,
          revokedAt: expect.any(Date),
          replacedByToken: result.refreshToken,
        }),
      );
    });

    it("issues a non-2FA-verified token when 2FA is configured", async () => {
      refreshTokenRepository.findOne.mockResolvedValue(validToken);
      twoFactorRepository.findOne.mockResolvedValue({ userId: activeUser.id });

      await service.refreshToken(
        { refreshToken: "stored-refresh-token" },
        "127.0.0.1",
      );

      const calls = jwtService.sign.mock.calls;
      expect(calls[calls.length - 1][0].twoFactorVerified).toBe(false);
    });

    it("rejects an unknown refresh token", async () => {
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        service.refreshToken({ refreshToken: "nope" }, "127.0.0.1"),
      ).rejects.toThrow(
        new UnauthorizedException("Invalid or expired refresh token"),
      );
    });

    it("rejects an expired refresh token", async () => {
      refreshTokenRepository.findOne.mockResolvedValue({
        ...validToken,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        service.refreshToken({ refreshToken: "stored-refresh-token" }, "127.0.0.1"),
      ).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("revokeAllRefreshTokens", () => {
    it("revokes every live refresh token for the user", async () => {
      await service.revokeAllRefreshTokens("user-1");

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: "user-1", revoked: false },
        { revoked: true, revokedAt: expect.any(Date) },
      );
    });
  });

  describe("validateUser", () => {
    it("returns the user when one exists", async () => {
      userRepository.findOne.mockResolvedValue(activeUser);

      await expect(service.validateUser("user-1")).resolves.toBe(activeUser);
    });

    it("returns null when no user exists", async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.validateUser("missing")).resolves.toBeNull();
    });
  });
});