import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import { EmailService } from "./email.service";
import { EmailQueueService } from "./services/email-queue.service";
import { TemplateEngineService } from "./services/template-engine.service";
import {
  EmailLog,
  EmailStatus,
  EmailProvider,
} from "./entities/email-log.entity";
import { SendEmailDto } from "./dto/send-email.dto";

const mockEmailLogRepository = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(),
});
const mockEmailQueueService = () => ({
  enqueueEmail: jest.fn(),
  processEmail: jest.fn(),
  getPendingEmailCount: jest.fn(),
  getFailedEmailLogs: jest.fn(),
});
const mockConfigService = () => ({
  get: jest.fn(
    (key: string, fb?: any) =>
      ({ EMAIL_PROVIDER: "smtp", EMAIL_FROM: "test@alian-structure.com" })[
        key
      ] || fb,
  ),
});

describe("EmailService", () => {
  let service: EmailService;
  let emailLogRepo: jest.Mocked<Repository<EmailLog>>;
  let queueService: EmailQueueService & {
    enqueueEmail: jest.Mock;
    processEmail: jest.Mock;
    getPendingEmailCount: jest.Mock;
    getFailedEmailLogs: jest.Mock;
  };
  let templateEngine: TemplateEngineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        TemplateEngineService,
        {
          provide: getRepositoryToken(EmailLog),
          useFactory: mockEmailLogRepository,
        },
        { provide: EmailQueueService, useFactory: mockEmailQueueService },
        { provide: ConfigService, useFactory: mockConfigService },
      ],
    }).compile();
    service = module.get<EmailService>(EmailService);
    emailLogRepo = module.get(getRepositoryToken(EmailLog));
    queueService = module.get(EmailQueueService) as any;
    templateEngine = module.get<TemplateEngineService>(TemplateEngineService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("sendEmail", () => {
    it("should queue a single email", async () => {
      const dto: SendEmailDto = {
        to: ["user@example.com"],
        subject: "Test",
        html: "<p>Hello</p>",
        text: "Hello",
      };
      const saved = { id: "uuid-1", status: EmailStatus.QUEUED };
      emailLogRepo.create.mockReturnValue(saved as any);
      emailLogRepo.save.mockResolvedValue(saved as any);
      queueService.enqueueEmail.mockResolvedValue({ id: 1 } as any);
      const result = await service.sendEmail(dto);
      expect(emailLogRepo.create).toHaveBeenCalledTimes(1);
      expect(queueService.enqueueEmail).toHaveBeenCalledWith("uuid-1");
      expect(result.id).toBe("uuid-1");
    });

    it("should send to multiple recipients", async () => {
      const dto: SendEmailDto = {
        to: ["a@x.com", "b@x.com"],
        subject: "Multi",
        html: "<p>Bulk</p>",
      };
      emailLogRepo.create.mockReturnValue({ id: "x" } as any);
      emailLogRepo.save.mockResolvedValue({ id: "x" } as any);
      queueService.enqueueEmail.mockResolvedValue({ id: 1 } as any);
      await service.sendEmail(dto);
      expect(emailLogRepo.create).toHaveBeenCalledTimes(2);
    });

    it("should render template when templateName provided", async () => {
      const dto: SendEmailDto = {
        to: ["user@example.com"],
        subject: "Welcome",
        templateName: "welcome",
        templateVars: { name: "Alice" },
      };
      emailLogRepo.create.mockReturnValue({ id: "t1" } as any);
      emailLogRepo.save.mockResolvedValue({ id: "t1" } as any);
      queueService.enqueueEmail.mockResolvedValue({ id: 1 } as any);
      await service.sendEmail(dto);
      const c = emailLogRepo.create.mock.calls[0][0];
      expect(c.metadata.html).toContain("Alice");
      expect(c.metadata.html).not.toContain("{{name}}");
    });
  });

  describe("sendBulk", () => {
    it("should queue multiple emails", async () => {
      emailLogRepo.create.mockReturnValue({ id: "b1" } as any);
      emailLogRepo.save.mockResolvedValue({ id: "b1" } as any);
      queueService.enqueueEmail.mockResolvedValue({ id: 1 } as any);
      const r = await service.sendBulk({
        emails: [
          { to: ["a@x.com"], subject: "A", html: "<p>A</p>" },
          { to: ["b@x.com"], subject: "B", html: "<p>B</p>" },
        ],
      } as any);
      expect(r).toHaveLength(2);
    });
  });

  describe("getDeliveryStatus", () => {
    it("should return email log by id", async () => {
      emailLogRepo.findOne.mockResolvedValue({
        id: "u1",
        status: EmailStatus.SENT,
      } as any);
      expect((await service.getDeliveryStatus("u1")).id).toBe("u1");
    });
    it("should throw when not found", async () => {
      emailLogRepo.findOne.mockResolvedValue(null);
      await expect(service.getDeliveryStatus("missing")).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("retryFailed", () => {
    it("should requeue a failed email", async () => {
      emailLogRepo.findOne.mockResolvedValue({
        id: "f1",
        status: EmailStatus.FAILED,
      } as any);
      queueService.enqueueEmail.mockResolvedValue({ id: 1 } as any);
      await service.retryFailed("f1");
      expect(emailLogRepo.update).toHaveBeenCalledWith("f1", {
        status: EmailStatus.QUEUED,
        attempts: 0,
        errorMessage: null,
      });
    });
    it("should throw if not failed", async () => {
      emailLogRepo.findOne.mockResolvedValue({
        id: "s1",
        status: EmailStatus.SENT,
      } as any);
      await expect(service.retryFailed("s1")).rejects.toThrow(
        "not in failed status",
      );
    });
  });

  describe("unsubscribe", () => {
    it("should mark recipient as unsubscribed", async () => {
      emailLogRepo.update.mockResolvedValue({ affected: 3 } as any);
      expect((await service.unsubscribe("user@example.com")).unsubscribed).toBe(
        true,
      );
    });
  });

  describe("template rendering", () => {
    it("should render template with variables", () => {
      expect(templateEngine.renderHtml("welcome", { name: "Bob" })).toContain(
        "Bob",
      );
    });
    it("should HTML-escape variable values", () => {
      expect(
        templateEngine.renderHtml("welcome", { name: "<script>" }),
      ).not.toContain("<script>");
    });
    it("should list all default templates", () => {
      expect(templateEngine.getAllTemplates().length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("createTemplate", () => {
    it("should create and store a template", async () => {
      const r = await service.createTemplate({
        name: "custom",
        htmlContent: "<p>Hey {{name}}</p>",
        subject: "Hi {{name}}",
      } as any);
      expect(r.name).toBe("custom");
      expect(templateEngine.renderHtml("custom", { name: "Carol" })).toContain(
        "Carol",
      );
    });
  });
});
