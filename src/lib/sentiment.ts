import OpenAI from "openai";
import { logger } from "@trigger.dev/sdk";

/**
 * Single-word sentiment label for an email. Written to the sheet as its own
 * column, so keep the value set stable — downstream filters key off these
 * exact strings.
 */
export const SENTIMENTS = ["happy", "neutral", "angry"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

// Azure OpenAI resource (caffine-openai, eastus) via its OpenAI-compatible v1
// endpoint. Runs on the existing gpt-4.1 deployment so usage bills as
// first-party Azure consumption (covered by Azure credits), not Marketplace.
const AZURE_OPENAI_ENDPOINT =
  process.env.AZURE_OPENAI_ENDPOINT?.trim() ??
  "https://caffine-openai.openai.azure.com/openai/v1";
const AZURE_OPENAI_DEPLOYMENT =
  process.env.AZURE_OPENAI_DEPLOYMENT?.trim() ?? "gpt-4.1";

// Lazy singleton (mirrors getComposio): constructing the client at module load
// with a missing key would crash every task import in the bundle — not just
// the poll that needs it. Set AZURE_OPENAI_API_KEY in the Trigger.dev
// dashboard alongside WATCH_SENDER / TARGET_SHEET_ID.
let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("AZURE_OPENAI_API_KEY is not set");
  }
  _openai = new OpenAI({ apiKey, baseURL: AZURE_OPENAI_ENDPOINT });
  return _openai;
}

/**
 * Classify one email's tone with a single LLM call. Any failure (API error,
 * off-vocabulary reply) degrades to "neutral" rather than failing the poll —
 * a missing sentiment shouldn't stop the row from reaching the sheet.
 */
export async function classifySentiment(email: {
  subject: string;
  snippet: string;
}): Promise<Sentiment> {
  try {
    const response = await getOpenAI().chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT,
      max_completion_tokens: 16,
      messages: [
        {
          role: "system",
          content:
            "You classify the emotional tone of emails. Respond with exactly one word: happy, neutral, or angry. No punctuation, no explanation.",
        },
        {
          role: "user",
          content: `Subject: ${email.subject}\n\nBody: ${email.snippet}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content?.trim().toLowerCase();

    if (text && (SENTIMENTS as readonly string[]).includes(text)) {
      return text as Sentiment;
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
