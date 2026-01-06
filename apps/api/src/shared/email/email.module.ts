import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailService } from './email.service.abstract';
import { NodemailerService } from './nodemailer.service';
import { ConsoleEmailService } from './console-email.service';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: EmailService,
            useFactory: (configService: ConfigService) => {
                const mailMockEnv = configService.get<string>('MAIL_MOCK');
                const useMock = mailMockEnv === 'true' || mailMockEnv === undefined; // Default to true if undefined
                if (useMock) {
                    return new ConsoleEmailService();
                }
                return new NodemailerService(configService);
            },
            inject: [ConfigService],
        },
    ],
    exports: [EmailService],
})
export class EmailModule { }
