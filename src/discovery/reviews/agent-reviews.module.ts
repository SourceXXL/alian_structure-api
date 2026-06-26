import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AgentReview } from "./entities/agent-review.entity";
import { AgentReviewsService } from "./agent-reviews.service";
import { AgentReviewsController } from "./agent-reviews.controller";

@Module({
  imports: [TypeOrmModule.forFeature([AgentReview])],
  providers: [AgentReviewsService],
  controllers: [AgentReviewsController],
  exports: [AgentReviewsService],
})
export class AgentReviewsModule {}
