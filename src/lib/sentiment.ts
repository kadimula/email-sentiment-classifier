import Anthropic from "@anthropic-ai/sdk";
import { logger } from "@trigger.dev/sdk";

/**
 * Single-word sentiment label for an email. Written to the sheet as its own
 * column, so keep the value set stable — downstream filters key off these
 * exact strings.
 */
export const SENTIMENTS = ["happy", "neutral", "angry"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

// Override via ANTHROPIC_MODEL to trade cost for quality (e.g. claude-haiku-4-5).
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL?.trim() ?? "claude-opus-4-8";

// Lazy singleton (mirrors getComposio): constructing the client at module load
// with a missing key would crash every task import in the bundle — not just
// the poll that needs it. Set ANTHROPIC_API_KEY in the Trigger.dev dashboard
// alongside WATCH_SENDER / TARGET_SHEET_ID.
let _anthropic: Anthropic | null = null;

function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

/**
 * Classify one email's tone with a single LLM call. Any failure (API error,
 * refusal, off-vocabulary reply) degrades to "neutral" rather than failing the
 * poll — a missing sentiment shouldn't stop the row from reaching the sheet.
 */
export async function classifySentiment(email: {
  subject: string;
  snippet: string;
}): Promise<Sentiment> {
  try {
    const response = await getAnthropic().messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 256,
      system:
        "You classify the emotional tone of emails. Respond with exactly one word: happy, neutral, or angry. No punctuation, no explanation.",
      messages: [
        {
          role: "user",
          content: `Subject: ${email.subject}\n\nBody: ${email.snippet}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    const text = block?.text.trim().toLowerCase();

    if (text && (SENTIMENTS as readonly string[]).includes(text)) {
      return text as Sentiment;
    }
    logger.warn("Sentiment reply outside vocabulary — defaulting to neutral", {
      reply: text,
      stopReason: response.stop_reason,
    });
    return "neutral";
  } catch (error) {
    logger.warn("Sentiment classification failed — defaulting to neutral", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "neutral";
  }
}
