"use client";

import { useState, useRef, useCallback } from "react";

type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [duration, setDuration] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  const messagesRef = useRef<ChatMessage[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        stream.getTracks().forEach((track) => track.stop());

        // Step 1: STT
        setStatus("transcribing");
        try {
          const sttRes = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": mimeType },
            body: blob,
          });
          const sttData = await sttRes.json();

          if (!sttRes.ok || !sttData.transcription) {
            console.error("Transcription error:", sttData);
            setStatus("idle");
            return;
          }

          const text = sttData.transcription;
          console.log("Transcription:", text);

          // Add user message to chat
          const userMsg: ChatMessage = { role: "user", content: text };
          const historyForLLM = [...messagesRef.current]; // snapshot current history BEFORE adding new msg
          messagesRef.current = [...messagesRef.current, userMsg];
          setMessages([...messagesRef.current]);

          // Step 2: LLM + TTS (send full history for context)
          setStatus("thinking");
          console.log("Sending history to LLM:", historyForLLM.length, "messages");
          const chatRes = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcription: text,
              history: historyForLLM,
            }),
          });
          const chatData = await chatRes.json();

          if (!chatRes.ok) {
            console.error("Chat error:", chatData.error || chatData);
            setStatus("idle");
            return;
          }

          console.log("AI Reply:", chatData.reply);

          // Add AI reply to chat
          const aiMsg: ChatMessage = { role: "assistant", content: chatData.reply };
          messagesRef.current = [...messagesRef.current, aiMsg];
          setMessages([...messagesRef.current]);

          // Step 3: Play TTS audio
          if (chatData.audio) {
            setStatus("speaking");
            const audioBytes = Uint8Array.from(atob(chatData.audio), (c) =>
              c.charCodeAt(0)
            );
            const audioBlob = new Blob([audioBytes], { type: "audio/mp3" });
            const ttsUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(ttsUrl);
            audio.onended = () => {
              setStatus("idle");
              URL.revokeObjectURL(ttsUrl);
            };
            audio.play();
          } else {
            setStatus("idle");
          }
        } catch (err) {
          console.error("Pipeline error:", err);
          setStatus("idle");
        }
      };

      mediaRecorder.start();
      setStatus("recording");
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } catch {
      alert("Require to access microphone.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && status === "recording") {
      mediaRecorderRef.current.stop();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const isProcessing =
    status === "transcribing" || status === "thinking" || status === "speaking";

  const statusText: Record<Status, string> = {
    idle: "Press the button to start recording your voice.",
    recording: "Recording... Tap to stop.",
    transcribing: "Transcribing your voice...",
    thinking: "AI is thinking...",
    speaking: "AI is speaking...",
  };

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 py-8">
      <div className="flex flex-col items-center gap-6 max-w-md w-full px-4">
        <h1 className="text-3xl font-bold text-white">PulseCall</h1>

        <div className="text-5xl font-mono text-zinc-400">
          {formatTime(duration)}
        </div>

        <button
          onClick={status === "recording" ? stopRecording : startRecording}
          disabled={isProcessing}
          className={`flex h-24 w-24 items-center justify-center rounded-full transition-all duration-200 ${
            status === "recording"
              ? "bg-red-500 hover:bg-red-600 animate-pulse"
              : isProcessing
                ? "bg-zinc-600 cursor-not-allowed"
                : "bg-white hover:bg-zinc-200"
          }`}
        >
          {status === "recording" ? (
            <div className="h-8 w-8 rounded-sm bg-white" />
          ) : isProcessing ? (
            <div className="h-8 w-8 rounded-full border-4 border-zinc-400 border-t-white animate-spin" />
          ) : (
            <svg
              className="h-10 w-10 text-zinc-900"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          )}
        </button>

        <p className="text-sm text-zinc-500">{statusText[status]}</p>

        {/* Chat history */}
        {messages.length > 0 && (
          <div className="w-full flex flex-col gap-3 mt-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`w-full rounded-lg p-4 ${
                  msg.role === "user" ? "bg-zinc-900" : "bg-zinc-800"
                }`}
              >
                <p className="text-xs text-zinc-500 mb-1">
                  {msg.role === "user" ? "You" : "PulseCall AI"}
                </p>
                <p
                  className={`text-sm ${
                    msg.role === "user" ? "text-zinc-300" : "text-white"
                  }`}
                >
                  {msg.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
