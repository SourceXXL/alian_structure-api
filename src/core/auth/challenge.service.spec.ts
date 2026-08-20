import { Test, TestingModule } from "@nestjs/testing";
import { ChallengeService } from "./challenge.service";

describe("ChallengeService", () => {
  let service: ChallengeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChallengeService],
    }).compile();
    service = module.get<ChallengeService>(ChallengeService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("issueChallengeForAddress", () => {
    it("should return a non-empty challenge message", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const message = service.issueChallengeForAddress(address);
      expect(message).toBeDefined();
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
    });

    it("should generate unique messages on each call", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const msg1 = service.issueChallengeForAddress(address);
      const msg2 = service.issueChallengeForAddress(address);
      expect(msg1).not.toBe(msg2);
    });

    it("should include a timestamp in the challenge", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const message = service.issueChallengeForAddress(address);
      expect(message).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("getChallenge", () => {
    it("should return null for an unknown challenge ID", async () => {
      const result = await service.getChallenge("nonexistent-id");
      expect(result).toBeNull();
    });
  });

  describe("consumeChallenge", () => {
    it("should return null when consuming a nonexistent challenge", async () => {
      const result = await service.consumeChallenge("nonexistent");
      expect(result).toBeNull();
    });
  });
});
