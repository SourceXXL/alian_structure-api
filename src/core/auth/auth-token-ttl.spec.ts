import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { EnhancedAuthService } from "./enhanced-auth.service";
import { EmailService } from "./email.service";
import { TokenBlacklistService } from "./token-blacklist.service";
import { User } from "../user/entities/user.entity";
import { RefreshToken, TwoFactorAuth } from "./entities/auth.entity";
import {
  ACCESS_TOKEN_TTL,
  ACCESS_TOKEN_TTL_SECONDS,
  JWT_SIGNING_ALGORITHM,
  REFRESH_TOKEN_TTL_MS,
  buildAccessTokenJwtModuleOptions,
} from "src/config/jwt.config";

jest.mock("bcrypt", () => ({
  hash: jest.fn().mockResolvedValue("hashed-pw"),
  compare: jest.fn().mockResolvedValue(true),
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

const SECRET = "test-secret-for-access-token-ttl";

/**
 * Fixed epoch so the `exp - iat` arithmetic is exact rather than dependent on
 * how long the test took to run.
 */
const FIXED_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);

interface Claims {
  sub: string;
  iat: number;
  exp: number;
}

describe("access token lifetime and algorithm policy", () => {
  let authService: AuthService;
  let enhancedAuthService: EnhancedAuthService;
  let jwtService: JwtService;

  const storedUser: Partial<User> = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    password: "hashed-pw",
    role: undefined as never,
    isActive: true,
  };

  const userRepository = {
    findOne: jest.fn(),
    create: jest.fn((v) => ({ ...storedUser, ...v })),
    save: jest.fn(async (v) => v),
    update: jest.fn(async () => undefined),
  };

  const refreshTokenRepository = {
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    update: jest.fn(),
    findOne: jest.fn(),
  };

  const twoFactorRepository = {
    findOne: jest.fn(async () => null),
    find: jest.fn(async () => []),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => v),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const emailService = {
    send2faChangeNotification: jest.fn(),
    sendEmail: jest.fn(),
  };

  /** Decode the payload without verifying it, so `exp`/`iat` can be read. */
  function decodeClaims(token: string): Claims {
    return jwtService.decode<Claims>(token, { json: true });
  }

  function ttlSecondsOf(token: string): number {
    const claims = decodeClaims(token);
    return claims.exp - claims.iat;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(storedUser);

    const module: TestingModule = await Test.createTestingModule({
      // The *real* issuer configuration, so this test tracks whatever
      // AuthModule actually registers instead of a copy of it that can drift.
      imports: [JwtModule.register(buildAccessTokenJwtModuleOptions(SECRET))],
      providers: [
        AuthService,
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
        // Mocked rather than instantiated: the real service opens a
        // `setInterval` in its constructor, which keeps a Jest worker alive.
        { provide: TokenBlacklistService, useValue: { revoke: jest.fn() } },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    authService = module.get(AuthService);
    enhancedAuthService = module.get(EnhancedAuthService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("ACCESS_TOKEN_TTL is applied to every access token", () => {
    it("is 15 minutes", () => {
      expect(ACCESS_TOKEN_TTL).toBe("15m");
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    });

    it("EnhancedAuthService.login() issues a token with exp - iat === 15m", async () => {
      const { accessToken } = await enhancedAuthService.login(
        { email: "user@example.com", password: "password123" },
        "127.0.0.1",
        "jest",
      );

      expect(decodeClaims(accessToken).exp).toBeDefined();
      expect(ttlSecondsOf(accessToken)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it("EnhancedAuthService.register() issues a token with exp - iat === 15m", async () => {
      userRepository.findOne.mockResolvedValue(null);

      const { accessToken } = await enhancedAuthService.register(
        {
          email: "new@example.com",
          password: "password123",
          username: "new",
        },
        "127.0.0.1",
        "jest",
      );

      expect(ttlSecondsOf(accessToken)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it("AuthService.login() issues a token with the same TTL as EnhancedAuthService", async () => {
      const { token } = await authService.login({
        email: "user@example.com",
        password: "password123",
      });

      const { accessToken } = await enhancedAuthService.login(
        { email: "user@example.com", password: "password123" },
        "127.0.0.1",
        "jest",
      );

      // The regression this guards: the two services used to disagree, because
      // only AuthService passed `expiresIn` and EnhancedAuthService relied on
      // the JwtModule default.
      expect(ttlSecondsOf(token)).toBe(ACCESS_TOKEN_TTL_SECONDS);
      expect(ttlSecondsOf(token)).toBe(ttlSecondsOf(accessToken));
    });

    it("AuthService.register() issues a token with exp - iat === 15m", async () => {
      userRepository.findOne.mockResolvedValue(null);

      const { token } = await authService.register({
        email: "new@example.com",
        password: "password123",
        username: "new",
      });

      expect(ttlSecondsOf(token)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it("keeps the refresh token lifetime at 7 days", async () => {
      jest.useFakeTimers().setSystemTime(FIXED_NOW);

      await enhancedAuthService.login(
        { email: "user@example.com", password: "password123" },
        "127.0.0.1",
        "jest",
      );

      const calls = refreshTokenRepository.create.mock.calls;
      const persisted = calls[calls.length - 1][0];

      expect(REFRESH_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
      expect(persisted.expiresAt.getTime()).toBe(FIXED_NOW + REFRESH_TOKEN_TTL_MS);
    });
  });

  describe("tokens past their TTL fail verification", () => {
    it("rejects an EnhancedAuthService token once 15m have elapsed", async () => {
      jest.useFakeTimers().setSystemTime(FIXED_NOW);

      const { accessToken } = await enhancedAuthService.login(
        { email: "user@example.com", password: "password123" },
        "127.0.0.1",
        "jest",
      );

      // One second before expiry the token is still accepted.
      jest.setSystemTime(FIXED_NOW + (ACCESS_TOKEN_TTL_SECONDS - 1) * 1000);
      expect(() => jwtService.verify(accessToken)).not.toThrow();

      // One second after expiry it is rejected.
      jest.setSystemTime(FIXED_NOW + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
      expect(() => jwtService.verify(accessToken)).toThrow(/expired/i);
    });

    it("rejects an AuthService token once 15m have elapsed", async () => {
      jest.useFakeTimers().setSystemTime(FIXED_NOW);

      const { token } = await authService.login({
        email: "user@example.com",
        password: "password123",
      });

      jest.setSystemTime(FIXED_NOW + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
      expect(() => jwtService.verify(token)).toThrow(/expired/i);
    });
  });

  describe("algorithm allowlist", () => {
    it("signs with the pinned HS256 algorithm", () => {
      const token = jwtService.sign(
        { sub: "user-1" },
        { expiresIn: ACCESS_TOKEN_TTL },
      );
      const { header } = jwtService.decode<{ header: { alg: string } }>(token, {
        complete: true,
      });

      expect(JWT_SIGNING_ALGORITHM).toBe("HS256");
      expect(header.alg).toBe("HS256");
    });

    it("refuses a token signed with an algorithm outside the allowlist", () => {
      // Whoever controls the signing secret must not be able to have a token
      // accepted under an algorithm the verifier did not opt into.
      const rogue = jwtService.sign(
        { sub: "attacker" },
        { secret: SECRET, algorithm: "HS512", expiresIn: ACCESS_TOKEN_TTL },
      );

      expect(() => jwtService.verify(rogue)).toThrow(/algorithm/i);
    });

    it("still accepts an HS256 token signed with the configured secret", () => {
      const token = jwtService.sign(
        { sub: "user-1" },
        { expiresIn: ACCESS_TOKEN_TTL },
      );

      expect(jwtService.verify<{ sub: string }>(token).sub).toBe("user-1");
    });
  });
});