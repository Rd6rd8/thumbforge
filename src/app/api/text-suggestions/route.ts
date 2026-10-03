import { NextRequest, NextResponse } from "next/server";
import { textCompletion } from "@/lib/openrouter";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topic, mood, currentText } = body;

    if (!topic) {
      return NextResponse.json(
        { error: "Please provide a topic" },
        { status: 400 }
      );
    }

    const prompt = `You are a YouTube thumbnail text expert. Generate attention-grabbing text overlay suggestions for a YouTube thumbnail.

TOPIC: ${topic}
MOOD: ${mood || "engaging"}
${currentText ? `CURRENT TEXT: ${currentText}` : ""}

Rules for thumbnail text:
- Maximum 4 words
- Create curiosity/urgency
- Use power words (SECRET, HIDDEN, EXPOSED, INSANE, etc.)
- Don't duplicate the video title
- Should be readable at small sizes

Generate exactly 8 text overlay suggestions. Return as a JSON array of strings.
Example: ["DON'T DO THIS", "GAME CHANGER", "THEY LIED", "EXPOSED"]

Return ONLY the JSON array, no explanation.`;

    const result = await textCompletion(
      [{ role: "user", content: prompt }],
      // Headroom for reasoning tokens (counted against max_tokens)
      { temperature: 0.9, maxTokens: 4096 }
    );

    const cleaned = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const suggestions = JSON.parse(cleaned) as string[];

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Text suggestion error:", error);
    return NextResponse.json(
      { error: "Failed to generate text suggestions" },
      { status: 500 }
    );
  }
}
