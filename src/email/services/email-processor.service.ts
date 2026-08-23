import { Process, Processor } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { EmailQueueService, EmailJobData } from "./email-queue.service";

@Processor("email")
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);
  constructor(private readonly queueService: EmailQueueService) {}

  @Process("send-email")
  async handleSendEmail(job: Job<EmailJobData>) {
    this.logger.log(`Processing email job ${job.id}`);
    return this.queueService.processEmail(job);
  }
}
