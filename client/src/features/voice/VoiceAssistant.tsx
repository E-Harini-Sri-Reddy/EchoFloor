import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { isTemporaryWorker } from "@/domain/access";
import {
  answerFromRecords,
  classifyIntent,
  suggestReportTitle,
} from "@/domain/assistant";
import { labelMemoryStatus } from "@/domain/labels";
import { machineById, machinesFor, memoriesForMachine } from "@/domain/queries";
import { buildMachineUsageInsight } from "@/domain/workSummary";
import { useDemoDatabase } from "@/hooks/useDemo";
import { useSpeech } from "@/hooks/useSpeech";
import { fetchHealth } from "@/services/clientConfig";
import { demoStore } from "@/services/demoStore";
import {
  pollVoiceQuestion,
  postVoiceQuestion,
  type VoiceEvidenceItem,
} from "@/services/n8nApi";
import {
  blobFilename,
  createLiveRecorder,
  type LiveRecorderHandle,
} from "@/features/voice/liveVoiceRecording";
import type { MemoryStatus, MemoryType, Session } from "@/types/domain";
import { delay, formatTimestamp } from "@/utils/format";

type LivePhase = "idle" | "listening" | "hearing" | "thinking" | "speaking";

const LIVE_CAPTION: Record<LivePhase, string> = {
  idle: "Tap start to unlock audio and begin.",
  listening: "Listening… ask about the selected machine.",
  hearing: "Hearing you…",
  thinking: "Thinking… waiting for n8n.",
  speaking: "Speaking the answer.",
};

function LiveVoiceAssistantPage({
  role,
  session,
}: {
  role: "admin" | "worker";
  session: Session;
}) {
  const db = useDemoDatabase();
  const toast = useToast();
  const speech = useSpeech();
  const [params] = useSearchParams();
  const machines = machinesFor(db, session.organisationId);
  const requested = params.get("machine");
  const [machineId, setMachineId] = useState(
    requested || db.selectedMachineId || machines[0]?.id || "",
  );
  const [livePhase, setLivePhase] = useState<LivePhase>("idle");
  const [conversation, setConversation] = useState(false);
  const [caption, setCaption] = useState("");
  const [failure, setFailure] = useState("");
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState<VoiceEvidenceItem[]>([]);
  const recorderRef = useRef<LiveRecorderHandle | null>(null);
  const busyRef = useRef(false);
  const base = role === "admin" ? "/admin" : "/worker";
  const machine = machineById(db, session.organisationId, machineId);

  useEffect(() => {
    if (requested) setMachineId(requested);
  }, [requested]);

  useEffect(() => {
    return () => {
      speech.cancel();
      recorderRef.current?.dispose();
    };
  }, [speech]);

  async function handleUtterance(blob: Blob) {
    if (busyRef.current || !machine) return;
    busyRef.current = true;
    setLivePhase("thinking");
    setCaption("");
    setFailure("");
    const posted = await postVoiceQuestion(
      { userId: session.userId, organisationId: session.organisationId },
      { machineId: machine.id, audioBlob: blob, filename: blobFilename(blob) },
    );
    if (!posted.ok) {
      setFailure(posted.message);
      setLivePhase("listening");
      busyRef.current = false;
      return;
    }
    const result = posted.pending
      ? await pollVoiceQuestion(
          { userId: session.userId, organisationId: session.organisationId },
          posted.requestId,
        )
      : { ok: true as const, data: posted.data };
    if (!result.ok) {
      setFailure(result.message);
      setLivePhase("listening");
      busyRef.current = false;
      return;
    }
    setAnswer(result.data.answer);
    setEvidence(result.data.evidence);
    setCaption(result.data.answer);
    setLivePhase("speaking");
    await speech.speakAsync(result.data.answer);
    setLivePhase("listening");
    busyRef.current = false;
  }

  async function startConversation() {
    setFailure("");
    if (!machine) {
      setFailure("Choose a machine before starting.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailure("This browser cannot capture audio.");
      return;
    }
    speech.unlock();
    try {
      recorderRef.current?.dispose();
      const handle = await createLiveRecorder({
        isPaused: () => busyRef.current,
        onPhase: (vad) => {
          if (!busyRef.current) setLivePhase(vad === "hearing" ? "hearing" : "listening");
        },
        onUtterance: (blob) => void handleUtterance(blob),
      });
      recorderRef.current = handle;
      setConversation(true);
      setLivePhase("listening");
      toast.push(
        "Listening. Speak naturally, or hold Hold to talk, then release to send.",
      );
    } catch {
      setFailure("Microphone access was denied or is unavailable.");
    }
  }

  function endConversation() {
    speech.cancel();
    recorderRef.current?.dispose();
    recorderRef.current = null;
    setConversation(false);
    setLivePhase("idle");
    busyRef.current = false;
  }

  return (
    <div className="page voice-layout voice-compact">
      <header className="page-header voice-compact-header">
        <div>
          <h2>Voice Assistant</h2>
          <p className="lede">
            Live mode — questions are sent to n8n and answers may cite memory records.
          </p>
        </div>
        <StatusBadge status="info" label={LIVE_CAPTION[livePhase]} />
      </header>
      <p className="notice notice-info">
        Connected to MongoDB. Audio uploads go through the EchoFloor API; n8n webhooks stay
        server-side. If hands-free detection is quiet, use Hold to talk.
      </p>
      <p className="sr-only" aria-live="polite">
        {LIVE_CAPTION[livePhase]}
        {caption ? `. ${caption}` : ""}
      </p>
      <section className="card stack voice-panel">
        <Field label="Machine" htmlFor="live-voice-machine">
          <select
            id="live-voice-machine"
            value={machineId}
            disabled={conversation}
            onChange={(event) => {
              setMachineId(event.target.value);
              demoStore.selectMachine(event.target.value);
            }}
          >
            <option value="">Select a machine</option>
            {machines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.machineCode} — {item.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="voice-mic-center">
          {!conversation ? (
            <Button onClick={() => void startConversation()}>Start conversation</Button>
          ) : (
            <div className="row" style={{ justifyContent: "center" }}>
              <Button
                variant="primary"
                disabled={livePhase === "thinking" || livePhase === "speaking"}
                onPointerDown={(event) => {
                  event.preventDefault();
                  if (busyRef.current) return;
                  recorderRef.current?.beginManualCapture();
                  setLivePhase("hearing");
                }}
                onPointerUp={() => {
                  void recorderRef.current?.endManualCapture();
                }}
                onPointerCancel={() => {
                  void recorderRef.current?.endManualCapture();
                }}
              >
                Hold to talk
              </Button>
              <Button variant="secondary" onClick={endConversation}>
                End
              </Button>
            </div>
          )}
          <div className="voice-mic-status">
            <strong>{LIVE_CAPTION[livePhase]}</strong>
            <p className="muted">
              {conversation
                ? livePhase === "thinking"
                  ? "Sending to n8n… keep this tab open."
                  : "Speak, pause ~1s, or hold Hold to talk then release."
                : "Start unlocks speech output and opens the microphone."}
            </p>
          </div>
        </div>
        {failure ? (
          <div className="notice notice-danger" role="alert">
            {failure}
          </div>
        ) : null}
      </section>
      {answer ? (
        <section className="card stack">
          <h3>Latest answer</h3>
          <p>{answer}</p>
          {evidence.length === 0 ? (
            <p className="muted">No supporting records were returned.</p>
          ) : (
            evidence.map((item) => (
              <article key={item.recordId} className="list-card">
                <p>{item.text}</p>
                <span className="muted">
                  Record {item.recordId.slice(-6)} ·{" "}
                  {formatTimestamp(item.createdAt, "UTC")}
                </span>
                {role === "admin" ? (
                  <Link to={`/admin/memories/${item.recordId}`}>Open record</Link>
                ) : null}
              </article>
            ))
          )}
          <div className="row">
            <Button variant="tertiary" onClick={() => speech.speak(answer)}>
              Read again
            </Button>
            <Link to={`${base}/machines/${machineId}`}>Machine details</Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type Phase =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "uploading"
  | "transcribing"
  | "awaiting_response"
  | "showing_response"
  | "reviewing_proposal"
  | "submitting"
  | "completed"
  | "failed"
  | "canceled";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Idle",
  requesting_permission: "Requesting microphone permission",
  recording: "Recording",
  uploading: "Uploading",
  transcribing: "Transcribing",
  awaiting_response: "Preparing a response",
  showing_response: "Response ready",
  reviewing_proposal: "Review the report before submitting",
  submitting: "Submitting the report",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

export function VoiceAssistantPage({ role }: { role: "admin" | "worker" }) {
  const db = useDemoDatabase();
  const session = db.session;
  const toast = useToast();
  const [params] = useSearchParams();
  const machines = session ? machinesFor(db, session.organisationId) : [];
  const requested = params.get("machine");
  const fromNfc = params.get("source") === "nfc";
  const [machineId, setMachineId] = useState(
    requested || db.selectedMachineId || machines[0]?.id || "",
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState("");
  const [answer, setAnswer] = useState("");
  const [evidence, setEvidence] = useState<
    Array<{ id: string; title: string; status: string }>
  >([]);
  const [proposal, setProposal] = useState({
    title: "",
    content: "",
    type: "maintenance" as MemoryType,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedId, setSavedId] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (requested) setMachineId(requested);
  }, [requested]);

  useEffect(() => {
    if (phase !== "recording") return;
    const handle = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(handle);
  }, [phase]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (!session) return null;
  if (session.live) {
    return <LiveVoiceAssistantPage role={role} session={session} />;
  }
  const organisationId = session.organisationId;
  const machine = machineById(db, organisationId, machineId);
  const temporary = role === "worker" && isTemporaryWorker(session);
  const usageInsight = temporary
    ? buildMachineUsageInsight(db, organisationId, machine)
    : null;
  const timezone =
    db.organisations.find((item) => item.id === organisationId)?.settings.timezone ??
    "UTC";
  const base = role === "admin" ? "/admin" : "/worker";
  const busy = [
    "requesting_permission",
    "recording",
    "uploading",
    "transcribing",
    "awaiting_response",
    "submitting",
  ].includes(phase);

  async function startRecording() {
    setFailure("");
    setSavedId(null);
    setPhase("requesting_permission");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("failed");
      setFailure(
        "This browser cannot capture audio. Type the question or report instead.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setSeconds(0);
      setPhase("recording");
    } catch {
      setPhase("failed");
      setFailure(
        "Microphone access was denied or is unavailable. You can still type a report or question.",
      );
    }
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function stopRecording() {
    stopTracks();
    setPhase("uploading");
    await delay(400);
    setPhase("transcribing");
    await delay(400);
    let speechConfigured = false;
    try {
      const health = await fetchHealth();
      speechConfigured = health.integrations.speech?.configured === true;
    } catch {
      speechConfigured = false;
    }
    setPhase("failed");
    setFailure(
      speechConfigured
        ? "A speech provider is configured on the server, but audio upload and transcription are not implemented. Nothing was transcribed. Type the report instead."
        : "Speech-to-text is not configured. The recording was discarded and was not uploaded. Type the report instead.",
    );
  }

  function cancelRecording() {
    stopTracks();
    setPhase("canceled");
    setFailure("");
    toast.push("Recording canceled. Nothing was submitted.");
  }

  async function submitText() {
    setFailure("");
    setSavedId(null);
    setFieldErrors({});
    if (!machine) {
      setFieldErrors({ machineId: "Choose a machine first." });
      return;
    }
    const intent = classifyIntent(text);
    if (intent === "unclear") {
      setPhase("failed");
      setFailure(
        "Add a question, or describe the observation you want to record. The text was not submitted.",
      );
      return;
    }
    setPhase("awaiting_response");
    await delay(450);
    if (intent === "question") {
      const memories = memoriesForMachine(db, organisationId, machine.id);
      const result = answerFromRecords(text, machine, memories);
      setAnswer(result.text);
      setEvidence(
        result.evidence.map((item) => ({
          id: item.memoryId,
          title: item.title,
          status: item.status,
        })),
      );
      setPhase("showing_response");
      return;
    }
    setProposal({
      title: suggestReportTitle(text),
      content: text.trim(),
      type: "maintenance",
    });
    setPhase("reviewing_proposal");
  }

  async function submitReport() {
    if (!machine) return;
    setPhase("submitting");
    await delay(400);
    const result = demoStore.createReport({
      machineId: machine.id,
      title: proposal.title,
      content: proposal.content,
      type: proposal.type,
      sourceType: "text",
    });
    if (!result.ok) {
      setPhase("reviewing_proposal");
      setFieldErrors(result.fieldErrors ?? {});
      toast.push(result.message);
      return;
    }
    setSavedId(result.data?.id ?? null);
    setPhase("completed");
    toast.push("Report saved in this browser session. It was not written to MongoDB.");
  }

  const responseBlock =
    phase === "showing_response" ? (
      <section className="card stack">
        <h3>Response</h3>
        <p className="notice notice-info">
          Demonstration answer assembled from example records for the selected machine. No
          AI provider was called.
        </p>
        <p>{answer}</p>
        {evidence.length === 0 ? (
          <p className="muted">No supporting records were found.</p>
        ) : null}
        {evidence.map((item) => (
          <article key={item.id} className="list-card">
            <div className="spread">
              <strong>{item.title}</strong>
              <StatusBadge
                status={item.status}
                label={labelMemoryStatus(item.status as MemoryStatus)}
              />
            </div>
            {role === "admin" ? (
              <Link to={`/admin/memories/${item.id}`}>Open record</Link>
            ) : (
              <span className="muted">
                Source record on this machine. Editing is not available to workers.
              </span>
            )}
          </article>
        ))}
      </section>
    ) : null;

  const proposalBlock =
    phase === "reviewing_proposal" || phase === "submitting" ? (
      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void submitReport();
        }}
      >
        <h3>Report proposal</h3>
        <p className="notice">
          This is a new report. It does not edit an existing memory. Outcome is unknown
          unless your text states one. Status will be pending review, not verified.
        </p>
        <Field label="Title" htmlFor="report-title" error={fieldErrors.title}>
          <TextInput
            id="report-title"
            value={proposal.title}
            error={fieldErrors.title}
            onChange={(event) => setProposal({ ...proposal, title: event.target.value })}
          />
        </Field>
        <Field label="What was reported" htmlFor="report-content" error={fieldErrors.content}>
          <textarea
            id="report-content"
            value={proposal.content}
            aria-invalid={fieldErrors.content ? true : undefined}
            onChange={(event) =>
              setProposal({ ...proposal, content: event.target.value })
            }
          />
        </Field>
        <Field label="Type" htmlFor="report-type">
          <select
            id="report-type"
            value={proposal.type}
            onChange={(event) =>
              setProposal({ ...proposal, type: event.target.value as MemoryType })
            }
          >
            <option value="incident">Incident</option>
            <option value="maintenance">Maintenance</option>
            <option value="observation">Observation</option>
            <option value="operational_note">Operational note</option>
          </select>
        </Field>
        {fieldErrors.machineId ? (
          <p className="field-error">{fieldErrors.machineId}</p>
        ) : null}
        <div className="row">
          <Button type="submit" loading={phase === "submitting"}>
            Submit report
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPhase("canceled");
              toast.push("Report was not submitted.");
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    ) : null;

  const completedBlock =
    phase === "completed" && savedId ? (
      <div className="notice" role="status">
        <strong>Report submitted in this session.</strong>
        <p>Record {savedId} is pending review. EchoFloor did not change the machine.</p>
        {temporary ? (
          <Link to="/worker/history">Open damage and repair history</Link>
        ) : (
          <Link to={`${base}/machines/${machineId}`}>View the machine</Link>
        )}
      </div>
    ) : null;

  if (temporary) {
    return (
      <div className="page voice-layout temp-voice">
        <header className="temp-welcome">
          <h2>Welcome, {session.displayName}</h2>
          <p className="temp-access-label">Temporary Access</p>
          <p className="temp-expiry">
            {session.accessExpiresAt
              ? `Login expires ${formatTimestamp(session.accessExpiresAt, timezone)}`
              : "Login expiry is not set. Ask an administrator to confirm your access window."}
          </p>
        </header>
        <p className="sr-only" aria-live="polite">
          {PHASE_LABEL[phase]}
          {phase === "recording" ? `, ${seconds} seconds` : ""}
        </p>
        <section className="temp-machine">
          <Field label="Machine" htmlFor="voice-machine" error={fieldErrors.machineId}>
            <select
              id="voice-machine"
              value={machineId}
              disabled={busy}
              onChange={(event) => {
                setMachineId(event.target.value);
                demoStore.selectMachine(event.target.value);
              }}
            >
              <option value="">Select a machine</option>
              {machines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.machineCode} — {item.name}
                </option>
              ))}
            </select>
          </Field>
          {fromNfc && machine ? (
            <p className="muted">Opened from a demonstration NFC link.</p>
          ) : null}
        </section>
        <section className="temp-voice-center">
          {phase === "recording" ? (
            <button
              type="button"
              className="mic-button mic-button-lg"
              data-recording="true"
              onClick={() => void stopRecording()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="mic-button mic-button-lg"
              onClick={() => void startRecording()}
              disabled={busy}
            >
              Voice
            </button>
          )}
          <p className="muted temp-voice-status">
            {phase === "recording"
              ? `Recording · ${seconds}s. Audio is not uploaded in this preview.`
              : PHASE_LABEL[phase] === "Idle"
                ? "Tap Voice to record. You can also type below."
                : PHASE_LABEL[phase]}
          </p>
          {phase === "recording" ? (
            <Button variant="tertiary" onClick={cancelRecording}>
              Cancel recording
            </Button>
          ) : null}
        </section>
        {failure ? (
          <div className="notice notice-danger" role="alert">
            {failure}
          </div>
        ) : null}
        <section className="card stack">
          <Field label="Or type a question or report" htmlFor="voice-text">
            <textarea
              id="voice-text"
              value={text}
              disabled={phase === "recording" || phase === "submitting"}
              placeholder="Has this machine had a pressure error before?"
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          <div className="row">
            <Button
              onClick={() => void submitText()}
              disabled={busy || text.trim().length === 0}
            >
              Send text
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setText("Replaced the seal. Run at half-speed for four hours.");
              }}
              disabled={busy}
            >
              Use sample report
            </Button>
          </div>
        </section>
        {responseBlock}
        {proposalBlock}
        {completedBlock}
        <section className="card stack temp-usage-summary">
          <div className="spread">
            <h3>Daily work summary</h3>
            <StatusBadge status="info" label="Entire summary" />
          </div>
          {usageInsight ? (
            <>
              <p>{usageInsight.overview}</p>
              <ul className="insight-list">
                {usageInsight.insights.map((insight) => (
                  <li key={insight}>{insight}</li>
                ))}
              </ul>
              <p className="muted">
                Detailed daily work-log text is not shown on temporary worker accounts.
              </p>
            </>
          ) : (
            <p className="muted">Choose a machine to see its entire usage summary.</p>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="page voice-layout voice-compact">
      <header className="page-header voice-compact-header">
        <div>
          <h2>Voice Assistant</h2>
          <p className="lede">
            Ask about a machine or submit a report. Settings stay unchanged.
          </p>
        </div>
        <StatusBadge
          status={phase === "failed" ? "critical" : "info"}
          label={PHASE_LABEL[phase]}
        />
      </header>
      <p className="sr-only" aria-live="polite">
        {PHASE_LABEL[phase]}
        {phase === "recording" ? `, ${seconds} seconds` : ""}
      </p>
      <section className="card stack voice-panel">
        <Field label="Machine" htmlFor="voice-machine" error={fieldErrors.machineId}>
          <select
            id="voice-machine"
            value={machineId}
            disabled={busy}
            onChange={(event) => {
              setMachineId(event.target.value);
              demoStore.selectMachine(event.target.value);
            }}
          >
            <option value="">Select a machine</option>
            {machines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.machineCode} — {item.name}
              </option>
            ))}
          </select>
        </Field>
        {machine ? (
          <p className="muted voice-context">
            <strong className="mono">{machine.machineCode}</strong> — {machine.name}
            {fromNfc ? " · NFC link" : ""}
          </p>
        ) : (
          <p className="muted voice-context">Choose a machine for context.</p>
        )}
        <div className="voice-mic-center">
          {phase === "recording" ? (
            <button
              type="button"
              className="mic-button"
              data-recording="true"
              onClick={() => void stopRecording()}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="mic-button"
              onClick={() => void startRecording()}
              disabled={busy}
            >
              Record
            </button>
          )}
          <div className="voice-mic-status">
            <strong>{PHASE_LABEL[phase]}</strong>
            <p className="muted">
              {phase === "recording"
                ? `Capturing · ${seconds}s`
                : "Mic is used only when you press Record."}
            </p>
            {phase === "recording" ? (
              <Button variant="tertiary" onClick={cancelRecording}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
        {failure ? (
          <div className="notice notice-danger" role="alert">
            {failure}
          </div>
        ) : null}
        <Field label="Or type a question or report" htmlFor="voice-text">
          <textarea
            id="voice-text"
            className="voice-text-input"
            rows={2}
            value={text}
            disabled={phase === "recording" || phase === "submitting"}
            placeholder="Has this machine had a pressure error before?"
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="row">
          <Button
            onClick={() => void submitText()}
            disabled={busy || text.trim().length === 0}
          >
            Send text
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setText("Replaced the seal. Run at half-speed for four hours.");
            }}
            disabled={busy}
          >
            Use sample report
          </Button>
        </div>
      </section>
      {responseBlock}
      {proposalBlock}
      {completedBlock}
    </div>
  );
}
