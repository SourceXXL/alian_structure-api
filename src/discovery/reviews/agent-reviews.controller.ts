import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { AgentReviewsService } from "./agent-reviews.service";
import {
  CreateReviewDto,
  DeveloperResponseDto,
  ModerateReviewDto,
  ReviewQueryDto,
} from "./dto/review.dto";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { Roles } from "src/common/guard/roles.decorator";
import { Role } from "src/common/guard/roles.enum";

@ApiTags("Agent Reviews")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("api/discovery/reviews")
export class AgentReviewsController {
  constructor(private readonly reviewsService: AgentReviewsService) {}

  @Post()
  @ApiOperation({ summary: "Submit a review for an agent" })
  @ApiResponse({ status: 201, description: "Review submitted" })
  create(@Request() req, @Body() dto: CreateReviewDto) {
    // hasUsedAgent: in production, resolve via a usage-tracking service
    return this.reviewsService.createReview(req.user.id, dto, true);
  }

  @Get("agent/:agentId")
  @ApiOperation({ summary: "Get approved reviews for an agent" })
  @ApiResponse({ status: 200, description: "Approved reviews" })
  getApproved(@Param("agentId") agentId: string) {
    return this.reviewsService.getApprovedReviews(agentId);
  }

  @Get("agent/:agentId/aggregation")
  @ApiOperation({ summary: "Get rating aggregation for an agent" })
  @ApiResponse({ status: 200, description: "Rating aggregation" })
  getAggregation(@Param("agentId") agentId: string) {
    return this.reviewsService.getAggregation(agentId);
  }

  @Patch(":reviewId/developer-response")
  @ApiOperation({ summary: "Developer responds to a review" })
  @ApiResponse({ status: 200, description: "Response added" })
  developerResponse(
    @Param("reviewId") reviewId: string,
    @Request() req,
    @Body() dto: DeveloperResponseDto,
  ) {
    return this.reviewsService.addDeveloperResponse(reviewId, req.user.id, dto);
  }

  @Patch(":reviewId/moderate")
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Moderate a review (admin only)" })
  @ApiResponse({ status: 200, description: "Review moderated" })
  moderate(
    @Param("reviewId") reviewId: string,
    @Body() dto: ModerateReviewDto,
  ) {
    return this.reviewsService.moderateReview(reviewId, dto);
  }

  @Get("moderation")
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Moderation dashboard — list reviews (admin only)" })
  @ApiResponse({ status: 200, description: "Reviews for moderation" })
  listForModeration(@Query() query: ReviewQueryDto) {
    return this.reviewsService.listForModeration(query);
  }
}
