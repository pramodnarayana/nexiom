import { IsArray, ArrayMaxSize, IsString, IsOptional, IsNotEmpty, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ChatMessageDto {
  @IsString()
  @IsNotEmpty()
  role!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;
}

export class ChatRequest {
  @IsArray()
  @ArrayMaxSize(50, {
    message: 'Conversation size exceeded maximum allowed limit (50).',
  })
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  @IsUUID()
  conversationId?: string;
}