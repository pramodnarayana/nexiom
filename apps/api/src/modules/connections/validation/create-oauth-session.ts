import {
  IsString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Matches,
} from 'class-validator';

const VALID_PROVIDER_NAME_REGEX = /^[A-Za-z0-9_-]+$/;

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
