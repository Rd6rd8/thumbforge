/**
 * OpenRouter API client for ThumbForge
 * Handles both text (analysis) and image generation calls
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

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
      max_tokens: options.maxTokens ?? 2048,
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
    referenceImageBase64?: string;
    aspectRatio?: string;
    imageSize?: "1K" | "2K" | "4K";
  } = {}
): Promise<{ imageBase64: string; revisedPrompt?: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: prompt },
  ];

  // If a reference face image is provided, include it
  if (options.referenceImageBase64) {
    userContent.unshift({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${options.referenceImageBase64}`,
      },
    });
  }

  const model = options.model || MODELS.IMAGE_FLASH;
  const isGemini = model.includes("gemini");

  // Build image_config for aspect ratio and size control (Gemini models)
  const imageConfig: Record<string, string> = {};
  if (isGemini) {
    imageConfig.aspect_ratio = options.aspectRatio || "16:9";
    if (options.imageSize) {
      imageConfig.image_size = options.imageSize;
    }
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/empowerment-ai/thumbforge",
      "X-Title": "ThumbForge",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      modalities: ["image", "text"],
      ...(Object.keys(imageConfig).length > 0 && { image_config: imageConfig }),
      ...(isGemini && {
        provider: {
          order: ["google"],
        },
      }),
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter image API error (${response.status}): ${error}`);
  }

  const data: OpenRouterResponse = await response.json();
  const message = data.choices[0]?.message;
  if (!message) throw new Error("No message in OpenRouter response");

  // Method 1: Check message.images array (OpenRouter Gemini-style response)
  if (message.images && message.images.length > 0) {
    const img = message.images[0];
    if (img.image_url?.url) {
      const base64 = img.image_url.url.replace(
        /^data:image\/\w+;base64,/,
        ""
      );
      const textContent = typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.find((p) => p.type === "text")?.text
          : undefined;
      return {
        imageBase64: base64,
        revisedPrompt: textContent || undefined,
      };
    }
  }

  // Method 2: Check content array for image_url parts (Flux/other models)
  const content = message.content;
  if (Array.isArray(content)) {
    const imagePart = content.find(
      (p) => p.type === "image_url" && p.image_url?.url
    );
    const textPart = content.find((p) => p.type === "text");

    if (imagePart?.image_url?.url) {
      const base64 = imagePart.image_url.url.replace(
        /^data:image\/\w+;base64,/,
        ""
      );
      return {
        imageBase64: base64,
        revisedPrompt: textPart?.text,
      };
    }
  }

  throw new Error("No image returned from OpenRouter");
}
