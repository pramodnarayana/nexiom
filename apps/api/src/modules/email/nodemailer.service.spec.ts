import { Test, TestingModule } from '@nestjs/testing';
import { NodemailerService } from './nodemailer.service.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { MAILER_TRANSPORTER } from './email.constants.js';
import type { Mock } from 'vitest';

describe('NodemailerService', () => {
  let service: NodemailerService;
  let mockTransporter: { sendMail: Mock };

  beforeEach(async () => {
    mockTransporter = {
      sendMail: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodemailerService,
        {
          provide: MAILER_TRANSPORTER,
          useValue: mockTransporter,
        },
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                SMTP_HOST: 'smtp.example.com',
                SMTP_PORT: 587,
                SMTP_USER: 'user',
                SMTP_PASS: 'pass',
                SMTP_FROM: 'noreply@example.com',
                SMTP_SECURE: false,
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<NodemailerService>(NodemailerService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send email successfully', async () => {
    const options = {
      to: 'test@example.com',
      subject: 'Test Subject',
      html: '<p>Test Body</p>',
      text: 'Test Body',
    };

    await service.sendEmail(options);

    expect(mockTransporter.sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      ...options,
    });
  });

  it('should log error if sending fails', async () => {
    const error = new Error('Sending failed');
    mockTransporter.sendMail.mockRejectedValue(error);
    const logSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    const options = {
      to: 'to',
      subject: 'subject',
      html: 'html',
      text: 'text',
    };

    // Service swallows error and logs it
    await expect(service.sendEmail(options)).resolves.not.toThrow();

    expect(logSpy).toHaveBeenCalled();
  });
});
