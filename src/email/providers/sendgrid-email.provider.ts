import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from "../interfaces/email-provider.interface";

@Injectable()
export class SendgridEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SendgridEmailProvider.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>("SENDGRID_API_KEY");
    if (this.apiKey) {
      this.logger.log("SendGrid provider initialised");
    } else {
      this.logger.warn(
        "SendGrid provider initialised without API key -- unavailable",
      );
    }
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    if (!this.apiKey) {
      throw new Error("SendGrid API key is not configured");
    }
    this.logger.warn("SendGrid stub -- install @sendgrid/mail for production");
    const messageId = `sg-stub-${Date.now()}`;
    return { messageId, provider: "sendgrid" };
  }

  async isAvailable(): Promise<boolean> {
    return !!this.apiKey;
  }
}
