
export interface SendEmailOptions {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export abstract class EmailService {
    abstract sendEmail(options: SendEmailOptions): Promise<void>;
}
