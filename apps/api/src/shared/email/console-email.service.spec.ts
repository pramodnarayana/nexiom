import { Test, TestingModule } from '@nestjs/testing';
import { ConsoleEmailService } from './console-email.service';

describe('ConsoleEmailService', () => {
  let service: ConsoleEmailService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConsoleEmailService],
    }).compile();

    service = module.get<ConsoleEmailService>(ConsoleEmailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmail', () => {
    it('should log email details and return void', async () => {
      // We don't verify the exact log output because it uses a private logger instance
      // and ConsoleEmailService is mainly for dev.
      // We just ensure it runs without error.
      const options = {
        to: 'test@example.com',
        subject: 'Test',
        text: 'Body',
      };
      await expect(service.sendEmail(options)).resolves.not.toThrow();
    });
  });
});
