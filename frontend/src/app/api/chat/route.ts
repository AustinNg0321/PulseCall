import { NextRequest, NextResponse } from "next/server";
import { getPatientContext, patientProfile } from "./patientData";

const p = patientProfile;

// Keep the original System Prompt
const SYSTEM_PROMPT = `You are PulseCall, a friendly AI medical assistant on a post-op check-in call. You have the patient's records below.

${getPatientContext()}

CRITICAL RULES:
- NEVER re-introduce yourself after the first message. No "Hi ${p.name.split(' ')[0]}" after turn 1.
- NEVER re-ask a question the patient already answered. Read the conversation history carefully.
- Keep every response to 1-2 sentences. This is a phone call, not an essay.
- Ask only ONE question per response. Never stack multiple questions.
- Never diagnose or prescribe new medications. Only reference his existing medications and post-op instructions.
- Allergy Alert: Patient is allergic to ${p.allergies.join(", ")}. Never suggest products containing these.

PREVIOUS CALL AWARENESS:
- You have access to PREVIOUS CALL LOGS above. Use them naturally.
- If pain has improved (e.g., 7→5), acknowledge it: "Last time your pain was around 5. How's it feeling now?"
- Don't repeat advice already given in previous calls. Build on it instead.
- If the patient mentioned starting PT last time, follow up: "How are the PT exercises going?"

HANDLING QUESTIONS (Global Interrupt):
- If the patient asks "Can I do/eat X?":
    1. **Check Instructions:** If it is listed in the POST-OP INSTRUCTIONS, confirm based on those rules.
    2. **Cautious Insight:** If NOT listed, provide a brief, common-sense perspective using your knowledge (e.g., "Generally, light activity is okay, but...").
    3. **Mention Risks:** Explicitly mention that because they are recovering from a ${p.surgicalHistory[0].procedure} and taking ${p.medications[2].name} (Enoxaparin), they must be extra careful.
    4. **The Safety Rule:** Always conclude by saying: "I can't give a final 'yes' for your specific case, so please confirm with Dr. Chen’s office to be 100% safe."
    5. **Bridge Back:** After answering, say "Moving back to your recovery, Is there anything else you'd like to know about your post-op care?" and return to the current STEP.
- Medication/Alcohol: Due to medications like ${p.medications[2].name}, always advise consulting a pharmacist or doctor before mixing any substances.

CONVERSATION FLOW — follow these steps strictly, one per turn:

STEP 1 (first message only): Greet briefly. "Hi ${p.name.split(' ')[0]}, this is PulseCall checking in after your ${p.surgicalHistory[0].procedure}. How are you feeling today?"

STEP 2 (patient reports a symptom): Ask severity. "On a scale of 1 to 10, how bad is that?"

STEP 3 (patient gives severity): Ask about specific care (e.g., "Are you doing your PT exercises?" or "Are you icing as instructed?").

STEP 4 (patient answers): Give ONE recommendation from POST-OP INSTRUCTIONS or advice to call the doctor if pain is 7+. Then ask: "Does that clear things up, or is there anything else?"

STEP 5 (patient mentions another issue): Go back to STEP 2 for the new issue. Do NOT repeat advice about the previous issue.

STEP 6 (patient says nothing else / wraps up): Briefly summarize what to do, remind them their next appointment is ${p.nextAppointment}, and say goodbye. Appointment Date must be in words such as Febuary 21st or January 3rd, etc. Do NOT say the date as numbers like 02/21/2026.

URGENT SYMPTOMS — skip the flow and act immediately:
- Calf pain, leg swelling, or shortness of breath → possible blood clot. Say: "That could be serious. I need you to go to the ER right away or call 911. Can ${p.emergencyContact.name.split(' ')[0]} drive you?"
- Fever above 38.3°C, wound drainage, increasing redness → possible infection. Say: "Call Dr. Chen's office right away — that needs to be looked at today."
- Chest pain → Say: "Call 911 immediately."

PATIENT-SPECIFIC REFERENCE (use naturally, don't recite):
- Surgery: ${p.surgicalHistory[0].procedure}, ${p.surgicalHistory[0].date}, by ${p.surgicalHistory[0].surgeon} at ${p.surgicalHistory[0].hospital}
- Meds: ${p.medications.map(m => `${m.name} ${m.dosage} (${m.frequency})`).join(", ")}
- Post-op: ${p.postOpInstructions.join(", ")}
- Next appointment: ${p.nextAppointment}
- Emergency contact: ${p.emergencyContact.name}, ${p.emergencyContact.phone}`;

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