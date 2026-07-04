import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_PROMPT } from "./prompt";
import { parseExtraction, type Extraction } from "./schema";

// The register spec locks extraction to claude-sonnet-4-6 (vision).
const MODEL = "claude-sonnet-4-6";

/**
 * Run one extraction call with all photos of a single Z-report strip,
 * in top-to-bottom order. Photos are client-compressed JPEGs (≤1600px).
 */
export async function extractZReport(
  apiKey: string,
  photos: ArrayBuffer[],
): Promise<Extraction> {
  const client = new Anthropic({ apiKey });

  const imageBlocks = photos.map((buf) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: toBase64(buf),
    },
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: EXTRACTION_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...imageBlocks,
          {
            type: "text",
            text: `These ${photos.length} photo(s) show one Z-report strip, top to bottom. Extract the JSON.`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseExtraction(text);
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
