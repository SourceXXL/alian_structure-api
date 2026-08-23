import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from "../interfaces/email-provider.interface";

@Injectable()
export class SesEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SesEmailProvider.name);
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    this.configured = !!(
      this.configService.get<string>("AWS_SES_REGION") &&
      this.configService.get<string>("AWS_ACCESS_KEY_ID") &&
      this.configService.get<string>("AWS_SECRET_ACCESS_KEY")
    );
    if (this.configured) {
      this.logger.log("SES provider initialised");
    } else {
      this.logger.warn(
        "SES provider initialised without AWS credentials -- unavailable",
      );
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.configured) {
      throw new Error("AWS SES credentials are not configured");
    }
    this.logger.warn("SES stub -- install @aws-sdk/client-ses for production");
    const messageId = `ses-stub-${Date.now()}`;
    return { messageId, provider: "ses" };
  }

  async isAvailable(): Promise<boolean> {
    return this.configured;
  }
}
