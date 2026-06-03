import type { SendEmailOptions } from '@soopa/identity';
export type { SendEmailOptions };

export abstract class EmailService {
  abstract sendEmail(options: SendEmailOptions): Promise<void>;
}
