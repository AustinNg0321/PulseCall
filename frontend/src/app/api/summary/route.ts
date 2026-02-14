import { NextRequest, NextResponse } from "next/server";

const SUMMARY_PROMPT = `You are a medical call summarizer. Analyze the conversation below and return ONLY valid JSON with this exact structure:

{
  "painLevel": <number 1-10 or null if not mentioned>,
  "symptoms": ["symptom1", "symptom2"],
  "ptExercise": <true/false/null>,
  "medications": "any medication updates or compliance notes",
  "concerns": "what the patient asked about or was worried about",
  "recommendation": "key advice given during the call",
  "followUp": "any follow-up actions needed",
  "summary": "2-3 sentence overall summary of the call"
}

Return ONLY the JSON object. No markdown, no explanation.`;

export async function POST(req: NextRequest) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (!openrouterKey) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 }
    );
  }

  try {
    const { history } = await req.json();

    if (!history || history.length === 0) {
      return NextResponse.json(
        { error: "No conversation history provided" },
        { status: 400 }
      );
    }

    const conversationText = history
      .map((msg: { role: string; content: string }) =>
        `${msg.role === "user" ? "Patient" : "AI"}: ${msg.content}`
      )
      .join("\n");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "PulseCall",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free",
        max_tokens: 500,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: conversationText },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";

    // Parse JSON from LLM response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse summary", raw },
        { status: 500 }
      );
    }

    const summary = JSON.parse(jsonMatch[0]);
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
