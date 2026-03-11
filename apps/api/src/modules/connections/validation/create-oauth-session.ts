import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Matches,
} from 'class-validator';

import { VALID_PROVIDER_NAME_REGEX } from './constants.js';

export class CreateOAuthSession {
  @IsString()
  @IsNotEmpty()
  @Matches(VALID_PROVIDER_NAME_REGEX, {
    message: 'Invalid provider name format',
  })
  providerName!: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsObject()
  @IsOptional()
  vendorParams?: Record<string, string | boolean | number>;
}
