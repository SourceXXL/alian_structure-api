import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from "@nestjs/swagger";
import { EmailService } from "./email.service";
import {
  SendEmailDto,
  SendBulkEmailDto,
  CreateTemplateDto,
} from "./dto/send-email.dto";

@ApiTags("Email")
@ApiBearerAuth()
@Controller("email")
export class EmailController {
  private readonly logger = new Logger(EmailController.name);
  constructor(private readonly emailService: EmailService) {}

  @Post("send")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Send a single email" })
  @ApiResponse({ status: 201 })
  async sendEmail(@Body() dto: SendEmailDto) {
    return { success: true, emailLog: await this.emailService.sendEmail(dto) };
  }

  @Post("send-bulk")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Send bulk emails" })
  @ApiResponse({ status: 201 })
  async sendBulkEmail(@Body() dto: SendBulkEmailDto) {
    const r = await this.emailService.sendBulk(dto);
    return { success: true, count: r.length, emailLogs: r };
  }

  @Get("status/:id")
  @ApiOperation({ summary: "Get email delivery status" })
  @ApiParam({ name: "id" })
  async getStatus(@Param("id") id: string) {
    return {
      success: true,
      emailLog: await this.emailService.getDeliveryStatus(id),
    };
  }

  @Post("retry/:id")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Retry a failed email" })
  @ApiParam({ name: "id" })
  async retryFailed(@Param("id") id: string) {
    return { success: true, emailLog: await this.emailService.retryFailed(id) };
  }

  @Post("unsubscribe")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Unsubscribe from notification emails" })
  async unsubscribe(@Body("email") email: string) {
    return this.emailService.unsubscribe(email);
  }

  @Get("templates")
  @ApiOperation({ summary: "Get all email templates" })
  async getTemplates() {
    return { success: true, templates: await this.emailService.getTemplates() };
  }

  @Post("templates")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Create a new email template" })
  async createTemplate(@Body() dto: CreateTemplateDto) {
    return {
      success: true,
      template: await this.emailService.createTemplate(dto),
    };
  }
}
