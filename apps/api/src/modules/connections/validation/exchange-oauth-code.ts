import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
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
  @IsNotEmpty()
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @IsString()
  @IsNotEmpty()
  state!: string;

  @IsString()
  @IsNotEmpty()
  displayName!: string;

  @IsOptional()
  @IsString()
  @IsUUID('4', { message: 'connectionId must be a valid UUID v4' })
  connectionId?: string;
}
