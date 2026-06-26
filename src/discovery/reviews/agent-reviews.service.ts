import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AgentReview, ReviewStatus } from "./entities/agent-review.entity";
import {
  CreateReviewDto,
  DeveloperResponseDto,
  ModerateReviewDto,
  ReviewQueryDto,
} from "./dto/review.dto";

/** Naive keyword-based spam detection — no external dependency. Returns score 0..1. */
function computeSpamScore(text: string): number {
  if (!text) return 0;
  const spamPatterns = [
    /\b(buy|sell|cheap|discount|free|click here|http[s]?:\/\/)\b/gi,
    /(.)\1{4,}/g, // repeated chars e.g. "aaaaa"
    /[A-Z]{5,}/g, // long uppercase runs
  ];
  let hits = 0;
  for (const p of spamPatterns) {
    const m = text.match(p);
    if (m) hits += m.length;
  }
  return Math.min(1, hits / 10);
}

export interface AgentRatingAggregation {
  agentId: string;
  averageRating: number;
  totalReviews: number;
  ratingDistribution: Record<number, number>;
}

@Injectable()
export class AgentReviewsService {
  constructor(
    @InjectRepository(AgentReview)
    private readonly reviewRepo: Repository<AgentReview>,
  ) {}

  /**
   * Submit a review. Only one review per user per agent (enforced at DB + service level).
   * The caller must have used the agent (verified upstream — hasUsedAgent flag passed in).
   */
  async createReview(
    userId: string,
    dto: CreateReviewDto,
    hasUsedAgent: boolean,
  ): Promise<AgentReview> {
    if (!hasUsedAgent) {
      throw new ForbiddenException(
        "Only users who have used this agent can review it",
      );
    }

    const existing = await this.reviewRepo.findOne({
      where: { agentId: dto.agentId, userId },
    });
    if (existing) {
      throw new ConflictException(
        "You have already reviewed this agent",
      );
    }

    const spamScore = computeSpamScore(dto.reviewText ?? "");
    const status =
      spamScore >= 0.5 ? ReviewStatus.FLAGGED : ReviewStatus.PENDING;

    const review = this.reviewRepo.create({
      agentId: dto.agentId,
      userId,
      rating: dto.rating,
      reviewText: dto.reviewText ?? null,
      spamScore,
      status,
    });

    return this.reviewRepo.save(review);
  }

  /** Get approved reviews for an agent (for public discovery). */
  async getApprovedReviews(agentId: string): Promise<AgentReview[]> {
    return this.reviewRepo.find({
      where: { agentId, status: ReviewStatus.APPROVED },
      order: { createdAt: "DESC" },
    });
  }

  /** Aggregate ratings for an agent — used by scoring engine. */
  async getAggregation(agentId: string): Promise<AgentRatingAggregation> {
    const reviews = await this.reviewRepo.find({
      where: { agentId, status: ReviewStatus.APPROVED },
      select: ["rating"],
    });

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of reviews) {
      distribution[r.rating] = (distribution[r.rating] ?? 0) + 1;
      sum += r.rating;
    }

    return {
      agentId,
      averageRating: reviews.length ? sum / reviews.length : 0,
      totalReviews: reviews.length,
      ratingDistribution: distribution,
    };
  }

  /** Developer responds to a review on their agent. */
  async addDeveloperResponse(
    reviewId: string,
    developerId: string,
    dto: DeveloperResponseDto,
  ): Promise<AgentReview> {
    const review = await this.findOrFail(reviewId);
    // In a real system, verify developerId owns the agent. Here we accept the claim.
    review.developerResponse = dto.response;
    review.developerRespondedAt = new Date();
    return this.reviewRepo.save(review);
  }

  /** Admin moderation: approve / reject / flag a review. */
  async moderateReview(
    reviewId: string,
    dto: ModerateReviewDto,
  ): Promise<AgentReview> {
    const review = await this.findOrFail(reviewId);
    review.status = dto.status as ReviewStatus;
    if (dto.moderationNote) review.moderationNote = dto.moderationNote;
    return this.reviewRepo.save(review);
  }

  /** Moderation dashboard: list reviews by status (admin only). */
  async listForModeration(query: ReviewQueryDto): Promise<AgentReview[]> {
    const where: Partial<AgentReview> = {};
    if (query.agentId) where.agentId = query.agentId;
    if (query.status) where.status = query.status as ReviewStatus;
    return this.reviewRepo.find({ where, order: { createdAt: "DESC" } });
  }

  /**
   * Return the average user rating for an agent (approved reviews only).
   * Used by AgentScoring to feed the userRating field (0–5).
   */
  async getUserRatingForScoring(agentId: string): Promise<number> {
    const { averageRating } = await this.getAggregation(agentId);
    return averageRating;
  }

  private async findOrFail(id: string): Promise<AgentReview> {
    const review = await this.reviewRepo.findOne({ where: { id } });
    if (!review) throw new NotFoundException(`Review ${id} not found`);
    return review;
  }
}
