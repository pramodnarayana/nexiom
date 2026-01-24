export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface IEmailProvider {
  sendEmail(options: SendEmailOptions): Promise<void>;
}
