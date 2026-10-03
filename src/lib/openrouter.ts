/**
 * OpenRouter API client for ThumbForge
 * Handles both text (analysis) and image generation calls
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

import { put } from "@vercel/blob";
// Models
export const MODELS = {
  // Text analysis
  ANALYSIS: "z-ai/glm-5.3-flash",
  // Image generation
  IMAGE_FLASH: "bytedance-seed/seedream-5-0-flash",
  IMAGE_PRO: "bytedance-seed/seedream-5-0-pro",
  IMAGE_FLUX: "inclusionai/ming-image-0.1-design-layer",
} as const;

interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
      // OpenRouter returns generated images in a separate `images` array
      images?: Array<{
        type: string;
        image_url: { url: string };
        index: number;
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Call OpenRouter for text completion (video analysis, text suggestions)
 */
export async function textCompletion(
  messages: OpenRouterMessage[],
  options: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/empowerment-ai/thumbforge",
      "X-Title": "ThumbForge",
    },
    body: JSON.stringify({
  model: options.model || MODELS.ANALYSIS,
  messages,
  temperature: options.temperature ?? 0.7,
  max_tokens: options.maxTokens ?? 4096,

  ...(options.responseFormat && {
    response_format: options.responseFormat,
    provider: {
      require_parameters: true,
    },
  }),
}),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  const content = data.choices[0]?.message?.content;

  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find((p) => p.type === "text");
    return textPart?.text || "";
  }
  return "";
}

/**
 * Call OpenRouter for image generation (thumbnail creation)
 */
export async function generateImage(
  prompt: string,
  options: {
    model?: string;
    aspectRatio?: string;
    n?: number;
    referenceImageBase64?: string;
  } = {}
): Promise<{
  imageBase64: string;
  revisedPrompt?: string;
}> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  const imagesUrl = OPENROUTER_API_URL.replace(
    "/chat/completions",
    "/images"
  );

  const body: Record<string, unknown> = {
    model: options.model || MODELS.IMAGE_FLASH,
    prompt,
  };

  if (options.aspectRatio) {
    body.aspect_ratio = options.aspectRatio;
  }

  if (options.n) {
    body.n = options.n;
  }

  if (options.referenceImageBase64) {
    body.input_references = [
      {
        type: "image_url",
        image_url: {
          url: options.referenceImageBase64.startsWith("data:")
            ? options.referenceImageBase64
            : `data:image/png;base64,${options.referenceImageBase64}`,
        },
      },
    ];
  }

  const response = await fetch(imagesUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `OpenRouter Image API error (${response.status}): ${error}`
    );
  }

  const result = await response.json();

  const image = result?.data?.[0];

if (!image?.b64_json) {
  throw new Error(
    "OpenRouter returned no valid generated image"
  );
}

const mimeType = image.media_type || "image/png";
const imageBuffer = Buffer.from(image.b64_json, "base64");

const blob = await put(
  `thumbnails/thumb-${Date.now()}.png`,
  imageBuffer,
  {
    access: "public",
    addRandomSuffix: true,
    contentType: mimeType,
  }
);

return {
  imageBase64: blob.url,
  revisedPrompt: undefined,
};
}
