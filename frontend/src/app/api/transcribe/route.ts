import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const apiKey = process.env.SMALLEST_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "API key not configured" },
      { status: 500 }
    );
  }

  const audioBuffer = await req.arrayBuffer();
  const contentType = req.headers.get("content-type") || "audio/webm";

  const res = await fetch(
    "https://waves-api.smallest.ai/api/v1/lightning/get_text?model=lightning&language=en",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": contentType,
      },
      body: audioBuffer,
    }
  );

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: "Transcription failed", detail: text },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
