import { Injectable, Logger } from '@nestjs/common';
import { EmailService, SendEmailOptions } from './email.service.abstract';

@Injectable()
export class ConsoleEmailService implements EmailService {
    private readonly logger = new Logger(ConsoleEmailService.name);

    async sendEmail(options: SendEmailOptions): Promise<void> {
        this.logger.log(`
        ========================================
        📧 EMAIL SIMULATION (Console)
        To: ${options.to}
        Subject: ${options.subject}
        Text: ${options.text}
        (HTML content hidden in logs)
        ========================================
        `);
        return Promise.resolve();
    }
}
