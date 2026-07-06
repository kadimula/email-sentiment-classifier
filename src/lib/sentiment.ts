import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@trigger.dev/sdk";

/**
 * Single-word sentiment label for an email. Written to the sheet as its own
 * column, so keep the value set stable — downstream filters key off these
 * exact strings.
 */
export type Sentiment = "happy" | "neutral" | "angry";

// Reads ANTHROPIC_API_KEY from the environment — set it in the Trigger.dev
// dashboard alongside WATCH_SENDER / TARGET_SHEET_ID.
const anthropic = new Anthropic();

/**
 * Classify one email's tone with a single Claude call. Any failure (API error,
 * off-vocabulary reply) degrades to "neutral" rather than failing the poll —
 * a missing sentiment shouldn't stop the row from reaching the sheet.
 */
export async function classifySentiment(email: {
  subject: string;
  snippet: string;
}): Promise<Sentiment> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16,
      system:
        "You classify the emotional tone of emails. Respond with exactly one word: happy, neutral, or angry. No punctuation, no explanation.",
      messages: [
        {
          role: "user",
          content: `Subject: ${email.subject}\n\nBody: ${email.snippet}`,
        },
      ],
    });

    const text = response.content
      .find((block) => block.type === "text")
      ?.text.trim()
      .toLowerCase();

    if (text === "happy" || text === "neutral" || text === "angry") {
      return text;
    }
    logger.warn("Sentiment reply outside vocabulary — defaulting to neutral", {
      reply: text,
    });
    return "neutral";
  } catch (error) {
    logger.warn("Sentiment classification failed — defaulting to neutral", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "neutral";
  }
}
