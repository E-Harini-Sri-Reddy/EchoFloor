import type { Machine, MemoryRecord } from "@/types/domain";

export type AssistantIntent = "question" | "report" | "unclear";

export interface EvidenceItem {
  memoryId: string;
  title: string;
  status: MemoryRecord["status"];
  excerpt: string;
  createdAt: string;
}

export interface FixtureAnswer {
  mode: "fixture_retrieval";
  text: string;
  evidence: EvidenceItem[];
  conflict: boolean;
}

const QUESTION_START =
  /^(what|when|where|who|why|how|has|have|had|is|are|was|were|did|do|can|could|should)\b/i;

export function classifyIntent(text: string): AssistantIntent {
  const trimmed = text.trim();
  if (trimmed.length < 8) return "unclear";
  if (trimmed.includes("?") || QUESTION_START.test(trimmed)) return "question";
  if (
    /\b(replaced|replace|repaired|cleaned|reseated|observed|reported|error|fault|leak|seal|ran|run at|maintenance|note)\b/i.test(
      trimmed,
    )
  ) {
    return "report";
  }
  return "unclear";
}

export function answerFromRecords(
  question: string,
  machine: Machine,
  memories: MemoryRecord[],
): FixtureAnswer {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 3 && !STOP_WORDS.has(term));
  const ranked = memories
    .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      mode: "fixture_retrieval",
      conflict: false,
      evidence: [],
      text: `No matching example history was found for ${machine.machineCode} — ${machine.name}. This demonstration did not call an AI provider and will not invent a previous incident or repair.`,
    };
  }

  const selected = ranked.slice(0, 3).map((item) => item.memory);
  const conflict =
    selected.length > 1 &&
    selected.some((memory) =>
      /not established|conflict|could not tell/i.test(memory.content),
    );
  const evidence = selected.map((memory) => ({
    memoryId: memory.id,
    title: memory.title,
    status: memory.status,
    excerpt: memory.summary || memory.content.slice(0, 180),
    createdAt: memory.createdAt,
  }));
  const details = selected
    .map(
      (memory) =>
        `${memory.title} (${memory.status.replaceAll("_", " ")}): ${memory.content}`,
    )
    .join(" ");
  const conflictText = conflict
    ? " These records do not agree. EchoFloor is not choosing a cause."
    : "";

  return {
    mode: "fixture_retrieval",
    conflict,
    evidence,
    text: `Demonstration answer for ${machine.machineCode} — ${machine.name}, assembled in the browser from example records. No AI provider was called. ${details}${conflictText} Recorded history is not a live diagnosis and does not confirm the machine's current condition.`,
  };
}

function scoreMemory(memory: MemoryRecord, terms: string[]): number {
  const haystack = `${memory.title} ${memory.content} ${memory.tags.join(" ")} ${
    memory.machineContext?.component ?? ""
  } ${memory.machineContext?.operatingConditions?.join(" ") ?? ""}`.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "have",
  "been",
  "machine",
  "about",
  "before",
  "there",
  "what",
  "when",
  "where",
  "would",
  "could",
  "should",
]);

export function suggestReportTitle(transcript: string): string {
  const cleaned = transcript.trim().replace(/\s+/g, " ");
  if (cleaned.length <= 72) return cleaned;
  return `${cleaned.slice(0, 69).trimEnd()}…`;
}

/**
 * Brief task blurb for dashboard cards. Stand-in until an AI provider is wired;
 * compresses a longer description into one short line.
 */
export function summarizeTaskDescription(description: string): string | null {
  const cleaned = description.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0] ?? cleaned;
  const brief =
    firstSentence.length <= 120
      ? firstSentence
      : `${firstSentence.slice(0, 117).trimEnd()}…`;
  return brief;
}
