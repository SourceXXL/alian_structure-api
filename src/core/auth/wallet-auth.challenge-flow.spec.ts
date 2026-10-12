import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { UnauthorizedException } from "@nestjs/common";
import { HDNodeWallet } from "ethers";
import { WalletAuthService } from "./wallet-auth.service";
import { ChallengeService } from "./challenge.service";
import { EnhancedAuthService } from "./enhanced-auth.service";
import { EmailService } from "./email.service";
import { User, UserRole } from "../user/entities/user.entity";
// Aliased: `HDNodeWallet` here is the ethers signing wallet, the entity is
// what `WalletAuthService` injects its repository for. In ethers v6
// `Wallet.createRandom()` returns an `HDNodeWallet`, which is a sibling of
// `Wallet` rather than a subtype, so the variable needs the concrete type.
import {
  Wallet as WalletEntity,
  WalletType,
  WalletStatus,
} from "./entities/wallet.entity";
import { ProvenanceService } from "src/infrastructure/audit/provenance.service";

/**
 * Covers the challenge -> sign -> verify -> validate login flow.
 *
 * `src/core/auth/wallet-auth.service.spec.ts` already covers the
 * wallet-management half of the service (linkWallet / unlinkWallet /
 * recoverWallet / validateToken) with `ethers` mocked out. This suite takes
 * the other half: it uses the real `ChallengeService` and real ethers
 * signatures, so it exercises the cryptographic path rather than a stub.
 */
describe("WalletAuthService challenge and signature flow", () => {
  let walletAuthService: WalletAuthService;
  let challengeService: ChallengeService;
  let jwtService: JwtService;
  let walletRepository: { findOne: jest.Mock };
  let provenanceService: { createProvenanceRecord: jest.Mock };
  let testWallet: HDNodeWallet;

  const mockUser = {
    id: "user-1",
    email: "user@example.com",
    emailVerified: true,
    role: UserRole.USER,
  } as unknown as User;

  const linkedWallet = (address: string) =>
    ({
      id: "wallet-1",
      address,
      type: WalletType.PRIMARY,
      status: WalletStatus.ACTIVE,
      user: mockUser,
    }) as unknown as WalletEntity;

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockJwtService.sign.mockImplementation(
      (payload) => `test-token-${JSON.stringify(payload)}`,
    );
    mockJwtService.verify.mockImplementation((token) => {
      if (typeof token === "string" && token.startsWith("test-token-")) {
        return JSON.parse(token.slice("test-token-".length));
      }
      throw new Error("Invalid token");
    });

    provenanceService = {
      createProvenanceRecord: jest.fn().mockResolvedValue(undefined),
    };
    walletRepository = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletAuthService,
        // Real: the challenge lifecycle is part of what is under test.
        ChallengeService,
        { provide: JwtService, useValue: mockJwtService },
        {
          provide: EnhancedAuthService,
          useValue: {
            isTwoFactorEnabled: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(mockUser) },
        },
        { provide: getRepositoryToken(WalletEntity), useValue: walletRepository },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: EmailService,
          useValue: {
            sendWalletLinkedNotification: jest.fn(),
            sendWalletUnlinkedNotification: jest.fn(),
          },
        },
        { provide: ProvenanceService, useValue: provenanceService },
      ],
    }).compile();

    walletAuthService = module.get<WalletAuthService>(WalletAuthService);
    challengeService = module.get<ChallengeService>(ChallengeService);
    jwtService = module.get<JwtService>(JwtService);

    testWallet = HDNodeWallet.createRandom();
  });

  describe("challenge issuance", () => {
    it("issues a signable message bound to the address", () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );

      expect(message).toContain("Sign this message to authenticate:");
    });

    it("carries a 32 byte (64 hex character) challenge id", () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const challengeId = challengeService.extractChallengeId(message);

      expect(challengeId).toMatch(/^[0-9a-f]{64}$/);
    });

    it("issues a different challenge per request", () => {
      const address = testWallet.address;
      const first = challengeService.extractChallengeId(
        challengeService.issueChallengeForAddress(address),
      );
      const second = challengeService.extractChallengeId(
        challengeService.issueChallengeForAddress(address),
      );

      expect(first).not.toBe(second);
    });

    it("stores the challenge with a lowercased address and a future expiry", () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const challenge = challengeService.getChallenge(
        challengeService.extractChallengeId(message),
      );

      expect(challenge.address).toBe(testWallet.address.toLowerCase());
      expect(challenge.expiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe("signature verification", () => {
    beforeEach(() => {
      // A wallet must already be linked to an account for a token to be
      // issued; an unlinked wallet is rejected outright.
      walletRepository.findOne.mockImplementation(
        async ({ where }) => linkedWallet(where.address),
      );
    });

    it("issues a token for a valid signature on a linked wallet", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const signature = await testWallet.signMessage(message);

      const result = await walletAuthService.verifySignatureAndIssueToken(
        message,
        signature,
      );

      expect(result.token).toBeTruthy();
      expect(result.address).toBe(testWallet.address.toLowerCase());
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockUser.id,
          address: testWallet.address.toLowerCase(),
        }),
      );
    });

    it("records a successful provenance entry", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const signature = await testWallet.signMessage(message);

      await walletAuthService.verifySignatureAndIssueToken(message, signature);

      expect(provenanceService.createProvenanceRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: "wallet-auth",
          input: expect.objectContaining({ success: true }),
        }),
      );
    });

    it("consumes the challenge so it cannot be replayed", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const challengeId = challengeService.extractChallengeId(message);
      const signature = await testWallet.signMessage(message);

      await walletAuthService.verifySignatureAndIssueToken(message, signature);

      expect(challengeService.getChallenge(challengeId)).toBeNull();
    });

    it("rejects a malformed signature", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const invalidSignature = `0x${"0".repeat(130)}`;

      await expect(
        walletAuthService.verifySignatureAndIssueToken(
          message,
          invalidSignature,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a signature from a different wallet", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const otherWallet = HDNodeWallet.createRandom();
      const signature = await otherWallet.signMessage(message);

      await expect(
        walletAuthService.verifySignatureAndIssueToken(message, signature),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a challenge that was already consumed", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      challengeService.consumeChallenge(
        challengeService.extractChallengeId(message),
      );
      const signature = await testWallet.signMessage(message);

      await expect(
        walletAuthService.verifySignatureAndIssueToken(message, signature),
      ).rejects.toThrow(
        new UnauthorizedException(
          "Challenge not found or expired. Please request a new challenge.",
        ),
      );
    });

    it("rejects a message that is not a challenge at all", async () => {
      const signature = await testWallet.signMessage("hello");

      await expect(
        walletAuthService.verifySignatureAndIssueToken("hello", signature),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("rejects a valid signature from a wallet that is not linked to an account", async () => {
      walletRepository.findOne.mockResolvedValue(null);
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const signature = await testWallet.signMessage(message);

      await expect(
        walletAuthService.verifySignatureAndIssueToken(message, signature),
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it("records a failed provenance entry when verification fails", async () => {
      const message = challengeService.issueChallengeForAddress(
        testWallet.address,
      );
      const otherWallet = HDNodeWallet.createRandom();
      const signature = await otherWallet.signMessage(message);

      await expect(
        walletAuthService.verifySignatureAndIssueToken(message, signature),
      ).rejects.toThrow(UnauthorizedException);
      expect(provenanceService.createProvenanceRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ success: false }),
        }),
      );
    });
  });

  describe("token validation", () => {
    it("returns the payload for a token it issued", () => {
      const payload = {
        address: testWallet.address.toLowerCase(),
        iat: Math.floor(Date.now() / 1000),
      };

      expect(walletAuthService.validateToken(jwtService.sign(payload))).toEqual(
        payload,
      );
    });

    it("rejects a malformed token", () => {
      expect(() => walletAuthService.validateToken("invalid-token")).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe("end-to-end flow", () => {
    it("authenticates a wallet from challenge through to a validated token", async () => {
      walletRepository.findOne.mockImplementation(async ({ where }) =>
        linkedWallet(where.address),
      );
      const address = testWallet.address;

      const message = challengeService.issueChallengeForAddress(address);
      expect(message).toContain("Sign this message to authenticate:");

      const signature = await testWallet.signMessage(message);

      const { token } = await walletAuthService.verifySignatureAndIssueToken(
        message,
        signature,
      );
      expect(token).toBeTruthy();

      expect(walletAuthService.validateToken(token).address).toBe(
        address.toLowerCase(),
      );
    });
  });
});