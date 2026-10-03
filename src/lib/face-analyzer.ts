/**
 * Face Analyzer
 * Analyzes uploaded face photos to generate detailed descriptions
 * for more accurate face reproduction in thumbnail generation.
 */

import { textCompletion, MODELS } from "./openrouter";

export interface FaceAnalysis {
  /** Detailed physical description for image generation prompts */
  description: string;
  /** Key distinguishing features (for reinforcement in prompts) */
  keyFeatures: string[];
  /** Estimated age range */
  ageRange: string;
  /** Gender presentation */
  genderPresentation: string;
  /** Number of reference photos analyzed */
  photoCount: number;
}

/**
 * Analyze one or more face photos and generate a detailed description
 * suitable for guiding AI image generation to reproduce the person's likeness.
 *
 * More photos = better description (different angles, lighting, expressions).
 */
export async function analyzeFace(
  faceImagesBase64: string[]
): Promise<FaceAnalysis> {
  if (faceImagesBase64.length === 0) {
    throw new Error("At least one face photo is required");
  }

  // Build multi-modal content with all face images
  const content: Array<{
    type: string;
    text?: string;
    image_url?: { url: string };
  }> = [];

  // Add all face images
  for (let i = 0; i < faceImagesBase64.length; i++) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${faceImagesBase64[i]}`,
      },
    });
  }

  const photoCountText =
    faceImagesBase64.length === 1
      ? "this photo"
      : `these ${faceImagesBase64.length} photos (they are all the same person from different angles/conditions)`;

  // Add the analysis prompt
  content.push({
    type: "text",
    text: `Analyze ${photoCountText} of a person and provide a detailed physical description that could be used to accurately reproduce their appearance in AI-generated images.

Focus on PERMANENT, DISTINCTIVE features — the things that make this specific person recognizable:

1. **Face shape** — oval, round, square, heart-shaped, etc.
2. **Skin tone** — be specific (light, medium, olive, brown, dark brown, etc.)
3. **Hair** — color, length, style, texture (curly, straight, wavy), hairline
4. **Eyes** — color, shape, size, spacing
5. **Nose** — shape, size, bridge width
6. **Mouth/lips** — shape, fullness
7. **Facial hair** — beard, mustache, stubble, clean-shaven
8. **Distinguishing features** — glasses, moles, dimples, scars, freckles, wrinkles
9. **Build** — what's visible of their body type (shoulders, neck)
10. **Estimated age range**
11. **Gender presentation**

Respond in this exact JSON format:
{
  "description": "A [age-range] [gender-presentation] with [comprehensive physical description in one detailed paragraph, suitable for an image generation prompt]",
  "keyFeatures": ["feature1", "feature2", "feature3", "feature4", "feature5"],
  "ageRange": "e.g., early 30s",
  "genderPresentation": "e.g., male"
}

The "description" should be a single flowing paragraph that reads naturally as part of an image generation prompt. Be specific enough that the generated image would be recognizably this person. The "keyFeatures" should list the 5 most distinctive/recognizable features in order of importance.

Return ONLY valid JSON, no markdown fences.`,
  });

  const response = await textCompletion(
    [{ role: "user", content }],
    {
      model: MODELS.ANALYSIS,
      temperature: 0.3,
      // Headroom for reasoning tokens (counted against max_tokens)
      maxTokens: 4096,
    }
  );

  try {
    // Clean response - strip markdown fences if present
    const cleaned = response
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      description: parsed.description,
      keyFeatures: parsed.keyFeatures || [],
      ageRange: parsed.ageRange || "unknown",
      genderPresentation: parsed.genderPresentation || "unknown",
      photoCount: faceImagesBase64.length,
    };
  } catch {
    // If JSON parsing fails, use the raw response as description
    console.error("Failed to parse face analysis JSON, using raw response");
    return {
      description: response.trim(),
      keyFeatures: [],
      ageRange: "unknown",
      genderPresentation: "unknown",
      photoCount: faceImagesBase64.length,
    };
  }
}
