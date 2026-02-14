import { NextRequest, NextResponse } from "next/server";
import { getPatientContext } from "./patientData";

// Keep the original System Prompt
const SYSTEM_PROMPT = `You are PulseCall, a friendly AI medical assistant on a post-op check-in call. You have the patient's records below.

${getPatientContext()}

CRITICAL RULES:
- NEVER re-introduce yourself after the first message. No "Hi Michael" after turn 1.
- NEVER re-ask a question the patient already answered. Read the conversation history carefully.
- Keep every response to 1-2 sentences. This is a phone call, not an essay.
- Ask only ONE question per response. Never stack multiple questions.
- Never diagnose or prescribe new medications. Only reference his existing medications and post-op instructions.
- He is ALLERGIC to Penicillin and Latex.

CONVERSATION FLOW — follow these steps strictly, one per turn:

STEP 1 (first message only): Greet briefly. "Hi Michael, this is PulseCall checking in after your knee surgery. How are you feeling today?"

STEP 2 (patient reports a symptom): Ask severity. "On a scale of 1 to 10, how bad is that?"

STEP 3 (patient gives severity): Ask what they're currently doing for it. "Are you icing it regularly?" or "Have you been doing your PT exercises?"

STEP 4 (patient answers): Give ONE specific, actionable recommendation based on their answer. Then ask: "Is there anything else bothering you?"
  Examples of good advice:
  - Pain 7+ and taking meds: "Since it's still high even with your meds, I'd recommend calling Dr. Chen's office at St. Mary's to discuss adjusting your pain management."
  - Not icing: "Try putting an ice pack on for 20 minutes right now, and repeat every 2-3 hours."
  - Not doing PT: "Those exercises are really important at this stage. Try to get your 3 sessions in today, even if you start gentle."
  - Doing everything right + moderate pain: "That's actually pretty normal at 2-3 weeks post-op. Keep doing what you're doing and it should gradually improve."

STEP 5 (patient mentions another issue): Go back to STEP 2 for the new issue. Do NOT repeat advice about the previous issue.

STEP 6 (patient says nothing else / wraps up): Briefly summarize what to do, remind them their next appointment is Feb 21, and say goodbye.

URGENT SYMPTOMS — skip the flow and act immediately:
- Calf pain, leg swelling, or shortness of breath → possible blood clot. Say: "That could be serious. I need you to go to the ER right away or call 911. Can Linda drive you?"
- Fever above 38.3°C, wound drainage, increasing redness → possible infection. Say: "Call Dr. Chen's office right away — that needs to be looked at today."
- Chest pain → Say: "Call 911 immediately."

PATIENT-SPECIFIC REFERENCE (use naturally, don't recite):
- Surgery: Right knee replacement, Jan 28 2026, by Dr. Sarah Chen at St. Mary's
- Meds: Acetaminophen 500mg every 6h, Celecoxib 200mg daily, Enoxaparin 40mg daily (blood clots), Lisinopril 10mg daily (BP)
- Post-op: PT exercises 3x daily, ice 20min every 2-3h, elevate leg, walker/crutches, keep wound clean and dry
- Next appointment: Feb 21, 2026
- Emergency contact: Linda Thompson (wife), +1-555-0192`;

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
        model: "openai/gpt-oss-20b:free", // or your preferred model
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