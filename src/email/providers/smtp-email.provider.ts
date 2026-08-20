import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import {
  EmailProvider,
  SendEmailOptions,
  SendEmailResult,
} from "../interfaces/email-provider.interface";

@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>("SMTP_HOST", "localhost"),
      port: this.configService.get<number>("SMTP_PORT", 587),
      secure: this.configService.get<boolean>("SMTP_SECURE", false),
      auth: {
        user: this.configService.get<string>("SMTP_USER"),
        pass: this.configService.get<string>("SMTP_PASS"),
      },
      tls: {
        rejectUnauthorized: this.configService.get<boolean>(
          "SMTP_TLS_REJECT_UNAUTHORIZED",
          true,
        ),
      },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
    });
    this.logger.log("SMTP transporter initialised");
  }

  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const info = await this.transporter.sendMail({
      from: options.from,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments: options.attachments,
      headers: options.headers,
    });
    this.logger.log(`SMTP message sent: ${info.messageId}`);
    return { messageId: info.messageId, provider: "smtp" };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch (err: any) {
      this.logger.warn(`SMTP check failed: ${err.message}`);
      return false;
    }
  }
}
