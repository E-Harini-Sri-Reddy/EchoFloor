import { useCallback, useEffect, useRef, useState } from "react";

const RATE_KEY = "echofloor.speech.rate";
const LANG_KEY = "echofloor.speech.lang";

function readRate(): number {
  const raw = localStorage.getItem(RATE_KEY);
  const value = raw ? Number(raw) : 1;
  return Number.isFinite(value) && value >= 0.5 && value <= 2 ? value : 1;
}

function readLang(): string {
  return localStorage.getItem(LANG_KEY)?.trim() || "en-US";
}

/** Strip markdown/refs for speechSynthesis. */
export function toSpeakableText(markdown: string): string {
  let text = markdown;
  text = text.replace(/\[ref:\s*[^\]]+\]/gi, "");
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
  text = text.replace(/https?:\/\/\S+/gi, "");
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/^#{1,6}\s+/gm, "");
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/`([^`]+)`/g, "$1");
  text = text.replace(/^[-*+]\s+/gm, "");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function splitSentences(text: string): string[] {
  const cleaned = toSpeakableText(text);
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]?/g);
  return (parts ?? [cleaned]).map((part) => part.trim()).filter(Boolean);
}

export function useSpeech() {
  const [speaking, setSpeaking] = useState(false);
  const [voicesReady, setVoicesReady] = useState(false);
  const queueRef = useRef<string[]>([]);
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null);
  const doneRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const refresh = () => setVoicesReady(window.speechSynthesis.getVoices().length > 0);
    refresh();
    window.speechSynthesis.addEventListener("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refresh);
  }, []);

  const cancel = useCallback(() => {
    queueRef.current = [];
    utterRef.current = null;
    doneRef.current?.();
    doneRef.current = null;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const speakNext = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSpeaking(false);
      doneRef.current?.();
      doneRef.current = null;
      return;
    }
    const next = queueRef.current.shift();
    if (!next) {
      setSpeaking(false);
      doneRef.current?.();
      doneRef.current = null;
      return;
    }
    const utter = new SpeechSynthesisUtterance(next);
    utter.rate = readRate();
    utter.lang = readLang();
    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((voice) => voice.lang === readLang()) ??
      voices.find((voice) => voice.lang.startsWith("en")) ??
      voices[0];
    if (preferred) utter.voice = preferred;
    utter.onend = () => speakNext();
    utter.onerror = () => speakNext();
    utterRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback(
    (text: string) => {
      cancel();
      const sentences = splitSentences(text);
      if (sentences.length === 0) return;
      queueRef.current = sentences;
      setSpeaking(true);
      speakNext();
    },
    [cancel, speakNext],
  );

  const speakAsync = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        cancel();
        const sentences = splitSentences(text);
        if (sentences.length === 0) {
          resolve();
          return;
        }
        doneRef.current = resolve;
        queueRef.current = sentences;
        setSpeaking(true);
        speakNext();
      }),
    [cancel, speakNext],
  );

  const unlock = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const utter = new SpeechSynthesisUtterance(" ");
    utter.volume = 0;
    window.speechSynthesis.speak(utter);
    window.speechSynthesis.cancel();
  }, []);

  const setRate = useCallback((rate: number) => {
    localStorage.setItem(RATE_KEY, String(rate));
  }, []);

  const setLang = useCallback((lang: string) => {
    localStorage.setItem(LANG_KEY, lang.trim() || "en-US");
  }, []);

  return {
    speaking,
    voicesReady,
    speak,
    speakAsync,
    cancel,
    unlock,
    setRate,
    setLang,
    toSpeakableText,
  };
}
