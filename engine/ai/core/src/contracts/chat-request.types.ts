import { IsArray, ArrayMaxSize, IsString, IsOptional } from 'class-validator';

export class ChatRequest {
  @IsArray()
  @ArrayMaxSize(50, {
    message: 'Conversation size exceeded maximum allowed limit (50).',
  })
  messages!: any[];

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  conversationId?: string;
}
