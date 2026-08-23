export interface SendEmailOptions {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
  cid?: string;
}

export interface SendEmailResult {
  messageId: string;
  provider: string;
}

export interface EmailProvider {
  sendEmail(options: SendEmailOptions): Promise<SendEmailResult>;
  isAvailable(): Promise<boolean>;
}
