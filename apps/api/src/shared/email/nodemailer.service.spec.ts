import { Test, TestingModule } from '@nestjs/testing';
import { NodemailerService } from './nodemailer.service';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

// Mock Nodemailer logic
const mockSendMail = jest.fn();

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

describe('NodemailerService', () => {
  let service: NodemailerService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'SMTP_HOST') return 'smtp.test.com';
      if (key === 'SMTP_PORT') return 587;
      if (key === 'SMTP_USER') return 'user';
      if (key === 'SMTP_PASS') return 'pass';
      if (key === 'SMTP_SECURE') return false;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // ensure factory mock is fresh
    (nodemailer.createTransport as jest.Mock).mockReturnValue({
      sendMail: mockSendMail,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NodemailerService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<NodemailerService>(NodemailerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    // createTransport is called in constructor
    expect(nodemailer.createTransport).toHaveBeenCalled();
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const options = {
        to: 'test@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
      };
      mockSendMail.mockResolvedValue({});

      await service.sendEmail(options);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: options.to,
          subject: options.subject,
          text: options.text,
        }),
      );
    });

    it('should log error when sending fails', async () => {
      const options = { to: 'fail@example.com', subject: 'Fail', text: 'Fail' };
      Object.assign(options, { subject: 'Failure' }); // Just ensuring object structure

      const error = new Error('SMTP Error');
      mockSendMail.mockRejectedValue(error);

      // Our service catches the error and logs it. It does not throw.
      await expect(service.sendEmail(options)).resolves.not.toThrow();
    });
  });
});
