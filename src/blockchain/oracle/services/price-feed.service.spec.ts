import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PriceFeedService } from "./price-feed.service";
import {
  PriceRecord,
  SupportedChain,
  PriceSource,
} from "../entities/price-record.entity";

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockConfig = { get: jest.fn().mockReturnValue(undefined) };
const mockEmitter = { emit: jest.fn() };

describe("PriceFeedService", () => {
  let service: PriceFeedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriceFeedService,
        { provide: getRepositoryToken(PriceRecord), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
        { provide: EventEmitter2, useValue: mockEmitter },
      ],
    }).compile();

    service = module.get<PriceFeedService>(PriceFeedService);
    jest.clearAllMocks();
  });

  describe("aggregatePrices", () => {
    it("returns median of a single price with zero deviation", () => {
      const { median, maxDeviationPercent } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: 2000,
      });
      expect(median).toBe(2000);
      expect(maxDeviationPercent).toBe(0);
    });

    it("returns middle value as median for odd count", () => {
      const { median } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: 100,
        [PriceSource.BAND]: 200,
        [PriceSource.UNISWAP_TWAP]: 300,
      });
      expect(median).toBe(200);
    });

    it("returns average of two middle values for even count", () => {
      const { median } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: 100,
        [PriceSource.BAND]: 200,
      });
      expect(median).toBe(150);
    });

    it("computes max pairwise deviation correctly", () => {
      const { maxDeviationPercent } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: 100,
        [PriceSource.BAND]: 110,
      });
      // avg=105, |100-110|/105*100 ≈ 9.52%
      expect(maxDeviationPercent).toBeCloseTo(9.52, 1);
    });

    it("returns zero deviation when all prices are identical", () => {
      const { maxDeviationPercent } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: 2000,
        [PriceSource.BAND]: 2000,
        [PriceSource.UNISWAP_TWAP]: 2000,
      });
      expect(maxDeviationPercent).toBe(0);
    });

    it("ignores non-positive values", () => {
      const { median } = service.aggregatePrices({
        [PriceSource.CHAINLINK]: -10,
        [PriceSource.BAND]: 0,
        [PriceSource.UNISWAP_TWAP]: 500,
      });
      expect(median).toBe(500);
    });

    it("returns zeros when prices object is empty", () => {
      const { median, maxDeviationPercent } = service.aggregatePrices({});
      expect(median).toBe(0);
      expect(maxDeviationPercent).toBe(0);
    });
  });

  describe("getCurrentPrice", () => {
    it("throws when no RPC provider is configured for the chain", async () => {
      await expect(
        service.getCurrentPrice("ETH", SupportedChain.ETHEREUM),
      ).rejects.toThrow(/No price sources available/);
    });

    it("persists a PriceRecord and returns a PriceResponseDto", async () => {
      const fakePrices = {
        [PriceSource.CHAINLINK]: 2000,
        [PriceSource.BAND]: 2010,
      };
      jest
        .spyOn(service as any, "fetchAllSources")
        .mockResolvedValue(fakePrices);

      const fakeRecord: Partial<PriceRecord> = {
        asset: "ETH",
        chain: SupportedChain.ETHEREUM,
        price: 2005,
        sourcePrices: fakePrices as Record<PriceSource, number>,
        deviationAlert: false,
        maxDeviationPercent: 0.5,
        createdAt: new Date("2026-01-01"),
      };
      mockRepo.create.mockReturnValue(fakeRecord);
      mockRepo.save.mockResolvedValue(fakeRecord);

      const result = await service.getCurrentPrice("ETH", SupportedChain.ETHEREUM);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ asset: "ETH", chain: SupportedChain.ETHEREUM }),
      );
      expect(mockRepo.save).toHaveBeenCalledWith(fakeRecord);
      expect(result.asset).toBe("ETH");
      expect(result.chain).toBe(SupportedChain.ETHEREUM);
    });

    it("emits price.deviation event when deviation exceeds 5%", async () => {
      const fakePrices = {
        [PriceSource.CHAINLINK]: 100,
        [PriceSource.BAND]: 110,
      };
      jest
        .spyOn(service as any, "fetchAllSources")
        .mockResolvedValue(fakePrices);

      const fakeRecord: Partial<PriceRecord> = {
        asset: "ETH",
        chain: SupportedChain.ETHEREUM,
        price: 105,
        sourcePrices: fakePrices as Record<PriceSource, number>,
        deviationAlert: true,
        maxDeviationPercent: 9.52,
        createdAt: new Date(),
      };
      mockRepo.create.mockReturnValue(fakeRecord);
      mockRepo.save.mockResolvedValue(fakeRecord);

      await service.getCurrentPrice("ETH", SupportedChain.ETHEREUM);

      expect(mockEmitter.emit).toHaveBeenCalledWith(
        "price.deviation",
        expect.objectContaining({ asset: "ETH", chain: SupportedChain.ETHEREUM }),
      );
    });

    it("does NOT emit deviation event when deviation is below 5%", async () => {
      const fakePrices = {
        [PriceSource.CHAINLINK]: 2000,
        [PriceSource.BAND]: 2001,
      };
      jest
        .spyOn(service as any, "fetchAllSources")
        .mockResolvedValue(fakePrices);

      const fakeRecord: Partial<PriceRecord> = {
        asset: "ETH",
        chain: SupportedChain.ETHEREUM,
        price: 2000.5,
        sourcePrices: fakePrices as Record<PriceSource, number>,
        deviationAlert: false,
        maxDeviationPercent: 0.05,
        createdAt: new Date(),
      };
      mockRepo.create.mockReturnValue(fakeRecord);
      mockRepo.save.mockResolvedValue(fakeRecord);

      await service.getCurrentPrice("ETH", SupportedChain.ETHEREUM);
      expect(mockEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe("getHistoricalPrices", () => {
    it("queries repository with correct filters and returns mapped DTOs", async () => {
      const records: Partial<PriceRecord>[] = [
        {
          asset: "ETH",
          chain: SupportedChain.ETHEREUM,
          price: 2000,
          sourcePrices: {
            [PriceSource.CHAINLINK]: 2000,
          } as Record<PriceSource, number>,
          deviationAlert: false,
          maxDeviationPercent: 0,
          createdAt: new Date("2026-01-01"),
        },
      ];
      mockRepo.find.mockResolvedValue(records);

      const results = await service.getHistoricalPrices(
        "ETH",
        SupportedChain.ETHEREUM,
        50,
      );

      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { asset: "ETH", chain: SupportedChain.ETHEREUM },
          take: 50,
          order: { createdAt: "DESC" },
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].asset).toBe("ETH");
      expect(results[0].price).toBe(2000);
    });

    it("defaults to 100 records when no limit is given", async () => {
      mockRepo.find.mockResolvedValue([]);
      await service.getHistoricalPrices("BTC", SupportedChain.BSC);
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
