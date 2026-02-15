import { NextRequest, NextResponse } from "next/server";
import { SYSTEM_PROMPT } from "./prompts";

export async function POST(req: NextRequest) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const smallestKey = process.env.SMALLEST_AI_API_KEY; // Using Smallest AI Key

  if (!openrouterKey || !smallestKey) {
    return NextResponse.json(
      { error: "API keys not configured" },
      { status: 500 }
    );
  }

  try {
    // Check for 'trigger' in the request body
    const { transcription, history, trigger } = await req.json();

    // If it's NOT the initial trigger, we require a transcription
    if (!transcription && trigger !== "initial") {
      return NextResponse.json(
        { error: "No transcription provided" },
        { status: 400 }
      );
    }

    const pastMessages: { role: string; content: string }[] = history || [];
    const turnNumber = Math.floor(pastMessages.length / 2) + 1;

    // Build the message array for the LLM
    const messages: { role: string; content: string }[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...pastMessages,
    ];

    // --- Logic for Initial Call (AI speaks first) ---
    if (trigger === "initial") {
      messages.push({
        role: "user",
        // Hidden instruction to force the AI to start Step 1
        content: `[System Event: The patient has picked up the phone. Start the conversation with STEP 1 immediately.]`,
      });
    } else {
      // --- Logic for Ongoing Conversation ---
      messages.push({
        role: "user",
        content: `${transcription}\n\n[System note: This is turn ${turnNumber}. Continue the flow naturally.]`,
      });
    }

    // 1. Get Text Response from LLM (OpenRouter)
    console.log("Calling OpenRouter...");
    const llmRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", 
        "X-Title": "PulseCall",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.3-70b-instruct:free", // or your preferred model
        max_tokens: 300,
        messages,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("OpenRouter error:", errText);
      return NextResponse.json({ error: errText }, { status: llmRes.status });
    }

    const llmData = await llmRes.json();
    const reply = llmData.choices?.[0]?.message?.content || "";
    console.log("LLM reply:", reply);

    // 2. Get Audio from Smallest.ai (Waves API)
    // This is used for BOTH the initial greeting and subsequent replies
    console.log("Calling Smallest.ai TTS...");
    const ttsRes = await fetch(
      "https://waves-api.smallest.ai/api/v1/lightning-v3.1/get_speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${smallestKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: reply,
          voice_id: "rachel", // Ensure this voice ID is valid for your account
          sample_rate: 24000,
          speed: 1,
          output_format: "mp3",
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("TTS error:", errText);
      // Return the text reply even if TTS fails
      const endingPatterns = /\b(goodbye|good bye|bye|take care|have a (good|great|nice) (day|evening|night|one))\b/i;
      const isEnding = endingPatterns.test(reply);
      return NextResponse.json({ reply, audio: null, ttsError: errText, isEnding });
    }

    const audioBuffer = await ttsRes.arrayBuffer();
    const audioBase64 = Buffer.from(audioBuffer).toString("base64");

    // Detect if the AI is ending the conversation
    const endingPatterns = /\b(goodbye|good bye|bye|take care|have a (good|great|nice) (day|evening|night|one))\b/i;
    const isEnding = endingPatterns.test(reply);

    return NextResponse.json({ reply, audio: audioBase64, isEnding });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("Chat API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}