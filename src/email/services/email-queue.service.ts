import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Job, Queue } from "bull";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  EmailLog,
  EmailStatus,
  EmailProvider,
} from "../entities/email-log.entity";
import {
  EmailProvider as IEmailProvider,
  SendEmailOptions,
} from "../interfaces/email-provider.interface";
import { SmtpEmailProvider } from "../providers/smtp-email.provider";
import { SendgridEmailProvider } from "../providers/sendgrid-email.provider";
import { SesEmailProvider } from "../providers/ses-email.provider";

export interface EmailJobData {
  emailLogId: string;
}

@Injectable()
export class EmailQueueService {
  private readonly logger = new Logger(EmailQueueService.name);
  private readonly providers: Map<EmailProvider, IEmailProvider>;

  constructor(
    @InjectQueue("email") private readonly emailQueue: Queue,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly smtpProvider: SmtpEmailProvider,
    private readonly sendgridProvider: SendgridEmailProvider,
    private readonly sesProvider: SesEmailProvider,
  ) {
    this.providers = new Map<EmailProvider, IEmailProvider>([
      [EmailProvider.SMTP, this.smtpProvider],
      [EmailProvider.SENDGRID, this.sendgridProvider],
      [EmailProvider.SES, this.sesProvider],
    ]);
  }

  async enqueueEmail(emailLogId: string): Promise<Job<EmailJobData>> {
    const job = await this.emailQueue.add(
      "send-email",
      { emailLogId },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.logger.log(`Email job enqueued: ${job.id} for log ${emailLogId}`);
    return job;
  }

  async processEmail(job: Job<EmailJobData>): Promise<void> {
    const { emailLogId } = job.data;
    this.logger.log(`Processing email job ${job.id} for log ${emailLogId}`);
    const emailLog = await this.emailLogRepository.findOne({
      where: { id: emailLogId },
    });
    if (!emailLog) {
      throw new Error(`EmailLog ${emailLogId} not found`);
    }
    if (emailLog.unsubscribed) {
      await this.updateStatus(
        emailLogId,
        EmailStatus.FAILED,
        "Recipient unsubscribed",
      );
      return;
    }
    if (emailLog.status === EmailStatus.DELIVERED) {
      return;
    }
    await this.updateStatus(emailLogId, EmailStatus.SENDING);
    const provider = this.providers.get(emailLog.provider);
    if (!provider) {
      throw new Error(`Provider "${emailLog.provider}" not found`);
    }
    if (!(await provider.isAvailable())) {
      throw new Error(`Provider "${emailLog.provider}" is not available`);
    }
    const options: SendEmailOptions = {
      to: emailLog.recipientEmail,
      from: emailLog.senderEmail,
      subject: emailLog.subject,
      html: emailLog.metadata?.html || "",
      text: emailLog.metadata?.text || "",
      attachments: emailLog.metadata?.attachments,
    };
    try {
      const result = await provider.sendEmail(options);
      const updatedMetadata: Record<string, any> = {
        ...(emailLog.metadata || {}),
        provider: result.provider,
        sentAt: new Date().toISOString(),
      };
      await this.emailLogRepository.update(emailLogId, {
        status: EmailStatus.SENT,
        providerMessageId: result.messageId,
        attempts: emailLog.attempts + 1,
        lastAttemptAt: new Date(),
        metadata: updatedMetadata,
      });
      this.logger.log(`Email ${emailLogId} sent via ${result.provider}`);
    } catch (err: any) {
      const attempts = emailLog.attempts + 1;
      await this.emailLogRepository.update(emailLogId, {
        attempts,
        lastAttemptAt: new Date(),
        errorMessage: err.message,
        status:
          attempts >= emailLog.maxAttempts
            ? EmailStatus.FAILED
            : EmailStatus.QUEUED,
      });
      this.logger.error(
        `Email ${emailLogId} attempt ${attempts}/${emailLog.maxAttempts} failed: ${err.message}`,
      );
      throw err;
    }
  }

  async getPendingEmailCount(): Promise<number> {
    return this.emailQueue.count();
  }
  async getFailedEmailLogs(): Promise<EmailLog[]> {
    return this.emailLogRepository.find({
      where: { status: EmailStatus.FAILED },
      order: { createdAt: "DESC" },
    });
  }

  private async updateStatus(
    id: string,
    status: EmailStatus,
    errorMessage?: string,
  ): Promise<void> {
    const updates: Partial<EmailLog> = { status };
    if (errorMessage) {
      updates.errorMessage = errorMessage;
    }
    await this.emailLogRepository.update(id, updates);
  }
}
