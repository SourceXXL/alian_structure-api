import { Injectable, Logger } from "@nestjs/common";

export interface EmailTemplate {
  name: string;
  htmlContent: string;
  textContent?: string;
  subject?: string;
  description?: string;
}

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    name: "welcome",
    subject: "Welcome to Alian Structure!",
    htmlContent:
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h1>Welcome, {{name}}!</h1><p>Thank you for joining <strong>Alian Structure</strong>.</p><p>Your account is now active.</p></div>',
    textContent:
      "Welcome, {{name}}!\n\nThank you for joining Alian Structure.\nYour account is now active.",
    description: "Sent to new users upon registration",
  },
  {
    name: "password-reset",
    subject: "Password Reset Request",
    htmlContent:
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h1>Password Reset</h1><p>Hi {{name}},</p><p>We received a request to reset your password.</p><p><a href="{{resetUrl}}" style="display:inline-block;padding:10px 20px;background:#0066ff;color:#fff;text-decoration:none;border-radius:4px">Reset Password</a></p><p>This link expires in <strong>{{expiresIn}}</strong>.</p></div>',
    textContent:
      "Hi {{name}},\n\nReset link: {{resetUrl}}\nThis link expires in {{expiresIn}}.",
    description: "Sent when a user requests a password reset",
  },
  {
    name: "notification",
    subject: "{{title}}",
    htmlContent:
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h2>{{title}}</h2><p>Hi {{name}},</p><p>{{message}}</p><p style="color:#888;font-size:12px">Unsubscribe: <a href="{{unsubscribeUrl}}">Click here</a></p></div>',
    textContent:
      "Hi {{name}},\n\n{{title}}\n\n{{message}}\n\nUnsubscribe: {{unsubscribeUrl}}",
    description: "General notification email",
  },
  {
    name: "email-verification",
    subject: "Verify Your Email Address",
    htmlContent:
      '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><h1>Verify Your Email</h1><p>Hi {{name}},</p><p>Please verify your email address:</p><p><a href="{{verificationUrl}}" style="display:inline-block;padding:10px 20px;background:#0066ff;color:#fff;text-decoration:none;border-radius:4px">Verify Email</a></p><p>This link expires in <strong>{{expiresIn}}</strong>.</p></div>',
    textContent:
      "Hi {{name}},\n\nVerify your email: {{verificationUrl}}\nThis link expires in {{expiresIn}}.",
    description: "Sent to verify a user email address",
  },
];

@Injectable()
export class TemplateEngineService {
  private readonly logger = new Logger(TemplateEngineService.name);
  private readonly templates = new Map<string, EmailTemplate>();

  constructor() {
    for (const tpl of DEFAULT_TEMPLATES) {
      this.templates.set(tpl.name, tpl);
    }
    this.logger.log(
      `TemplateEngineService initialized with ${this.templates.size} default templates`,
    );
  }

  getTemplate(name: string): EmailTemplate | undefined {
    return this.templates.get(name);
  }
  getAllTemplates(): EmailTemplate[] {
    return Array.from(this.templates.values());
  }

  createTemplate(template: EmailTemplate): EmailTemplate {
    if (this.templates.has(template.name)) {
      this.logger.warn(
        `Template "${template.name}" already exists -- overwriting`,
      );
    }
    this.templates.set(template.name, template);
    return template;
  }

  renderHtml(
    templateName: string,
    variables: Record<string, any> = {},
  ): string {
    const tpl = this.templates.get(templateName);
    if (!tpl) {
      throw new Error(`Template "${templateName}" not found`);
    }
    return this.render(tpl.htmlContent, variables);
  }

  renderText(
    templateName: string,
    variables: Record<string, any> = {},
  ): string {
    const tpl = this.templates.get(templateName);
    if (!tpl) {
      throw new Error(`Template "${templateName}" not found`);
    }
    return this.render(
      tpl.textContent || this.stripHtml(tpl.htmlContent),
      variables,
    );
  }

  renderSubject(
    templateName: string,
    variables: Record<string, any> = {},
  ): string {
    const tpl = this.templates.get(templateName);
    if (!tpl) {
      throw new Error(`Template "${templateName}" not found`);
    }
    return this.render(tpl.subject || "No Subject", variables);
  }

  generatePlainText(html: string): string {
    return this.stripHtml(html);
  }

  private render(template: string, variables: Record<string, any>): string {
    let result = template;
    result = result.replace(
      /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
      (_m, key: string, content: string) =>
        variables[key] ? this.render(content, variables) : "",
    );
    result = result.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
      if (key in variables && variables[key] != null) {
        return this.escapeHtml(String(variables[key]));
      }
      this.logger.warn(`Template variable "${key}" is missing`);
      return "";
    });
    return result;
  }

  private escapeHtml(value: string): string {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "/": "&#x2F;",
    };
    return value.replace(/[&<>"'/]/g, (c) => map[c] || c);
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
