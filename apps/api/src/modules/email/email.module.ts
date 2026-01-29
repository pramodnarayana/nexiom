import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { EmailService } from './email.service.abstract';
import { NodemailerService } from './nodemailer.service';
import { ConsoleEmailService } from './console-email.service';
import { MAILER_TRANSPORTER } from './email.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAILER_TRANSPORTER,
      useFactory: (configService: ConfigService) => {
        const mailMockEnv = configService.get<string>('MAIL_MOCK');
        const useMock = mailMockEnv === 'true';

        if (useMock) {
          return null;
        }

        return nodemailer.createTransport({
          host: configService.get<string>('SMTP_HOST'),
          port: Number(configService.get<string>('SMTP_PORT')) || 587,
          secure: configService.get<string>('SMTP_SECURE') === 'true',
          auth: {
            user: configService.get<string>('SMTP_USER'),
            pass: configService.get<string>('SMTP_PASS'),
          },
        });
      },
      inject: [ConfigService],
    },
    {
      provide: EmailService,
      useFactory: (
        configService: ConfigService,
        transporter: nodemailer.Transporter | null,
      ) => {
        if (!transporter) {
          return new ConsoleEmailService();
        }
        return new NodemailerService(configService, transporter);
      },
      inject: [ConfigService, MAILER_TRANSPORTER],
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
