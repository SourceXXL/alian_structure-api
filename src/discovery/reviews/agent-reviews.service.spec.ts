import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { AgentReviewsService } from "./agent-reviews.service";
import { AgentReview, ReviewStatus } from "./entities/agent-review.entity";

const mockRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

describe("AgentReviewsService", () => {
  let service: AgentReviewsService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentReviewsService,
        { provide: getRepositoryToken(AgentReview), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(AgentReviewsService);
    repo = module.get(getRepositoryToken(AgentReview));
  });

  describe("createReview", () => {
    const dto = { agentId: "agent-1", rating: 4, reviewText: "Great agent!" };

    it("throws ForbiddenException if user has not used agent", async () => {
      await expect(
        service.createReview("user-1", dto, false),
      ).rejects.toThrow(ForbiddenException);
    });

    it("throws ConflictException if review already exists", async () => {
      repo.findOne.mockResolvedValue({ id: "existing" });
      await expect(
        service.createReview("user-1", dto, true),
      ).rejects.toThrow(ConflictException);
    });

    it("creates review with PENDING status for clean text", async () => {
      repo.findOne.mockResolvedValue(null);
      const created = { ...dto, userId: "user-1", status: ReviewStatus.PENDING, spamScore: 0 };
      repo.create.mockReturnValue(created);
      repo.save.mockResolvedValue(created);

      const result = await service.createReview("user-1", dto, true);
      expect(result.status).toBe(ReviewStatus.PENDING);
      expect(repo.save).toHaveBeenCalled();
    });

    it("flags review with FLAGGED status for spammy text", async () => {
      repo.findOne.mockResolvedValue(null);
      const spamDto = { ...dto, reviewText: "buy buy buy buy buy buy buy buy buy buy buy" };
      repo.create.mockImplementation((data) => data);
      repo.save.mockImplementation((data) => Promise.resolve(data));

      const result = await service.createReview("user-1", spamDto, true);
      expect(result.status).toBe(ReviewStatus.FLAGGED);
    });
  });

  describe("getAggregation", () => {
    it("returns zero aggregation when no approved reviews", async () => {
      repo.find.mockResolvedValue([]);
      const agg = await service.getAggregation("agent-1");
      expect(agg.averageRating).toBe(0);
      expect(agg.totalReviews).toBe(0);
    });

    it("calculates average rating correctly", async () => {
      repo.find.mockResolvedValue([{ rating: 4 }, { rating: 2 }]);
      const agg = await service.getAggregation("agent-1");
      expect(agg.averageRating).toBe(3);
      expect(agg.totalReviews).toBe(2);
    });
  });

  describe("addDeveloperResponse", () => {
    it("adds developer response to review", async () => {
      const review = { id: "r1", developerResponse: null, developerRespondedAt: null };
      repo.findOne.mockResolvedValue(review);
      repo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.addDeveloperResponse(
        "r1", "dev-1", { response: "Thanks!" }
      );
      expect(result.developerResponse).toBe("Thanks!");
      expect(result.developerRespondedAt).toBeInstanceOf(Date);
    });

    it("throws NotFoundException for missing review", async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.addDeveloperResponse("bad-id", "dev-1", { response: "x" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("moderateReview", () => {
    it("updates review status and note", async () => {
      const review = { id: "r1", status: ReviewStatus.PENDING, moderationNote: null };
      repo.findOne.mockResolvedValue(review);
      repo.save.mockImplementation((r) => Promise.resolve(r));

      const result = await service.moderateReview("r1", {
        status: "approved",
        moderationNote: "Looks good",
      });
      expect(result.status).toBe("approved");
      expect(result.moderationNote).toBe("Looks good");
    });
  });

  describe("getUserRatingForScoring", () => {
    it("returns average rating for scoring engine", async () => {
      repo.find.mockResolvedValue([{ rating: 5 }, { rating: 3 }]);
      const rating = await service.getUserRatingForScoring("agent-1");
      expect(rating).toBe(4);
    });
  });
});
