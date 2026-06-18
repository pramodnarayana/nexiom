import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  IsObject,
} from 'class-validator';

import { VALID_PROVIDER_NAME_REGEX } from './constants.js';

export class ExchangeOAuthCode {
  @IsString()
  @IsNotEmpty()
  @Matches(VALID_PROVIDER_NAME_REGEX, {
    message: 'Invalid provider name format',
  })
  providerName!: string;

  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsOptional()
  clientId?: string;

  @IsString()
  @IsOptional()
  clientSecret?: string;

  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsOptional()
  @IsString()
  @IsUUID('4', { message: 'dataSourceId must be a valid UUID v4' })
  dataSourceId?: string;

  @IsOptional()
  @IsString()
  organizationId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, {
    message:
      'appProfile must contain only lowercase letters, numbers, and hyphens, and start with a letter or number',
  })
  appProfile?: string;

  @IsOptional()
  @IsObject()
  vendorParams?: Record<string, string | boolean | number>;
}
