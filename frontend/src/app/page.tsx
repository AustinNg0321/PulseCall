"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { patientProfile } from "./api/chat/patientData";

type CallState = "home" | "connected" | "ended";
type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface CallSummary {
  painLevel: number | null;
  symptoms: string[];
  ptExercise: boolean | null;
  medications: string;
  concerns: string;
  recommendation: string;
  followUp: string;
  summary: string;
}

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION = 1000; // ms of silence before auto-stop

export default function Home() {
  const [callState, setCallState] = useState<CallState>("home");
  const [status, setStatus] = useState<Status>("idle");
  const [callDuration, setCallDuration] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [callSummary, setCallSummary] = useState<CallSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mimeTypeRef = useRef<string>("audio/webm");
  const messagesRef = useRef<ChatMessage[]>([]);
  const callStateRef = useRef<CallState>("home");
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
        if (messagesRef.current.length > 0) {
          fetchCallSummary(messagesRef.current);
        }
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

  // --- Fetch call summary from LLM ---
  const fetchCallSummary = useCallback(async (history: ChatMessage[]) => {
    setSummaryLoading(true);
    try {
      const res = await fetch("/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      });
      if (res.ok) {
        const data = await res.json();
        setCallSummary(data);
      }
    } catch (err) {
      console.error("Summary fetch error:", err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // --- End call manually ---
  const endCall = useCallback(() => {

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current.currentTime = 0;
      audioPlayerRef.current = null;
    }

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

    // Fetch summary after ending
    if (messagesRef.current.length > 0) {
      fetchCallSummary(messagesRef.current);
    }
  }, [fetchCallSummary]);

  const isProcessing =
    status === "transcribing" || status === "thinking" || status === "speaking";

  const statusText: Record<Status, string> = {
    idle: "Connecting...",
    recording: "Listening...",
    transcribing: "Processing...",
    thinking: "Thinking...",
    speaking: "Speaking...",
  };

  // --- UI: Home Screen ---
  if (callState === "home") {
    const p = patientProfile;

    return (
      <div className="flex min-h-screen flex-col items-center bg-[#050505] py-8 text-white selection:bg-blue-500/30">
        <div className="flex flex-col gap-5 max-w-md w-full px-4">

          {/* Header */}
          <div className="flex items-center justify-between mt-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-zinc-500 bg-clip-text text-transparent">PulseCall</h1>
              <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest">AI Post-Op Assistant</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-zinc-900 border border-white/10 flex items-center justify-center text-lg shadow-inner">
              👨‍⚕️
            </div>
          </div>

          {/* Patient Info Card */}
          <div className="rounded-3xl bg-gradient-to-b from-zinc-900/50 to-zinc-900 border border-white/10 p-6 flex flex-col gap-4 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-3xl shrink-0 shadow-lg">
                🧑
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-white tracking-tight">{p.name}</h2>
                <p className="text-zinc-500 text-sm font-medium">{p.age}M • Patient ID: {p.id}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 pt-2 border-t border-white/5">
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Surgery</span>
                <span className="text-sm text-zinc-200 font-medium truncate">{p.surgicalHistory[0].procedure}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Date</span>
                <span className="text-sm text-zinc-200 font-medium">{p.surgicalHistory[0].date}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Surgeon</span>
                <span className="text-sm text-zinc-200 font-medium">{p.surgicalHistory[0].surgeon}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Next Appt</span>
                <span className="text-sm text-blue-400 font-semibold">{p.nextAppointment}</span>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-zinc-900/50 border border-white/5 p-4 flex flex-col gap-2">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Pain Trend</span>
              <div className="flex items-center gap-1.5 text-xl font-bold">
                {p.previousCalls.map((c, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className={c.painLevel <= 3 ? "text-emerald-400" : c.painLevel <= 6 ? "text-amber-400" : "text-rose-400"}>
                      {c.painLevel}
                    </span>
                    {i < p.previousCalls.length - 1 && (
                      <svg className="w-2.5 h-2.5 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    )}
                  </span>
                ))}
                <svg className="w-2.5 h-2.5 text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="text-zinc-700">?</span>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-900/50 border border-white/5 p-4 flex flex-col gap-1">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">PT Exercise</span>
              <span className="text-xl font-bold text-emerald-400">Active</span>
              <span className="text-[10px] text-zinc-500 font-medium">Streak: 4 Days</span>
            </div>
          </div>

          {/* Call History */}
          <div className="flex flex-col gap-3">
            <h3 className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold px-1">Recent Check-ins</h3>
            {[...p.previousCalls].reverse().map((call, i) => (
              <div key={i} className="group rounded-2xl bg-zinc-900/30 border border-white/5 p-4 flex items-center gap-4 hover:bg-zinc-900/60 transition-all duration-300">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 shadow-lg ${
                  call.painLevel <= 3 ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : call.painLevel <= 6 ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  <span className="text-base font-black">{call.painLevel}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-200">{call.date}</span>
                    <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-tighter">Log #{p.previousCalls.length - i}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 truncate font-medium">{call.summary}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Call Now Button */}
          <button
            onClick={answerCall}
            className="mt-4 mb-8 w-full py-5 rounded-3xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-lg hover:from-blue-500 hover:to-indigo-500 transition-all duration-300 flex items-center justify-center gap-3 shadow-[0_20px_50px_rgba(37,99,235,0.3)] active:scale-[0.98]"
          >
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
            </div>
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.44-5.15-3.75-6.59-6.59l1.97-1.57c.26-.27.36-.66.25-1.01-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3.3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .72-.63.72-1.19v-3.44c0-.54-.45-.99-.99-.99z" />
            </svg>
            Start AI Check-in
          </button>
        </div>
      </div>
    );
  }

  // --- UI: Call Ended Screen ---
  if (callState === "ended") {
    return (
      <div className="flex min-h-screen flex-col items-center bg-[#050505] py-8 text-white">
        <div className="flex flex-col items-center gap-6 max-w-md w-full px-4">

          <div className="flex flex-col items-center gap-2 mt-12">
            <div className="h-20 w-20 rounded-full bg-zinc-800 flex items-center justify-center text-4xl border-2 border-zinc-700">
              👨‍⚕️
            </div>
            <h1 className="text-2xl font-bold mt-2">Call Ended</h1>
            <p className="text-zinc-400 text-lg font-mono">{formatTime(callDuration)}</p>
          </div>

          {/* Call Summary Card */}
          {summaryLoading ? (
            <div className="w-full rounded-3xl bg-zinc-900/50 border border-white/10 p-10 flex flex-col items-center gap-4 backdrop-blur-xl">
              <div className="h-8 w-8 rounded-full border-3 border-zinc-600 border-t-blue-400 animate-spin" />
              <p className="text-zinc-400 text-sm font-medium animate-pulse">Analyzing conversation...</p>
            </div>
          ) : callSummary ? (
            <div className="w-full rounded-3xl bg-zinc-900/50 border border-white/10 p-6 flex flex-col gap-6 backdrop-blur-xl shadow-2xl">
              <h2 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Medical Summary</h2>
              <p className="text-zinc-100 text-base leading-relaxed font-medium">{callSummary.summary}</p>

              <div className="grid grid-cols-2 gap-3">
                {/* Pain Level */}
                <div className="rounded-xl bg-zinc-800/60 p-3 flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-wide">Pain Level</span>
                  <span className="text-2xl font-bold">
                    {callSummary.painLevel !== null ? (
                      <span className={callSummary.painLevel <= 3 ? "text-green-400" : callSummary.painLevel <= 6 ? "text-yellow-400" : "text-red-400"}>
                        {callSummary.painLevel}<span className="text-sm text-zinc-500">/10</span>
                      </span>
                    ) : (
                      <span className="text-zinc-600 text-sm">N/A</span>
                    )}
                  </span>
                </div>

                {/* PT Exercise */}
                <div className="rounded-xl bg-zinc-800/60 p-3 flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-wide">PT Exercise</span>
                  <span className="text-2xl font-bold">
                    {callSummary.ptExercise === true ? (
                      <span className="text-green-400">Active</span>
                    ) : callSummary.ptExercise === false ? (
                      <span className="text-red-400">Not yet</span>
                    ) : (
                      <span className="text-zinc-600 text-sm">N/A</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Symptoms */}
              {callSummary.symptoms.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-zinc-500 uppercase tracking-wide">Symptoms</span>
                  <div className="flex flex-wrap gap-2">
                    {callSummary.symptoms.map((s, i) => (
                      <span key={i} className="px-3 py-1 rounded-full bg-red-500/10 text-red-300 text-xs border border-red-500/20">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendation */}
              {callSummary.recommendation && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-wide">Recommendation</span>
                  <p className="text-zinc-300 text-sm">{callSummary.recommendation}</p>
                </div>
              )}

              {/* Concerns */}
              {callSummary.concerns && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 uppercase tracking-wide">Patient Concerns</span>
                  <p className="text-zinc-300 text-sm">{callSummary.concerns}</p>
                </div>
              )}

              {/* Follow Up */}
              {callSummary.followUp && (
                <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3">
                  <span className="text-xs text-blue-400 uppercase tracking-wide font-semibold">Follow Up</span>
                  <p className="text-blue-200 text-sm mt-1">{callSummary.followUp}</p>
                </div>
              )}
            </div>
          ) : messages.length > 0 ? (
            /* Fallback: show conversation if no summary */
            <div className="w-full flex flex-col gap-3 mt-4 max-h-[400px] overflow-y-auto px-2">
              <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Conversation</h2>
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-xl px-4 py-3 max-w-[85%] ${
                    msg.role === "user"
                      ? "self-end bg-blue-600/20 text-blue-100"
                      : "self-start bg-zinc-800 text-zinc-100"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.content}</p>
                </div>
              ))}
            </div>
          ) : (
            /* No messages at all */
            <div className="w-full rounded-2xl bg-zinc-900 border border-zinc-800 p-6 flex flex-col items-center gap-2">
              <p className="text-zinc-500 text-sm">No conversation recorded</p>
            </div>
          )}

          <button
            onClick={() => {
              setMessages([]);
              messagesRef.current = [];
              setCallDuration(0);
              setCallSummary(null);
              setCallState("home");
            }}
            className="mt-4 mb-8 px-8 py-4 rounded-2xl bg-zinc-900 border border-white/10 text-white font-bold hover:bg-zinc-800 transition-all duration-300 flex items-center gap-3 shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  // --- UI: Connected Call Screen ---
  return (
    <div className="flex min-h-screen flex-col items-center bg-[#050505] py-8 text-white overflow-hidden">
      <div className="flex flex-col items-center gap-4 max-w-md w-full px-4 h-full">

        {/* Header */}
        <div className="flex flex-col items-center gap-1 mt-4">
          <h1 className="text-2xl font-bold">PulseCall</h1>
          <div className="text-xl font-mono text-zinc-400">{formatTime(callDuration)}</div>
        </div>

        {/* Status Indicator */}
        <div className="flex flex-col items-center justify-center min-h-[300px] relative">
          {/* Background Glow */}
          <div className={`absolute h-64 w-64 rounded-full blur-[100px] transition-all duration-1000 opacity-20 ${
            status === "recording" ? "bg-emerald-500" : status === "speaking" ? "bg-blue-500" : "bg-zinc-500"
          }`} />
          
          <div
            className={`relative flex h-48 w-48 items-center justify-center rounded-full transition-all duration-500 shadow-2xl border-[6px] ${
              status === "recording"
                ? "bg-emerald-500 border-emerald-300/50 shadow-[0_0_60px_rgba(16,185,129,0.4)] scale-110"
                : status === "speaking"
                  ? "bg-blue-600 border-blue-400/50 shadow-[0_0_60px_rgba(37,99,235,0.4)] scale-110"
                  : isProcessing
                    ? "bg-zinc-800 border-zinc-700 animate-pulse"
                    : "bg-zinc-900 border-zinc-800"
            }`}
          >
            {status === "recording" ? (
              <div className="flex gap-2 items-center h-16">
                {[0.8, 1.1, 0.6, 1.3, 0.9].map((d, i) => (
                  <div key={i} className="w-2 bg-white rounded-full animate-bounce" style={{ height: `${30 + Math.random() * 40}%`, animationDuration: `${d}s` }}></div>
                ))}
              </div>
            ) : status === "speaking" ? (
              <div className="flex gap-3 items-center h-16">
                {[1.2, 0.8, 1.5].map((d, i) => (
                  <div key={i} className="w-3 bg-white rounded-full animate-pulse" style={{ height: `${40 + Math.random() * 50}%`, animationDuration: `${d}s` }}></div>
                ))}
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
          <p className="mt-10 text-white font-bold text-xl tracking-tight">{statusText[status]}</p>
        </div>

        {/* Chat History */}
        {messages.length > 0 && (
          <div className="w-full flex flex-col gap-3 max-h-[200px] overflow-y-auto px-2 py-4 mask-fade-out">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`rounded-2xl px-4 py-2.5 max-w-[85%] text-sm font-medium shadow-sm transition-all duration-300 ${
                  msg.role === "user"
                    ? "self-end bg-blue-600/20 text-blue-100 border border-blue-500/20"
                    : "self-start bg-zinc-900/80 text-zinc-100 border border-white/5 backdrop-blur-md"
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
          className="mb-12 mt-auto h-20 w-20 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 hover:scale-110 active:scale-95 transition-all duration-300 shadow-[0_0_40px_rgba(244,63,94,0.3)]"
          title="End Call"
        >
          <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.36 7.46 6.5 12 6.5s8.66 1.86 11.71 5.17c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>
        </button>
      </div>
    </div>
  );
}
