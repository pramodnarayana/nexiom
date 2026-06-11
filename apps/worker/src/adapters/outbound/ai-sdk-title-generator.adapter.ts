import { Injectable } from "@nestjs/common";
import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import type { TitleGeneratorPort } from "../../core/ports/outbound/copilot-ports.js";

@Injectable()
export class AiSdkTitleGeneratorAdapter implements TitleGeneratorPort {
  async generateTitle(firstMessage: string): Promise<string> {
    const model = google("gemini-2.5-flash");
    const prompt = `Write a short 3 to 5 word title for a conversation that starts with the following message.
    Message: "${firstMessage}"

    Only respond with the title, do not include quotes, markdown formatting, or any extra text.`;

    const { text } = await generateText({
      model,
      prompt,
    });

    return text.trim();
  }
}
