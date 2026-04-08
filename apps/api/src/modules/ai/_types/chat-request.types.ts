import { IsArray, ArrayMaxSize } from 'class-validator';

export class ChatRequest {
  // Validate that it's an array, but do not aggressively whitelist internal properties
  // since the Vercel AI SDK has a complex union of toolInvocations, multi-part contents, and metadata.
  // We defer the strict validation to the `streamText({ messages })` function natively.
  @IsArray()
  @ArrayMaxSize(50, {
    message: 'Conversation size exceeded maximum allowed limit (50).',
  })
  messages!: any[];
}
