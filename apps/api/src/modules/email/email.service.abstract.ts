import type { SendEmailOptions } from '@nexiom/identity';
export type { SendEmailOptions };

export abstract class EmailService {
  abstract sendEmail(options: SendEmailOptions): Promise<void>;
}
