import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService, SendEmailOptions } from './email.service.abstract';

@Injectable()
export class NodemailerService implements EmailService {
    private transporter: nodemailer.Transporter;
    private readonly logger = new Logger(NodemailerService.name);

    constructor(private readonly configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('SMTP_HOST'),
            port: this.configService.get<number>('SMTP_PORT'),
            secure: this.configService.get<boolean>('SMTP_SECURE', false),
            auth: {
                user: this.configService.get<string>('SMTP_USER'),
                pass: this.configService.get<string>('SMTP_PASS'),
            },
        });
    }

    async sendEmail(options: SendEmailOptions): Promise<void> {
        this.logger.log(`Sending email to ${options.to} via Nodemailer...`);
        try {
            const from = this.configService.get<string>('SMTP_FROM', '"No Reply" <noreply@example.com>');
            await this.transporter.sendMail({
                from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            });
            this.logger.log(`Email sent successfully to ${options.to}`);
        } catch (error) {
            this.logger.error(`Failed to send email to ${options.to}`, error);
            // Don't throw, just log. Or throw if you want to fail the action.
        }
    }
}
