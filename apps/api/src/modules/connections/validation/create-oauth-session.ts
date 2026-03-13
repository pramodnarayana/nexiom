import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';

import { VALID_PROVIDER_NAME_REGEX } from './constants.js';

import { IsVendorConfig } from './vendor-config.validator.js';

export class CreateOAuthSession {
  @IsString()
  @IsNotEmpty()
  @Matches(VALID_PROVIDER_NAME_REGEX, {
    message: 'Invalid provider name format',
  })
  providerName!: string;

  /** Optional — may be empty on reconnect when the server already holds the stored credential. */
  @IsString()
  @IsOptional()
  clientId?: string;

  @IsVendorConfig()
  @IsOptional()
  vendorParams?: Record<string, string | boolean | number>;
}
