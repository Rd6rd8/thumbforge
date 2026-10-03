/**
 * Video Analysis Pipeline
 * Extracts transcript from YouTube URL and analyzes content for thumbnail generation
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { YoutubeTranscript } from "youtube-transcript-plus";
import { textCompletion, MODELS } from "./openrouter";

const execFileAsync = promisify(execFile);

const VTD_SCRIPT = "/root/clawd/skills/video-transcript-downloader/scripts/vtd.js";

export interface VideoAnalysis {
  title: string;
  topic: string;
  hook: string;
  mood: string;
  keyMoments: string[];
  visualElements: string[];
  textSuggestions: string[];
  colorPalette: string[];
  targetEmotion: string;
  thumbnailConcepts: ThumbnailConcept[];
}

export interface ThumbnailConcept {
  description: string;
  textOverlay: string;
  mood: string;
  visualStyle: string;
  faceExpression: string;
}

const responseFormat = {
  type: "json_schema",
  json_schema: {
    name: "video_analysis",
    strict: true,
    schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        topic: { type: "string" },
        hook: { type: "string" },
        mood: { type: "string" },
        keyMoments: {
          type: "array",
          items: { type: "string" },
        },
        visualElements: {
          type: "array",
          items: { type: "string" },
        },
        textSuggestions: {
          type: "array",
          items: { type: "string" },
        },
        colorPalette: {
          type: "array",
          items: { type: "string" },
        },
        targetEmotion: { type: "string" },
        thumbnailConcepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              description: { type: "string" },
              textOverlay: { type: "string" },
              mood: { type: "string" },
              visualStyle: { type: "string" },
              faceExpression: { type: "string" },
            },
            required: [
              "description",
              "textOverlay",
              "mood",
              "visualStyle",
              "faceExpression",
            ],
            additionalProperties: false,
          },
        },
      },
      required: [
        "title",
        "topic",
        "hook",
        "mood",
        "keyMoments",
        "visualElements",
        "textSuggestions",
        "colorPalette",
        "targetEmotion",
        "thumbnailConcepts",
      ],
      additionalProperties: false,
    },
  },
};

/**
 * Extract transcript from YouTube video
 * Priority: 1) youtube-transcript npm package (works on Vercel)
 *           2) VTD shell-out (local dev only)
 *           3) Free web APIs (unreliable fallback)
 */
export async function extractTranscript(youtubeUrl: string): Promise<string> {
  const videoId = extractVideoId(youtubeUrl);
  if (!videoId) throw new Error("Invalid YouTube URL");

  // Primary: youtube-transcript-plus npm package (pure Node.js, works on Vercel)
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId);
    if (segments && segments.length > 0) {
      let transcript = segments.map((s) => s.text).join(" ");
      // Decode HTML entities (may be double-encoded: &amp;#39; → &#39; → ')
      transcript = transcript
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\[♪♪♪\]/g, "")
        .replace(/♪/g, "")
        .replace(/\[Music\]/gi, "")
        .trim()
        .replace(/\s+/g, " ");
      if (transcript.length > 20) {
        return transcript;
      }
    }
  } catch {
    // npm package failed, try VTD fallback
  }

  // Fallback 1: VTD tool (local dev only — won't exist on Vercel)
  try {
    const { stdout } = await execFileAsync(
      "node",
      [VTD_SCRIPT, "transcript", "--url", youtubeUrl],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const transcript = stdout.trim();
    if (transcript && transcript.length > 20) {
      return transcript;
    }
  } catch {
    // VTD not available or failed, try web API fallbacks
  }

  // Fallback 2: youtube-transcript.io
  try {
    const response = await fetch(
      `https://www.youtube-transcript.io/api/transcript?url=${encodeURIComponent(youtubeUrl)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.transcript || data.text) {
        return data.transcript || data.text;
      }
    }
  } catch {
    // Continue
  }

  // Fallback 3: Supadata
  try {
    const response = await fetch(
      `https://api.supadata.ai/v1/youtube/transcript?url=${encodeURIComponent(youtubeUrl)}`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.content) {
        return typeof data.content === "string"
          ? data.content
          : data.content.map((c: { text: string }) => c.text).join(" ");
      }
    }
  } catch {
    // Continue
  }

  throw new Error(
    "Could not extract transcript. The video may not have captions available."
  );
}

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Get video metadata (title, description) from YouTube oEmbed
 */
export async function getVideoMetadata(
  youtubeUrl: string
): Promise<{ title: string; author: string }> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (response.ok) {
      const data = await response.json();
      return { title: data.title || "", author: data.author_name || "" };
    }
  } catch {
    // Silent fail
  }
  return { title: "", author: "" };
}

/**
 * Parse model output into a VideoAnalysis object.
 * Structured outputs are a routing preference, not a guarantee: when the
 * request is served by an endpoint without response_format support, the model
 * may wrap the JSON in markdown fences — strip them before parsing (same
 * pattern as face-analyzer and the text-suggestions route).
 */
function parseAnalysis(raw: string): VideoAnalysis {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  return JSON.parse(cleaned) as VideoAnalysis;
}

/**
 * Analyze video content and generate thumbnail concepts
 */
export async function analyzeVideo(
  youtubeUrl: string
): Promise<VideoAnalysis> {
  // Get transcript and metadata in parallel
  const [transcript, metadata] = await Promise.all([
    extractTranscript(youtubeUrl).catch(() => ""),
    getVideoMetadata(youtubeUrl),
  ]);

  if (!transcript && !metadata.title) {
    throw new Error(
      "Could not extract any information from this video. Please provide a video with captions or try describing your video instead."
    );
  }

  const analysisPrompt = `You are a YouTube thumbnail expert. Analyze this video content and generate thumbnail concepts.

VIDEO TITLE: ${metadata.title || "Unknown"}
CHANNEL: ${metadata.author || "Unknown"}
TRANSCRIPT (first 3000 chars): ${transcript.substring(0, 3000)}

Based on this content, provide a JSON response with the following structure:
{
  "title": "video title",
  "topic": "main topic in 2-3 words",
  "hook": "the main hook/value proposition of the video in one sentence",
  "mood": "primary mood (exciting/educational/shocking/funny/inspirational/dramatic)",
  "keyMoments": ["3-5 key moments or topics covered"],
  "visualElements": ["5-7 specific visual elements that would work in a thumbnail"],
  "textSuggestions": ["4-6 short text overlays (1-4 words each) that would grab attention"],
  "colorPalette": ["3-4 hex colors that match the video's mood and topic"],
  "targetEmotion": "the emotion the thumbnail should evoke in viewers",
  "thumbnailConcepts": [
    {
      "description": "detailed description of the thumbnail scene/composition",
      "textOverlay": "the text to show on the thumbnail (1-4 words)",
      "mood": "mood of this specific concept",
      "visualStyle": "style description (cinematic/cartoon/minimalist/bold/etc)",
      "faceExpression": "what expression the person should have (shocked/excited/curious/etc)"
    }
  ]
}

Generate exactly 4 thumbnail concepts. Each should be distinctly different in approach.
Focus on what would get HIGH CLICK-THROUGH RATES based on proven YouTube thumbnail principles:
- Strong facial expressions (30-50% of frame)
- High contrast colors
- Minimal but impactful text
- Curiosity gap
- Clear focal point

Return ONLY valid JSON, no markdown or explanation.`;

  const result = await textCompletion(
    [{ role: "user", content: analysisPrompt }],
    {
      model: MODELS.ANALYSIS,
      temperature: 0.8,
      // Headroom for reasoning tokens: reasoning models count reasoning
      // against max_tokens, and a tight budget yields empty/truncated JSON.
      maxTokens: 16384,
      responseFormat,
    }
  );

  return parseAnalysis(result);
}

/**
 * Analyze a text description instead of a video URL
 */
export async function analyzeDescription(
  description: string
): Promise<VideoAnalysis> {
  const analysisPrompt = `You are a YouTube thumbnail expert. Based on this video description, generate thumbnail concepts.

VIDEO DESCRIPTION: ${description}

Provide a JSON response with the following structure:
{
  "title": "suggested video title",
  "topic": "main topic in 2-3 words",
  "hook": "the main hook/value proposition",
  "mood": "primary mood (exciting/educational/shocking/funny/inspirational/dramatic)",
  "keyMoments": ["3-5 potential key points"],
  "visualElements": ["5-7 specific visual elements for thumbnails"],
  "textSuggestions": ["4-6 short text overlays (1-4 words each)"],
  "colorPalette": ["3-4 hex colors matching the mood"],
  "targetEmotion": "emotion to evoke in viewers",
  "thumbnailConcepts": [
    {
      "description": "detailed thumbnail scene description",
      "textOverlay": "text overlay (1-4 words)",
      "mood": "concept mood",
      "visualStyle": "style (cinematic/cartoon/minimalist/bold/etc)",
      "faceExpression": "expression (shocked/excited/curious/etc)"
    }
  ]
}

Generate exactly 4 distinctly different thumbnail concepts.
Return ONLY valid JSON, no markdown.`;

  const result = await textCompletion(
    [{ role: "user", content: analysisPrompt }],
    {
      model: MODELS.ANALYSIS,
      temperature: 0.8,
      // Headroom for reasoning tokens: reasoning models count reasoning
      // against max_tokens, and a tight budget yields empty/truncated JSON.
      maxTokens: 16384,
      responseFormat,
    }
  );

  return parseAnalysis(result);
}
