"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type CallState = "incoming" | "connected" | "ended";
type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION = 800; // ms of silence before auto-stop

export default function Home() {
  const [callState, setCallState] = useState<CallState>("incoming");
  const [status, setStatus] = useState<Status>("idle");
  const [callDuration, setCallDuration] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  const messagesRef = useRef<ChatMessage[]>([]);
  const callStateRef = useRef<CallState>("incoming");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Keep callStateRef in sync
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Call duration timer
  useEffect(() => {
    if (callState === "connected") {
      callTimerRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (callTimerRef.current) {
        clearInterval(callTimerRef.current);
        callTimerRef.current = null;
      }
    };
  }, [callState]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  // --- Silence detection using Web Audio API ---
  const startSilenceDetection = useCallback((stream: MediaStream, onSilence: () => void) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyserRef.current = analyser;

    const dataArray = new Float32Array(analyser.fftSize);
    let silenceStart: number | null = null;

    const checkAudio = () => {
      analyser.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);

      if (rms < SILENCE_THRESHOLD) {
        if (silenceStart === null) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart > SILENCE_DURATION) {
          onSilence();
          audioContext.close();
          return;
        }
      } else {
        silenceStart = null;
      }

      animFrameRef.current = requestAnimationFrame(checkAudio);
    };

    animFrameRef.current = requestAnimationFrame(checkAudio);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      audioContext.close();
    };
  }, []);

  // --- Process recorded audio: STT → LLM → TTS ---
  const processAudio = useCallback(async (blob: Blob, mimeType: string) => {
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
        // If transcription fails, auto-restart recording
        if (callStateRef.current === "connected") {
          startRecordingLoop();
        }
        return;
      }

      const text = sttData.transcription;
      console.log("User said:", text);

      const currentHistory = [...messagesRef.current];
      const userMsg: ChatMessage = { role: "user", content: text };
      messagesRef.current = [...messagesRef.current, userMsg];
      setMessages([...messagesRef.current]);

      setStatus("thinking");
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcription: text,
          history: currentHistory,
        }),
      });
      const chatData = await chatRes.json();

      if (!chatRes.ok) {
        console.error("Chat error:", chatData.error || chatData);
        if (callStateRef.current === "connected") {
          startRecordingLoop();
        }
        return;
      }

      console.log("AI replied:", chatData.reply);

      const aiMsg: ChatMessage = { role: "assistant", content: chatData.reply };
      messagesRef.current = [...messagesRef.current, aiMsg];
      setMessages([...messagesRef.current]);

      const isEnding = chatData.isEnding === true;

      if (chatData.audio) {
        playAudioAndContinue(chatData.audio, isEnding);
      } else if (isEnding) {
        setCallState("ended");
        setStatus("idle");
      } else {
        startRecordingLoop();
      }
    } catch (err) {
      console.error("Pipeline error:", err);
      if (callStateRef.current === "connected") {
        startRecordingLoop();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Play audio, then continue recording or end call ---
  const playAudioAndContinue = useCallback((audioBase64: string, isEnding: boolean) => {
    setStatus("speaking");
    const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const audioBlob = new Blob([audioBytes], { type: "audio/mp3" });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    audioPlayerRef.current = audio;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);

      audioPlayerRef.current = null;

      if (isEnding) {
        setCallState("ended");
        setStatus("idle");
      } else if (callStateRef.current === "connected") {
        startRecordingLoop();
      } else {
        setStatus("idle");
      }
    };
    audio.play();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Auto-recording loop with silence detection ---
  const startRecordingLoop = useCallback(async () => {
    if (callStateRef.current !== "connected") return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "audio/mp4";
      mimeTypeRef.current = mimeType;

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          await processAudio(blob, mimeType);
        } else if (callStateRef.current === "connected") {
          startRecordingLoop();
        }
      };

      mediaRecorder.start();
      setStatus("recording");

      // Start silence detection
      startSilenceDetection(stream, () => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      });
    } catch {
      console.error("Microphone permission required.");
    }
  }, [processAudio, startSilenceDetection]);

  // --- Answer Call ---
  const answerCall = useCallback(async () => {
    setCallState("connected");
    setStatus("thinking");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "initial", history: [] }),
      });

      const data = await res.json();
      if (!res.ok) {
        console.error("Initial call error:", data);
        setStatus("idle");
        return;
      }

      if (data.reply) {
        const aiMsg: ChatMessage = { role: "assistant", content: data.reply };
        messagesRef.current = [aiMsg];
        setMessages([aiMsg]);

        if (data.audio) {
          playAudioAndContinue(data.audio, false);
        } else {
          startRecordingLoop();
        }
      }
    } catch (err) {
      console.error("Error answering call:", err);
      setStatus("idle");
    }
  }, [playAudioAndContinue, startRecordingLoop]);

  // --- End call manually ---
  const endCall = useCallback(() => {
    
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause(); // Audio Stop
      audioPlayerRef.current.currentTime = 0; // Reset to start
      audioPlayerRef.current = null; // Clear reference
    }

    // Stop any active recording
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setCallState("ended");
    setStatus("idle");
  }, []);

  const isProcessing =
    status === "transcribing" || status === "thinking" || status === "speaking";

  const statusText: Record<Status, string> = {
    idle: "Connecting...",
    recording: "Listening...",
    transcribing: "Processing...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  // --- UI: Incoming Call Screen ---
  if (callState === "incoming") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-between bg-zinc-950 py-20 text-white bg-[url('https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&q=80')] bg-cover bg-center bg-blend-overlay bg-opacity-90">
        <div className="flex flex-col items-center gap-4 mt-10">
          <div className="h-32 w-32 rounded-full bg-gray-200 flex items-center justify-center text-zinc-900 text-5xl shadow-2xl border-4 border-white/20">
            👨‍⚕️
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold">PulseCall AI</h1>
            <p className="text-zinc-300 text-lg animate-pulse mt-2">Incoming Call...</p>
          </div>
        </div>

        <div className="w-full max-w-sm flex justify-around px-8 mb-10">
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="h-20 w-20 rounded-full bg-red-500 flex items-center justify-center shadow-lg hover:bg-red-600 transition duration-300"
            >
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.36 7.46 6.5 12 6.5s8.66 1.86 11.71 5.17c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
            </button>
            <span className="text-sm font-medium">Decline</span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <button
              onClick={answerCall}
              className="h-20 w-20 rounded-full bg-green-500 flex items-center justify-center shadow-lg hover:bg-green-600 transition duration-300 animate-bounce"
            >
              <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.44-5.15-3.75-6.59-6.59l1.97-1.57c.26-.27.36-.66.25-1.01-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3.3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .72-.63.72-1.19v-3.44c0-.54-.45-.99-.99-.99z"/></svg>
            </button>
            <span className="text-sm font-medium">Accept</span>
          </div>
        </div>
      </div>
    );
  }

  // --- UI: Call Ended Screen ---
  if (callState === "ended") {
    return (
      <div className="flex min-h-screen flex-col items-center bg-zinc-950 py-8 text-white">
        <div className="flex flex-col items-center gap-6 max-w-md w-full px-4">

          <div className="flex flex-col items-center gap-2 mt-8">
            <div className="h-20 w-20 rounded-full bg-zinc-800 flex items-center justify-center text-4xl border-2 border-zinc-700">
              👨‍⚕️
            </div>
            <h1 className="text-2xl font-bold mt-2">Call Ended</h1>
            <p className="text-zinc-400 text-lg font-mono">{formatTime(callDuration)}</p>
          </div>

          {/* Conversation Summary */}
          {messages.length > 0 && (
            <div className="w-full flex flex-col gap-3 mt-4 max-h-[400px] overflow-y-auto px-2">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Conversation Summary</h2>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-4 py-3 max-w-[85%] ${
                    msg.role === "user"
                      ? "self-end bg-blue-600/20 text-blue-100"
                      : "self-start bg-zinc-800 text-zinc-100"
                  }`}
                >
                  <p className="text-xs font-semibold mb-1 ${msg.role === 'user' ? 'text-blue-400' : 'text-zinc-400'}">
                    {msg.role === "user" ? "You" : "PulseCall AI"}
                  </p>
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setMessages([]);
              messagesRef.current = [];
              setCallDuration(0);
              answerCall(); 
            }}
            className="mt-6 mb-8 px-8 py-3 rounded-full bg-green-500 text-white font-semibold hover:bg-green-600 transition duration-200"
            >
            New Call
          </button>
        </div>
      </div>
    );
  }

  // --- UI: Connected Call Screen ---
  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-950 py-8 text-white">
      <div className="flex flex-col items-center gap-4 max-w-md w-full px-4 h-full">

        {/* Header */}
        <div className="flex flex-col items-center gap-1 mt-4">
          <h1 className="text-2xl font-bold">PulseCall</h1>
          <div className="text-xl font-mono text-zinc-400">{formatTime(callDuration)}</div>
        </div>

        {/* Status Indicator */}
        <div className="flex flex-col items-center justify-center min-h-[200px]">
          <div
            className={`flex h-40 w-40 items-center justify-center rounded-full transition-all duration-300 shadow-2xl border-4 ${
              status === "recording"
                ? "bg-green-500 border-green-300 shadow-[0_0_30px_rgba(34,197,94,0.5)]"
                : status === "speaking"
                  ? "bg-blue-500 border-blue-400 shadow-[0_0_30px_rgba(59,130,246,0.6)]"
                  : isProcessing
                    ? "bg-zinc-700 border-zinc-600"
                    : "bg-zinc-800 border-zinc-700"
            }`}
          >
            {status === "recording" ? (
              // Mic listening animation
              <div className="flex gap-1.5 items-center h-12">
                <div className="w-1.5 bg-white rounded-full animate-[pulse_0.8s_ease-in-out_infinite] h-6"></div>
                <div className="w-1.5 bg-white rounded-full animate-[pulse_1s_ease-in-out_infinite] h-10"></div>
                <div className="w-1.5 bg-white rounded-full animate-[pulse_0.6s_ease-in-out_infinite] h-8"></div>
                <div className="w-1.5 bg-white rounded-full animate-[pulse_1.1s_ease-in-out_infinite] h-5"></div>
                <div className="w-1.5 bg-white rounded-full animate-[pulse_0.9s_ease-in-out_infinite] h-9"></div>
              </div>
            ) : status === "speaking" ? (
              <div className="flex gap-2 items-center h-12">
                <div className="w-2 bg-white rounded-full animate-[pulse_1s_ease-in-out_infinite] h-8"></div>
                <div className="w-2 bg-white rounded-full animate-[pulse_1.2s_ease-in-out_infinite] h-14"></div>
                <div className="w-2 bg-white rounded-full animate-[pulse_0.8s_ease-in-out_infinite] h-6"></div>
              </div>
            ) : isProcessing ? (
              <div className="h-12 w-12 rounded-full border-4 border-zinc-400 border-t-white animate-spin" />
            ) : (
              <svg className="h-16 w-16 text-zinc-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </div>
          <p className="mt-6 text-zinc-300 font-medium text-lg">{statusText[status]}</p>
        </div>

        {/* Chat History */}
        {messages.length > 0 && (
          <div className="w-full flex flex-col gap-2 max-h-[250px] overflow-y-auto px-1">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`rounded-lg px-3 py-2 max-w-[85%] ${
                  msg.role === "user"
                    ? "self-end bg-blue-600/20 text-blue-100"
                    : "self-start bg-zinc-800 text-zinc-100"
                }`}
              >
                <p className="text-sm leading-relaxed">{msg.content}</p>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        {/* End Call Button */}
        <button
          onClick={endCall}
          className="mb-8 mt-auto h-16 w-16 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition duration-200 shadow-lg"
          title="End Call"
        >
          <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.36 7.46 6.5 12 6.5s8.66 1.86 11.71 5.17c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
        </button>
      </div>
    </div>
  );
}
